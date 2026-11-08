import { query } from '../db.js';

/**
 * Mô hình dự đoán thành công dựa trên dữ liệu lịch sử của chính nền tảng.
 *
 * - Thuật toán: logistic regression + L2, kiểm định chéo 5 fold.
 * - Đầu vào gồm 6 tín hiệu có sẵn trước khi chiến dịch chạy: mục tiêu,
 *   thời lượng, số gói tri ân, độ chi tiết mô tả, tỷ lệ thành công lịch sử
 *   của danh mục và điểm tín nhiệm chủ dự án. Điểm tín nhiệm đã bao gồm KYC
 *   và lịch sử hoạt động nên mô hình không tách riêng để tránh đa cộng tuyến.
 * - Không dùng dữ liệu tương lai của chính dự án đang dự đoán.
 *
 * Module này huấn luyện lại từ DB và cache trong RAM 10 phút. Với quy mô
 * vài trăm dự án, huấn luyện mất < 200ms nên không cần lưu file model.
 */

const MODEL_KEY = 'project_success';
const MODEL_VERSION = 'logreg-v3.1';
const CACHE_TTL_MS = 10 * 60 * 1000;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const sigmoid = (z) => 1 / (1 + Math.exp(-clamp(z, -30, 30)));
const mean = (arr) => arr.reduce((s, n) => s + n, 0) / Math.max(1, arr.length);
const std = (arr) => {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, n) => s + (n - m) ** 2, 0) / Math.max(1, arr.length)) || 1;
};
const round = (n, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

export const FEATURES = [
  {
    key: 'log_goal',
    label: 'Mục tiêu gây quỹ',
    description: 'Mục tiêu càng lớn so với mặt bằng chung thì xác suất đạt càng thấp.',
    explain: ({ display, effect }) =>
      `Mục tiêu ${display.goal_text} ${effect >= 0 ? 'thấp hơn' : 'cao hơn'} mặt bằng chung, ${effect >= 0 ? 'tạo lợi thế' : 'tạo áp lực'} cho chiến dịch.`,
  },
  {
    key: 'duration_days',
    label: 'Thời lượng chiến dịch',
    description: 'Chiến dịch quá dài thường mất đà; quá ngắn khó tích luỹ đủ người ủng hộ.',
    explain: ({ display, effect }) =>
      `Thời lượng ${display.duration_days} ngày ${effect >= 0 ? 'phù hợp với nhịp tài trợ' : 'chưa tối ưu so với nhóm dự án thành công'}.`,
  },
  {
    key: 'reward_count',
    label: 'Số gói tri ân',
    description: 'Nhiều mức tri ân giúp người ủng hộ dễ chọn mức phù hợp.',
    explain: ({ display, effect }) =>
      `Có ${display.reward_count} gói tri ân, ${effect >= 0 ? 'tăng khả năng chuyển đổi' : 'còn ít lựa chọn cho người ủng hộ'}.`,
  },
  {
    key: 'description_length',
    label: 'Độ chi tiết mô tả',
    description: 'Mô tả đủ dài, có mục tiêu, kế hoạch và cách dùng tiền thường đáng tin hơn.',
    explain: ({ display, effect }) =>
      `Mô tả dài ${display.description_length} ký tự, ${effect >= 0 ? 'cho thấy mức độ chuẩn bị tốt' : 'nên bổ sung kế hoạch và bảng dự toán'}.`,
  },
  {
    key: 'category_rate',
    label: 'Tỷ lệ thành công của danh mục',
    description: 'Tỷ lệ thành công lịch sử của các dự án cùng danh mục trên nền tảng.',
    explain: ({ display, effect }) =>
      `Danh mục ${display.category_name} có tỷ lệ thành công lịch sử ${display.category_rate}% (${display.category_sample} dự án đã kết thúc), ${effect >= 0 ? 'là môi trường thuận lợi' : 'thấp hơn mặt bằng chung'}.`,
  },
  {
    key: 'owner_trust',
    label: 'Điểm tín nhiệm chủ dự án',
    description: 'Điểm tín nhiệm được tích luỹ từ KYC, lịch sử giao dịch và phản hồi cộng đồng.',
    explain: ({ display, effect }) =>
      `Chủ dự án có điểm tín nhiệm ${display.owner_trust}/100, ${effect >= 0 ? 'củng cố niềm tin' : 'là điểm cần cải thiện trước khi mở rộng'}.`,
  },
];

const FEATURE_BY_KEY = Object.fromEntries(FEATURES.map((f) => [f.key, f]));

function hashString(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function normalizeKyc(value) {
  return value === 'verified' ? 1 : 0;
}

function categoryRatesFromRows(rows, prior) {
  const byCategory = new Map();
  for (const row of rows) {
    if (!['successful', 'failed'].includes(row.status)) continue;
    const current = byCategory.get(row.category_id) || { n: 0, successes: 0 };
    current.n += 1;
    if (row.status === 'successful') current.successes += 1;
    byCategory.set(row.category_id, current);
  }
  const result = {};
  for (const [categoryId, stat] of byCategory.entries()) {
    // Làm mịn về prior để danh mục ít dữ liệu không bị cực đoan.
    result[categoryId] = (stat.successes + prior * 10) / (stat.n + 10);
  }
  return result;
}

function computeOwnerHistory(rows, overallPrior, allowedIds = null) {
  const stats = new Map();
  const sorted = [...rows].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const enriched = new Map();
  for (const row of sorted) {
    const current = stats.get(row.owner_id) || { count: 0, successes: 0 };
    enriched.set(row.id, {
      owner_prior_count: current.count,
      owner_prior_successes: current.successes,
      owner_prior_success_rate: current.count > 0 ? current.successes / current.count : overallPrior,
    });
    // Khi kiểm định chéo, chỉ dùng kết quả của tập huấn luyện để dựng
    // lịch sử chủ dự án, tránh để nhãn của tập validation rò rỉ vào đặc trưng.
    if (allowedIds && !allowedIds.has(row.id)) continue;
    if (['successful', 'failed'].includes(row.status)) {
      current.count += 1;
      if (row.status === 'successful') current.successes += 1;
      stats.set(row.owner_id, current);
    }
  }
  return enriched;
}

function displayForRow(row, values, categoryRates, overallPrior) {
  const categoryRate = categoryRates[row.category_id] ?? overallPrior;
  const ownerPriorCount = row.owner_prior_count ?? 0;
  const ownerPriorSuccesses = row.owner_prior_successes ?? 0;
  const ownerPriorRate = ownerPriorCount > 0 ? (ownerPriorSuccesses / ownerPriorCount) * 100 : overallPrior * 100;
  return {
    log_goal: `${Math.round(Number(row.goal_amount) / 1_000_000).toLocaleString('vi-VN')} triệu đồng`,
    goal_text: `${Math.round(Number(row.goal_amount) / 1_000_000).toLocaleString('vi-VN')} triệu đồng`,
    duration_days: row.duration_days,
    reward_count: row.reward_count,
    description_length: String(row.description || '').length,
    category_name: row.category_name,
    category_rate: round(categoryRate * 100, 1),
    category_sample: row.category_sample ?? 0,
    owner_trust: Math.round(Number(row.owner_trust)),
    owner_kyc: row.owner_kyc,
    owner_prior_count: ownerPriorCount,
    owner_prior_successes: ownerPriorSuccesses,
    owner_prior_rate: round(ownerPriorRate, 1),
  };
}

function valuesForRow(row, categoryRates, overallPrior) {
  const categoryRate = categoryRates[row.category_id] ?? overallPrior;
  return {
    log_goal: Math.log10(Math.max(100_000, Number(row.goal_amount))),
    duration_days: Number(row.duration_days),
    reward_count: Math.log1p(Number(row.reward_count || 0)),
    description_length: Math.log1p(String(row.description || '').length),
    category_rate: categoryRate,
    owner_trust: Number(row.owner_trust) / 100,
    owner_kyc: normalizeKyc(row.owner_kyc),
    owner_prior_success: Number(row.owner_prior_success_rate ?? overallPrior),
    owner_prior_projects: Math.log1p(Number(row.owner_prior_count || 0)),
  };
}

function featureStats(rows, categoryRates, overallPrior) {
  const stats = {};
  for (const feature of FEATURES) {
    const values = rows.map((row) => valuesForRow(row, categoryRates, overallPrior)[feature.key]);
    stats[feature.key] = { mean: mean(values), std: std(values) };
  }
  return stats;
}

function vectorize(row, categoryRates, overallPrior, stats) {
  const values = valuesForRow(row, categoryRates, overallPrior);
  return FEATURES.map((feature) => (values[feature.key] - stats[feature.key].mean) / stats[feature.key].std);
}

function fitLogistic(X, y, { iterations = 3200, learningRate = 0.18, l2 = 0.035 } = {}) {
  const d = X[0]?.length || 0;
  const weights = new Array(d).fill(0);
  let bias = 0;
  const n = Math.max(1, X.length);

  for (let iter = 0; iter < iterations; iter += 1) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < X.length; i += 1) {
      let z = bias;
      for (let j = 0; j < d; j += 1) z += weights[j] * X[i][j];
      const error = sigmoid(z) - y[i];
      for (let j = 0; j < d; j += 1) gradW[j] += error * X[i][j];
      gradB += error;
    }
    const step = learningRate / (1 + iter / 900);
    for (let j = 0; j < d; j += 1) {
      weights[j] -= step * (gradW[j] / n + l2 * weights[j]);
    }
    bias -= step * (gradB / n);
  }
  return { weights, bias };
}

