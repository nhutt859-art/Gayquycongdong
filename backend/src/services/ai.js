import { query } from '../db.js';
import { mapProject } from '../lib/mappers.js';
import {
  getModelCard,
  predictForNewProject,
  savePrediction as saveModelPrediction,
} from './ai-model.js';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const round = (n, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

export { getModelCard, savePrediction } from './ai-model.js';

/**
 * Wrapper tương thích cho các route cũ. Luôn trả về prediction đầy đủ
 * (score, nhãn, độ tin cậy, đóng góp của từng tín hiệu, model card).
 */
export async function predictSuccess(input) {
  return predictForNewProject({
    categoryId: input.categoryId,
    goalAmount: input.goalAmount,
    description: input.description,
    rewardsCount: input.rewardsCount,
    durationDays: input.durationDays,
    ownerId: input.ownerId,
    ownerTrust: input.ownerTrust ?? input.trustScore ?? 60,
    ownerKyc: input.ownerKyc ?? input.kycStatus ?? 'none',
  });
}

export async function savePredictionForProject(db, projectId, prediction) {
  return saveModelPrediction(db, projectId, prediction);
}

// ============================================================
// GIAN LẬN — chấm điểm theo tín hiệu, mỗi tín hiệu có bằng chứng
// ============================================================

const PROJECT_HYPE_RE = /(cam\s*kết\s*lợi\s*nhuận|siêu\s*lợi|lợi\s*nhuận\s*\d+\s*%|không\s*rủi\s*ro|bao\s*lãi|chắc\s*chắn\s*sinh\s*lời|100\s*%\s*lợi)/i;
const EXTERNAL_PAY_RE = /(chuyển\s*khoản\s*riêng|thanh\s*toán\s*riêng|inbox|telegram|zalo|whatsapp|tài\s*khoản\s*cá\s*nhân)/i;

function textWords(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function levelFor(score) {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

function summarizeSignals(signals, fallback) {
  if (!signals.length) return fallback;
  return signals
    .slice(0, 3)
    .map((s) => `${s.label} (${s.points > 0 ? '+' : ''}${s.points} điểm)`)
    .join('; ');
}

export async function fraudScoreForProject({
  projectId = null,
  ownerId,
  categoryId,
  title = '',
  description = '',
  goalAmount,
  rewardsCount = 0,
  durationDays = 45,
  ownerTrust = 60,
  ownerKyc = 'none',
  ownerCreatedAt = null,
  startDate = null,
}) {
  const signals = [];
  const add = (code, label, points, evidence, severity = 'medium') => {
    if (points > 0) signals.push({ code, label, points, evidence, severity });
  };

  const trust = Number(ownerTrust) || 0;
  const goal = Number(goalAmount) || 0;

  if (ownerKyc !== 'verified') {
    add('owner_unverified', 'Chủ dự án chưa xác thực KYC', 18, 'Tài khoản chưa hoàn tất xác thực danh tính.', 'high');
  }
  if (trust < 30) {
    add('trust_critical', 'Điểm tín nhiệm rất thấp', 22, `Điểm tín nhiệm hiện tại ${Math.round(trust)}/100.`, 'high');
  } else if (trust < 45) {
    add('trust_low', 'Điểm tín nhiệm thấp', 12, `Điểm tín nhiệm hiện tại ${Math.round(trust)}/100.`, 'medium');
  }

  if (ownerCreatedAt) {
    const ageDays = Math.floor((Date.now() - new Date(ownerCreatedAt).getTime()) / 86_400_000);
    if (ageDays < 7) {
      add('owner_new', 'Tài khoản chủ dự án rất mới', 12, `Tài khoản mới tạo ${ageDays} ngày trước.`, 'high');
    } else if (ageDays < 30) {
      add('owner_young', 'Tài khoản chủ dự án mới', 6, `Tài khoản mới tạo ${ageDays} ngày trước.`, 'medium');
    }
  }

  if (PROJECT_HYPE_RE.test(description)) {
    add(
      'hype_language',
      'Nội dung cam kết lợi nhuận bất thường',
      20,
      'Mô tả chứa cụm từ cam kết lợi nhuận/siêu lợi/không rủi ro — dấu hiệu thường gặp của mô hình Ponzi hoặc gọi vốn thiếu căn cứ.',
      'critical',
    );
  }
  if (EXTERNAL_PAY_RE.test(description)) {
    add(
      'external_payment',
      'Kêu gọi thanh toán ngoài nền tảng',
      12,
      'Mô tả có dấu hiệu yêu cầu chuyển khoản riêng hoặc liên hệ ngoài hệ thống.',
      'high',
    );
  }
  if (String(description).length < 120) {
    add('short_description', 'Mô tả quá ngắn', 8, `Mô tả chỉ dài ${String(description).length} ký tự, thiếu kế hoạch sử dụng tiền.`, 'medium');
  }
  if (Number(rewardsCount) === 0) {
    add('no_rewards', 'Không có gói tri ân', 6, 'Chiến dịch không có bất kỳ mức tri ân nào để đối chiếu.', 'low');
  }
  if (Number(durationDays) < 14) {
    add('duration_short', 'Thời gian gây quỹ quá ngắn', 8, `Chiến dịch chỉ kéo dài ${durationDays} ngày.`, 'medium');
  }

  if (categoryId) {
    const cat = await query(
      `select percentile_cont(0.5) within group (order by goal_amount) as median_goal,
              count(*)::int as sample
         from projects
        where category_id = $1 and status in ('successful', 'failed')`,
      [categoryId],
    );
    const medianGoal = Number(cat.rows[0]?.median_goal || 0);
    const sample = Number(cat.rows[0]?.sample || 0);
    if (medianGoal > 0 && goal > medianGoal * 2.5 && sample >= 5) {
      add(
        'goal_outlier',
        'Mục tiêu cao bất thường so với danh mục',
        14,
        `Mục tiêu ${Math.round(goal / 1_000_000)} triệu đồng, cao hơn ${round((goal / medianGoal) * 100, 0)}% so với trung vị danh mục (${Math.round(medianGoal / 1_000_000)} triệu).`,
        'high',
      );
    }
  }

  if (ownerId) {
    const ownerHistory = await query(
      `select
         count(*) filter (where status in ('successful', 'failed'))::int as decided,
         count(*) filter (where status = 'successful')::int as successes,
         count(*) filter (where status in ('failed', 'canceled'))::int as bad,
         count(*) filter (where created_at > now() - interval '30 days')::int as recent
       from projects where owner_id = $1`,
      [ownerId],
    );
    const h = ownerHistory.rows[0] || {};
    if (Number(h.recent) >= 3) {
      add(
        'owner_many_projects',
        'Chủ dự án tạo nhiều chiến dịch trong 30 ngày',
        12,
        `Có ${h.recent} dự án được tạo trong 30 ngày gần đây.`,
        'high',
      );
    }
    if (Number(h.bad) >= 2) {
      add(
        'owner_bad_history',
        'Lịch sử dự án thất bại/đã dừng',
        10,
        `Chủ dự án có ${h.bad} chiến dịch thất bại hoặc đã dừng trước đó.`,
        'medium',
      );
    }
    if (Number(h.decided) >= 2 && Number(h.successes) === 0) {
      add(
        'owner_no_success',
        'Chưa từng có chiến dịch thành công',
        8,
        `Đã kết thúc ${h.decided} chiến dịch nhưng chưa có chiến dịch nào thành công.`,
        'medium',
      );
    }

    const others = await query(
      `select id, title, description from projects
        where owner_id = $1 and ($2::uuid is null or id <> $2::uuid)
        order by created_at desc limit 12`,
      [ownerId, projectId],
    );
    const currentWords = textWords(`${title} ${description}`);
    let maxSimilarity = 0;
    let similarTitle = '';
    for (const row of others.rows) {
      const similarity = jaccard(currentWords, textWords(`${row.title} ${row.description}`));
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        similarTitle = row.title;
      }
    }
    if (maxSimilarity >= 0.78) {
      add(
        'duplicate_content',
        'Nội dung gần trùng với dự án khác',
        14,
        `Mức trùng lặp ${Math.round(maxSimilarity * 100)}% với dự án “${similarTitle}” của cùng chủ dự án.`,
        'high',
      );
    }
  }

  if (projectId) {
    const updates = await query(
      `select count(*)::int as n from project_updates where project_id = $1`,
      [projectId],
    );
    if (Number(updates.rows[0]?.n || 0) === 0) {
      const age = startDate
        ? Math.floor((Date.now() - new Date(startDate).getTime()) / 86_400_000)
        : 0;
      if (age >= 14) {
        add('no_updates', 'Không có bản tin tiến độ', 8, `Chiến dịch đã chạy ${age} ngày nhưng chưa có bản tin cập nhật.`, 'medium');
      }
    }
  }

  const base = 8;
  const score = Math.round(clamp(base + signals.reduce((sum, s) => sum + s.points, 0), 0, 98));
  signals.sort((a, b) => b.points - a.points);
  return {
    score,
    level: levelFor(score),
    signals,
    summary: summarizeSignals(signals, 'Chưa phát hiện tín hiệu gian lận đáng kể.'),
    model_version: 'fraud-project-v2.0',
    evaluated_at: new Date().toISOString(),
  };
}

export async function fraudScoreForPledge({
  pledgeId = null,
  backerId,
  projectId,
  amount,
  isAnonymous = false,
  trustScore = 60,
  kycStatus = 'none',
  backerCreatedAt = null,
  method = 'VNPay',
}) {
  const signals = [];
  const add = (code, label, points, evidence, severity = 'medium') => {
    if (points > 0) signals.push({ code, label, points, evidence, severity });
  };
  const value = Number(amount) || 0;
  const trust = Number(trustScore) || 0;

  const recent = await query(
    `select
       count(*) filter (where created_at > now() - interval '10 minutes')::int as last_10m,
       count(*) filter (where created_at > now() - interval '24 hours')::int as last_24h,
       count(distinct project_id) filter (
         where created_at > now() - interval '24 hours' and project_id <> $2
       )::int as projects_24h,
       count(*) filter (where project_id = $2 and created_at > now() - interval '24 hours')::int as same_project_24h
     from pledges where backer_id = $1`,
    [backerId, projectId],
  );
  const r = recent.rows[0] || {};

  if (Number(r.last_10m) >= 2) {
    add('velocity_10m', 'Tần suất giao dịch bất thường trong 10 phút', 26, `${Number(r.last_10m) + 1} giao dịch trong 10 phút gần đây.`, 'critical');
  } else if (Number(r.last_10m) === 1) {
    add('velocity_10m_low', 'Có giao dịch sát nhau', 8, 'Có 2 giao dịch trong vòng 10 phút.', 'medium');
  }
  if (Number(r.last_24h) >= 7) {
    add('velocity_24h', 'Số giao dịch trong 24 giờ cao', 14, `${Number(r.last_24h) + 1} giao dịch trong 24 giờ.`, 'high');
  }
  if (Number(r.projects_24h) >= 3) {
    add('multi_project', 'Tài trợ dàn trải nhiều dự án trong 24 giờ', 12, `${Number(r.projects_24h) + 1} dự án khác nhau trong 24 giờ.`, 'high');
  }
  if (Number(r.same_project_24h) >= 2) {
    add('same_project_repeat', 'Tài trợ lặp lại cùng một dự án', 8, `${Number(r.same_project_24h) + 1} giao dịch cho cùng dự án trong 24 giờ.`, 'medium');
  }

  if (backerCreatedAt) {
    const ageDays = Math.floor((Date.now() - new Date(backerCreatedAt).getTime()) / 86_400_000);
    if (ageDays < 7 && value >= 20_000_000) {
      add('new_account_high', 'Tài khoản mới tài trợ số tiền lớn', 18, `Tài khoản mới ${ageDays} ngày, giao dịch ${Math.round(value / 1_000_000)} triệu đồng.`, 'critical');
    } else if (ageDays < 30 && value >= 50_000_000) {
      add('young_account_high', 'Tài khoản mới tài trợ số tiền rất lớn', 10, `Tài khoản ${ageDays} ngày, giao dịch ${Math.round(value / 1_000_000)} triệu đồng.`, 'high');
    }
  }

  if (trust < 30) {
    add('trust_critical', 'Điểm tín nhiệm rất thấp', 20, `Điểm tín nhiệm ${Math.round(trust)}/100.`, 'high');
  } else if (trust < 45) {
    add('trust_low', 'Điểm tín nhiệm thấp', 10, `Điểm tín nhiệm ${Math.round(trust)}/100.`, 'medium');
  }
  if (kycStatus !== 'verified' && value >= 30_000_000) {
    add('unverified_high', 'Tài khoản chưa KYC tài trợ số tiền lớn', 8, `Giao dịch ${Math.round(value / 1_000_000)} triệu đồng từ tài khoản chưa xác thực.`, 'medium');
  }
  if (isAnonymous && value >= 50_000_000) {
    add('anonymous_high', 'Tài trợ ẩn danh số tiền lớn', 10, `Giao dịch ẩn danh ${Math.round(value / 1_000_000)} triệu đồng.`, 'medium');
  }

  const history = await query(
    `select count(*)::int as n,
            percentile_cont(0.5) within group (order by amount) as median_amount
       from pledges where backer_id = $1 and status = 'paid'`,
    [backerId],
  );
  const historyCount = Number(history.rows[0]?.n || 0);
  const medianAmount = Number(history.rows[0]?.median_amount || 0);
  if (historyCount >= 3 && medianAmount > 0 && value > medianAmount * 5) {
    add(
      'amount_outlier_user',
      'Số tiền cao bất thường so với lịch sử cá nhân',
      12,
      `Giao dịch ${Math.round(value / 1_000_000)} triệu đồng, cao gấp ${round(value / medianAmount, 1)} lần mức trung vị ${Math.round(medianAmount / 1_000_000)} triệu của chính tài khoản.`,
      'high',
    );
  }

  if (projectId) {
    const projectStats = await query(
      `select count(*)::int as n,
              percentile_cont(0.5) within group (order by amount) as median_amount
         from pledges where project_id = $1 and status = 'paid'`,
      [projectId],
    );
    const projectCount = Number(projectStats.rows[0]?.n || 0);
    const projectMedian = Number(projectStats.rows[0]?.median_amount || 0);
    if (projectCount >= 5 && projectMedian > 0 && value > projectMedian * 6) {
      add(
        'amount_outlier_project',
        'Số tiền cao bất thường so với dự án',
        10,
        `Giao dịch cao gấp ${round(value / projectMedian, 1)} lần mức trung vị của dự án (${Math.round(projectMedian / 1_000_000)} triệu).`,
        'medium',
      );
    }
  }

  if (value >= 50_000_000 && value % 10_000_000 === 0) {
    add('round_amount', 'Số tiền tròn lớn', 5, `Giao dịch ${Math.round(value / 1_000_000)} triệu đồng, là bội số tròn của 10 triệu.`, 'low');
  }
  const hour = new Date().getHours();
  if (hour >= 0 && hour <= 5 && value >= 20_000_000) {
    add('late_night', 'Giao dịch lớn vào đêm khuya', 5, `Thực hiện lúc ${hour} giờ với số tiền ${Math.round(value / 1_000_000)} triệu đồng.`, 'low');
  }

  const base = 8;
  const score = Math.round(clamp(base + signals.reduce((sum, s) => sum + s.points, 0), 0, 98));
  signals.sort((a, b) => b.points - a.points);
  return {
    score,
    level: levelFor(score),
    signals,
    summary: summarizeSignals(signals, 'Giao dịch không có tín hiệu bất thường.'),
    model_version: 'fraud-pledge-v2.0',
    evaluated_at: new Date().toISOString(),
  };
}

// ============================================================
// GỢI Ý DỰ ÁN — content-based + lịch sử tài trợ + collaborative filtering
// ============================================================

function daysBetween(a, b = new Date()) {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

function recommendationReasons({ categoryName, interestWeight, categoryCount, cfScore, progress, backerCount, ageDays }) {
  const reasons = [];
  if (interestWeight >= 0.55) {
    reasons.push(`Bạn đã chọn quan tâm đến ${categoryName}`);
  }
  if (categoryCount > 0) {
    reasons.push(`Bạn đã tài trợ ${categoryCount} dự án cùng danh mục ${categoryName}`);
  }
  if (cfScore >= 0.35) {
    reasons.push('Những người từng ủng hộ dự án bạn tài trợ cũng quan tâm dự án này');
  }
  if (progress >= 50) {
    reasons.push(`Dự án đã đạt ${Math.round(progress)}% mục tiêu với ${backerCount} nhà tài trợ`);
  }
  if (ageDays <= 7) {
    reasons.push('Dự án mới mở gần đây');
  }
  if (!reasons.length) {
    reasons.push('Dự án đang gây quỹ phù hợp với danh mục chung của nền tảng');
  }
  return reasons.slice(0, 2).join('; ');
}

export async function refreshRecommendations(userId, limit = 6) {
  const [projects, interests, categoryHistory, cfRows] = await Promise.all([
    query(
      `select p.*, c.name as category_name, u.full_name as owner_name,
              (select count(*) from rewards r where r.project_id = p.id)::int as reward_count,
              (select count(*) from pledges pl where pl.project_id = p.id and pl.status = 'paid')::int as backer_count,
              (select count(*) from follows f where f.project_id = p.id)::int as follower_count
         from projects p
         join categories c on c.id = p.category_id
         join users u on u.id = p.owner_id
        where p.status = 'active' and p.owner_id <> $1
        order by p.created_at desc`,
      [userId],
    ),
    query('select category_id, weight from user_interests where user_id = $1', [userId]),
    query(
      `select p.category_id, count(distinct p.id)::int as cnt, coalesce(sum(pl.amount), 0)::numeric as total
         from pledges pl
         join projects p on p.id = pl.project_id
        where pl.backer_id = $1 and pl.status = 'paid'
        group by p.category_id`,
      [userId],
    ),
    query(
      `with my_projects as (
         select project_id from pledges where backer_id = $1 and status = 'paid'
       ),
       similar_users as (
         select pl.backer_id, count(distinct pl.project_id)::numeric as overlap
           from pledges pl
           join my_projects mp on mp.project_id = pl.project_id
          where pl.backer_id <> $1 and pl.status = 'paid'
          group by pl.backer_id
       ),
       candidates as (
         select pl.project_id, sum(su.overlap)::numeric as cf_score
           from pledges pl
           join similar_users su on su.backer_id = pl.backer_id
          where pl.status = 'paid'
            and pl.project_id not in (select project_id from my_projects)
          group by pl.project_id
       )
       select project_id, cf_score from candidates order by cf_score desc`,
      [userId],
    ),
  ]);

  if (!projects.rows.length) return [];

  const interestMap = new Map(interests.rows.map((r) => [r.category_id, Number(r.weight)]));
  const historyMap = new Map(categoryHistory.rows.map((r) => [r.category_id, Number(r.cnt)]));
  const maxHistory = Math.max(1, ...historyMap.values());
  const cfMap = new Map(cfRows.rows.map((r) => [r.project_id, Number(r.cf_score)]));
  const maxCf = Math.max(1, ...cfMap.values());

  const scored = projects.rows.map((row) => {
    const interestWeight = interestMap.get(row.category_id) || 0;
    const categoryCount = historyMap.get(row.category_id) || 0;
    const categoryAffinity = Math.min(1, categoryCount / maxHistory);
    const cfScore = Math.min(1, (cfMap.get(row.id) || 0) / maxCf);
    const progress = Number(row.goal_amount) > 0 ? Math.min(1, Number(row.current_amount) / Number(row.goal_amount)) : 0;
    const quality =
      0.5 * progress +
      0.3 * Math.min(1, Number(row.backer_count || 0) / 50) +
      0.2 * (Number(row.ai_success_score || 0) / 100);
    const ageDays = daysBetween(row.created_at);
    const freshness = Math.exp(-ageDays / 30);

    const components = [
      { key: 'interest', label: 'Sở thích đã chọn', value: interestWeight, weight: 0.34, available: interests.rows.length > 0 },
      { key: 'category_history', label: 'Lịch sử tài trợ cùng danh mục', value: categoryAffinity, weight: 0.18, available: categoryHistory.rows.length > 0 },
      { key: 'collaborative', label: 'Người ủng hộ tương tự', value: cfScore, weight: 0.28, available: cfRows.rows.length > 0 && maxCf > 0 },
      { key: 'quality', label: 'Chất lượng & đà gây quỹ', value: quality, weight: 0.15, available: true },
      { key: 'freshness', label: 'Độ mới của dự án', value: freshness, weight: 0.05, available: true },
    ];
    const totalWeight = components.filter((c) => c.available).reduce((s, c) => s + c.weight, 0) || 1;
    const score = components.reduce((sum, c) => sum + (c.available ? c.value * c.weight : 0), 0) / totalWeight;
    const breakdown = {
      components: components.map((c) => ({
        key: c.key,
        label: c.label,
        value: round(c.value, 3),
        weight: c.weight,
        available: c.available,
        contribution: round((c.available ? c.value * c.weight : 0) / totalWeight, 3),
      })),
      signals: {
        interest_weight: round(interestWeight, 3),
        category_count: categoryCount,
        collaborative_score: round(cfScore, 3),
        progress: round(progress, 3),
        backer_count: Number(row.backer_count || 0),
        age_days: round(ageDays, 1),
      },
    };
    return {
      ...row,
      score: round(Math.min(1, Math.max(0, score)), 3),
      reason: recommendationReasons({
        categoryName: row.category_name,
        interestWeight,
        categoryCount,
        cfScore,
        progress: progress * 100,
        backerCount: Number(row.backer_count || 0),
        ageDays,
      }),
      score_breakdown: breakdown,
    };
  });

  scored.sort((a, b) => b.score - a.score || new Date(b.created_at) - new Date(a.created_at));
  const selected = scored.slice(0, Math.max(1, Math.min(12, limit)));

  await query('delete from ai_recommendations where user_id = $1', [userId]);

  if (selected.length) {
    const values = [];
    const params = [];
    for (const row of selected) {
      const base = params.length;
      params.push(userId, row.id, row.score, row.reason, JSON.stringify(row.score_breakdown));
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb)`);
    }
    await query(
      `insert into ai_recommendations (user_id, project_id, score, reason, score_breakdown)
       values ${values.join(', ')}
       on conflict (user_id, project_id)
       do update set score = excluded.score,
                     reason = excluded.reason,
                     score_breakdown = excluded.score_breakdown,
                     generated_at = now()`,
      params,
    );
  }

  return selected.map((row) => ({
    ...mapProject(row),
    score: Number(row.score),
    reason: row.reason,
    score_breakdown: row.score_breakdown,
  }));
}

export async function getFraudModelInfo() {
  return {
    project_model: 'fraud-project-v2.0',
    pledge_model: 'fraud-pledge-v2.0',
    threshold: 60,
    description:
      'Mỗi cảnh báo được tổng hợp từ các tín hiệu độc lập (KYC, tín nhiệm, lịch sử chủ dự án, mục tiêu so với danh mục, tần suất giao dịch, độ lệch số tiền, hành vi ẩn danh). Điểm >= 60 sẽ tạo cảnh báo cho admin xác minh.',
  };
}