function predictProbability(model, x) {
  let z = model.bias;
  for (let i = 0; i < model.weights.length; i += 1) z += model.weights[i] * x[i];
  return sigmoid(z);
}

function aucScore(pairs) {
  const positives = pairs.filter((p) => p.y === 1).map((p) => p.p);
  const negatives = pairs.filter((p) => p.y === 0).map((p) => p.p);
  if (!positives.length || !negatives.length) return 0.5;
  let wins = 0;
  let total = 0;
  for (const pos of positives) {
    for (const neg of negatives) {
      total += 1;
      if (pos > neg) wins += 1;
      else if (pos === neg) wins += 0.5;
    }
  }
  return wins / total;
}

function evaluate(model, rows, categoryRates, overallPrior, stats) {
  const pairs = rows.map((row) => ({
    y: row.status === 'successful' ? 1 : 0,
    p: predictProbability(model, vectorize(row, categoryRates, overallPrior, stats)),
  }));
  const threshold = 0.5;
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  let brier = 0;
  for (const { y, p } of pairs) {
    brier += (p - y) ** 2;
    if (p >= threshold && y === 1) tp += 1;
    else if (p < threshold && y === 0) tn += 1;
    else if (p >= threshold && y === 0) fp += 1;
    else fn += 1;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    accuracy: round((tp + tn) / Math.max(1, pairs.length), 3),
    precision: round(precision, 3),
    recall: round(recall, 3),
    f1: round(f1, 3),
    auc: round(aucScore(pairs), 3),
    brier: round(brier / Math.max(1, pairs.length), 3),
    n: pairs.length,
  };
}

function averageMetrics(list) {
  const keys = ['accuracy', 'precision', 'recall', 'f1', 'auc', 'brier'];
  const result = {};
  for (const key of keys) {
    result[key] = round(mean(list.map((m) => m[key])), 3);
  }
  result.folds = list.length;
  result.n = list.reduce((s, m) => s + m.n, 0);
  return result;
}

function fallbackModel(rows) {
  const overallPrior = rows.length
    ? rows.filter((r) => r.status === 'successful').length / Math.max(1, rows.filter((r) => ['successful', 'failed'].includes(r.status)).length)
    : 0.55;
  const stats = {};
  for (const feature of FEATURES) stats[feature.key] = { mean: 0, std: 1 };
  return {
    model_key: MODEL_KEY,
    version: `${MODEL_VERSION}-fallback`,
    algorithm: 'Logistic regression (fallback, chưa đủ dữ liệu)',
    trained_at: new Date().toISOString(),
    sample_size: 0,
    positive_count: 0,
    overall_prior: overallPrior,
    category_rates: {},
    category_samples: {},
    stats,
    weights: FEATURES.map(() => 0),
    bias: 0,
    metrics: { accuracy: null, auc: null, note: 'Chưa đủ dự án đã kết thúc để kiểm định.' },
    features: FEATURES.map((f) => ({ ...f, coefficient: 0 })),
  };
}

async function loadDataset() {
  const { rows } = await query(
    `select p.id, p.owner_id, p.category_id, c.name as category_name,
            p.title, p.description, p.goal_amount, p.start_date, p.end_date,
            p.status, p.created_at, p.current_amount,
            u.trust_score as owner_trust, u.kyc_status as owner_kyc,
            u.created_at as owner_created_at,
            (select count(*) from rewards r where r.project_id = p.id)::int as reward_count,
            (select count(*) from project_updates pu where pu.project_id = p.id)::int as update_count,
            (select count(*) from pledges pl where pl.project_id = p.id and pl.status = 'paid')::int as backer_count
       from projects p
       join categories c on c.id = p.category_id
       join users u on u.id = p.owner_id
      order by p.created_at asc`,
  );

  const decided = rows.filter((r) => ['successful', 'failed'].includes(r.status));
  const overallPrior = decided.length
    ? decided.filter((r) => r.status === 'successful').length / decided.length
    : 0.55;
  const history = computeOwnerHistory(rows, overallPrior);
  const categorySamples = new Map();
  for (const row of decided) {
    categorySamples.set(row.category_id, (categorySamples.get(row.category_id) || 0) + 1);
  }
  return rows.map((row) => {
    const start = new Date(row.start_date);
    const end = new Date(row.end_date);
    const durationDays = Math.max(1, Math.round((end - start) / 86_400_000));
    return {
      ...row,
      duration_days: durationDays,
      ...history.get(row.id),
      category_sample: categorySamples.get(row.category_id) || 0,
    };
  });
}

function trainFinalModel(rows) {
  const decided = rows.filter((r) => ['successful', 'failed'].includes(r.status));
  if (decided.length < 24 || new Set(decided.map((r) => r.status)).size < 2) {
    return fallbackModel(rows);
  }
  const overallPrior = decided.filter((r) => r.status === 'successful').length / decided.length;
  const categoryRates = categoryRatesFromRows(decided, overallPrior);
  const stats = featureStats(decided, categoryRates, overallPrior);
  const X = decided.map((row) => vectorize(row, categoryRates, overallPrior, stats));
  const y = decided.map((row) => (row.status === 'successful' ? 1 : 0));
  const fitted = fitLogistic(X, y);
  return {
    model_key: MODEL_KEY,
    version: MODEL_VERSION,
    algorithm: 'Logistic regression L2, kiểm định chéo 5 fold',
    trained_at: new Date().toISOString(),
    sample_size: decided.length,
    positive_count: y.reduce((s, n) => s + n, 0),
    overall_prior: overallPrior,
    category_rates: categoryRates,
    category_samples: Object.fromEntries(
      [...new Set(decided.map((r) => r.category_id))].map((id) => [
        id,
        decided.filter((r) => r.category_id === id).length,
      ]),
    ),
    stats,
    weights: fitted.weights,
    bias: fitted.bias,
    metrics: {},
    features: FEATURES.map((feature, index) => ({
      ...feature,
      coefficient: round(fitted.weights[index], 4),
    })),
  };
}

function crossValidate(rows) {
  const decided = rows.filter((r) => ['successful', 'failed'].includes(r.status));
  if (decided.length < 24 || new Set(decided.map((r) => r.status)).size < 2) return null;
  const folds = 5;
  const buckets = Array.from({ length: folds }, () => []);
  for (const row of decided) {
    buckets[hashString(row.id) % folds].push(row);
  }
  const results = [];
  for (let i = 0; i < folds; i += 1) {
    const validation = buckets[i];
    const training = buckets.filter((_, index) => index !== i).flat();
    if (!validation.length || !training.length) continue;
    const trainLabels = new Set(training.map((r) => r.status));
    if (trainLabels.size < 2) continue;
    const overallPrior = training.filter((r) => r.status === 'successful').length / training.length;
    const trainingIds = new Set(training.map((r) => r.id));
    const history = computeOwnerHistory(rows, overallPrior, trainingIds);
    const trainingRows = training.map((row) => ({ ...row, ...history.get(row.id) }));
    const validationRows = validation.map((row) => ({ ...row, ...history.get(row.id) }));
    const categoryRates = categoryRatesFromRows(trainingRows, overallPrior);
    const stats = featureStats(trainingRows, categoryRates, overallPrior);
    const X = trainingRows.map((row) => vectorize(row, categoryRates, overallPrior, stats));
    const y = trainingRows.map((row) => (row.status === 'successful' ? 1 : 0));
    const model = fitLogistic(X, y);
    results.push(evaluate(model, validationRows, categoryRates, overallPrior, stats));
  }
  return results.length ? averageMetrics(results) : null;
}

let cache = null;
let cacheAt = 0;
let inFlight = null;

export async function trainModel({ persist = true } = {}) {
  const rows = await loadDataset();
  const model = trainFinalModel(rows);
  const cv = crossValidate(rows);
  const decided = rows.filter((r) => ['successful', 'failed'].includes(r.status));
  const majority = decided.length
    ? Math.max(
        decided.filter((r) => r.status === 'successful').length,
        decided.filter((r) => r.status === 'failed').length,
      ) / decided.length
    : null;
  model.metrics = {
    ...(cv || {}),
    baseline_accuracy: majority !== null ? round(majority, 3) : null,
    holdout: '5-fold cross-validation trên các dự án đã kết thúc',
  };
  model.category_samples = Object.fromEntries(
    Object.keys(model.category_rates).map((id) => [id, decided.filter((r) => r.category_id === id).length]),
  );

  if (persist) {
    try {
      await query('update ai_model_versions set is_active = false where model_key = $1 and is_active', [MODEL_KEY]);
      await query(
        `insert into ai_model_versions
           (model_key, version, algorithm, sample_size, positive_count, metrics, coefficients, feature_stats, is_active)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, true)
         on conflict (model_key, version) do update
           set algorithm = excluded.algorithm,
               sample_size = excluded.sample_size,
               positive_count = excluded.positive_count,
               metrics = excluded.metrics,
               coefficients = excluded.coefficients,
               feature_stats = excluded.feature_stats,
               is_active = true,
               trained_at = now()`,
        [
          MODEL_KEY,
          model.version,
          model.algorithm,
          model.sample_size,
          model.positive_count,
          JSON.stringify({
            ...model.metrics,
            overall_prior: round(model.overall_prior, 4),
            category_rates: model.category_rates,
          }),
          JSON.stringify({
            bias: model.bias,
            weights: model.weights,
            feature_keys: FEATURES.map((f) => f.key),
          }),
          JSON.stringify({ stats: model.stats, category_samples: model.category_samples }),
        ],
      );
    } catch (err) {
      // Server vẫn chạy được nếu migration chưa chạy; chỉ mất phần lưu model.
      console.warn('[ai-model] Không lưu được model version:', err.message);
    }
  }

  cache = model;
  cacheAt = Date.now();
  return model;
}

export async function getModel() {
  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
  if (inFlight) return inFlight;
  inFlight = trainModel({ persist: true })
    .then((model) => {
      cache = model;
      cacheAt = Date.now();
      return model;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function invalidateModelCache() {
  cache = null;
  cacheAt = 0;
}

export function modelCard(model) {
  return {
    key: model.model_key,
    version: model.version,
    algorithm: model.algorithm,
    trained_at: model.trained_at,
    sample_size: model.sample_size,
    positive_count: model.positive_count,
    positive_rate: model.sample_size ? round((model.positive_count / model.sample_size) * 100, 1) : null,
    metrics: model.metrics,
    features: model.features.map((f) => ({
      key: f.key,
      label: f.label,
      description: f.description,
      coefficient: f.coefficient,
    })),
    note: 'Mô hình dùng 6 tín hiệu có trước khi chiến dịch chạy. Điểm tín nhiệm chủ dự án đã bao gồm KYC và lịch sử hoạt động nên không tách riêng để tránh đa cộng tuyến. Chỉ số được kiểm định chéo 5 fold trên các dự án đã kết thúc.',
  };
}

function contributionFor(feature, value, z, coefficient, probability) {
  const deltaLogit = coefficient * z;
  // Xấp xỉ đạo hàm tại xác suất dự báo: quy đổi logit contribution sang điểm %.
  const effect = deltaLogit * probability * (1 - probability) * 100;
  return {
    key: feature.key,
    label: feature.label,
    value: round(value, 4),
    z: round(z, 3),
    coefficient: round(coefficient, 4),
    effect_pp: round(effect, 1),
    direction: effect >= 0 ? 'positive' : 'negative',
  };
}

export function explainPrediction(model, row) {
  const categoryRates = model.category_rates || {};
  const overallPrior = model.overall_prior ?? 0.55;
  const values = valuesForRow(row, categoryRates, overallPrior);
  const display = displayForRow(row, values, categoryRates, overallPrior);
  const x = vectorize(row, categoryRates, overallPrior, model.stats);
  const probability = predictProbability(model, x);
  const score = Math.round(clamp(probability * 100, 1, 99));
  // Độ tin cậy phản ánh mức độ dứt khoát của nhãn dự báo, có cộng nhẹ
  // phần vượt trội của AUC so với mức ngẫu nhiên 0,5.
  const modelAuc = model.metrics?.auc ?? 0.5;
  const confidence = Math.round(
    clamp(50 + Math.abs(probability - 0.5) * 90 + Math.max(0, modelAuc - 0.5) * 10, 50, 95),
  );

  const contributions = FEATURES.map((feature, index) => {
    const item = contributionFor(feature, values[feature.key], x[index], model.weights[index], probability);
    return {
      ...item,
      display_value: display[feature.key] ?? null,
      explanation: feature.explain({ display, effect: item.effect_pp }),
    };
  }).sort((a, b) => Math.abs(b.effect_pp) - Math.abs(a.effect_pp));

  const positive = contributions.filter((c) => c.effect_pp > 0).slice(0, 3);
  const negative = contributions.filter((c) => c.effect_pp < 0).slice(0, 3);
  const label = score >= 65 ? 'likely_success' : score <= 35 ? 'at_risk' : 'uncertain';
  const labelText =
    label === 'likely_success'
      ? 'Có khả năng thành công'
      : label === 'at_risk'
        ? 'Rủi ro không đạt mục tiêu'
        : 'Kết quả chưa rõ ràng';

  const positiveText = positive.length
    ? positive.map((c) => `${c.label.toLowerCase()} (+${Math.abs(c.effect_pp).toFixed(1)} điểm)`).join(', ')
    : 'chưa có tín hiệu tích cực nổi bật';
  const negativeText = negative.length
    ? negative.map((c) => `${c.label.toLowerCase()} (${c.effect_pp.toFixed(1)} điểm)`).join(', ')
    : 'không có rủi ro lớn';

  return {
    score,
    probability: round(probability, 4),
    label,
    label_text: labelText,
    confidence,
    model: modelCard(model),
    features: values,
    display,
    contributions,
    top_positive: positive,
    top_negative: negative,
    summary: `Mô hình dự báo ${score}% khả năng thành công. Tín hiệu tích cực: ${positiveText}. Rủi ro chính: ${negativeText}.`,
    features_snapshot: {
      values,
      display,
      category_rates: categoryRates,
      overall_prior: round(overallPrior, 4),
      owner_history: {
        count: row.owner_prior_count ?? 0,
        successes: row.owner_prior_successes ?? 0,
      },
      evaluated_at: new Date().toISOString(),
    },
  };
}

export function predictRow(model, row) {
  return explainPrediction(model, row);
}

export async function predictForNewProject({
  categoryId,
  goalAmount,
  description = '',
  rewardsCount = 0,
  durationDays = 45,
  ownerId = null,
  ownerTrust = 60,
  ownerKyc = 'none',
}) {
  const model = await getModel();
  let ownerPriorCount = 0;
  let ownerPriorSuccesses = 0;
  if (ownerId) {
    const { rows } = await query(
      `select count(*) filter (where status in ('successful', 'failed'))::int as total,
              count(*) filter (where status = 'successful')::int as successes
         from projects where owner_id = $1`,
      [ownerId],
    );
    ownerPriorCount = rows[0]?.total || 0;
    ownerPriorSuccesses = rows[0]?.successes || 0;
  }
  const overallPrior = model.overall_prior ?? 0.55;
  const row = {
    category_id: categoryId,
    category_name: '',
    goal_amount: goalAmount,
    description,
    reward_count: rewardsCount,
    duration_days: durationDays,
    owner_trust: ownerTrust,
    owner_kyc: ownerKyc,
    owner_prior_count: ownerPriorCount,
    owner_prior_successes: ownerPriorSuccesses,
    owner_prior_success_rate: ownerPriorCount > 0 ? ownerPriorSuccesses / ownerPriorCount : overallPrior,
    status: null,
    created_at: new Date().toISOString(),
  };
  // Lấy tên danh mục + số mẫu lịch sử để giải thích.
  const cat = await query('select name from categories where id = $1', [categoryId]);
  row.category_name = cat.rows[0]?.name || 'Chưa xác định';
  row.category_sample = model.category_samples?.[categoryId] ?? 0;
  return explainPrediction(model, row);
}

export async function predictAllProjects() {
  const model = await getModel();
  const rows = await loadDataset();
  return rows.map((row) => ({
    project_id: row.id,
    status: row.status,
    prediction: explainPrediction(model, row),
  }));
}

export async function savePrediction(db, projectId, prediction) {
  await db.query(
    `insert into ai_predictions
       (project_id, success_probability, label, confidence, model_version,
        features_snapshot, contributions, model_metrics)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)`,
    [
      projectId,
      prediction.score,
      prediction.label,
      prediction.confidence,
      prediction.model?.version || MODEL_VERSION,
      JSON.stringify(prediction.features_snapshot || {}),
      JSON.stringify(prediction.contributions || []),
      JSON.stringify(prediction.model?.metrics || {}),
    ],
  );
}

export async function getModelCard() {
  const model = await getModel();
  return modelCard(model);
}
