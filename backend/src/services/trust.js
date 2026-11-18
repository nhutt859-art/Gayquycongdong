import { pool, withTransaction } from '../db.js';

/**
 * Điểm tín nhiệm được tính hoàn toàn từ bằng chứng đã xác minh trong
 * `trust_events`. `users.trust_score` chỉ là bản tổng hợp được cập nhật lại
 * sau mỗi sự kiện để các truy vấn danh sách/AI không phải join bảng sự kiện.
 *
 * Quy tắc:
 *   - Nền 60 điểm.
 *   - Danh tính (email + KYC + hồ sơ đầy đủ): tối đa +15.
 *   - Thâm niên: +1 mỗi 30 ngày, tối đa +10.
 *   - Tài trợ thành công: +1 mỗi khoản, tối đa +10.
 *   - Chủ dự án hoàn thành chiến dịch: +5 mỗi dự án, tối đa +15.
 *   - Cập nhật tiến độ đúng hạn: +2 mỗi bản tin, tối đa +10.
 *   - Vi phạm do admin xác nhận: -10…-30 mỗi báo cáo.
 *   - Gian lận được xác nhận: -30 (kèm khóa tài khoản nếu là người dùng).
 *   - Điều chỉnh thủ công của admin và điểm kế thừa: không giới hạn.
 *
 * Điểm cuối cùng luôn được kẹp trong khoảng 0…100. Các mốc vượt trần vẫn
 * được lưu thành sự kiện để giữ bằng chứng; trần chỉ áp dụng lúc tổng hợp.
 */

export const TRUST_BASE_SCORE = 60;

export const TRUST_CATEGORIES = {
  identity: {
    label: 'Xác thực & hồ sơ',
    cap: 15,
    description: 'Email, KYC, ảnh đại diện và số điện thoại.',
  },
  tenure: {
    label: 'Thâm niên',
    cap: 10,
    description: 'Tự động cộng 1 điểm mỗi 30 ngày kể từ khi tạo tài khoản.',
  },
  backing: {
    label: 'Tài trợ',
    cap: 10,
    description: 'Mỗi khoản tài trợ đã thanh toán thành công.',
  },
  owner: {
    label: 'Chủ dự án',
    cap: 15,
    description: 'Mỗi chiến dịch do bạn sở hữu hoàn thành thành công.',
  },
  updates: {
    label: 'Cập nhật tiến độ',
    cap: 10,
    description: 'Bản tin tiến độ được đăng đúng hạn của chiến dịch.',
  },
  penalty: {
    label: 'Vi phạm',
    cap: null,
    description: 'Báo cáo vi phạm hoặc gian lận đã được quản trị viên xác nhận.',
  },
  admin: {
    label: 'Điều chỉnh của quản trị viên',
    cap: null,
    description: 'Điều chỉnh thủ công kèm lý do và nhật ký kiểm toán.',
  },
  legacy: {
    label: 'Điểm kế thừa',
    cap: null,
    description: 'Chênh lệch được bảo toàn một lần khi chuyển sang tính theo bằng chứng.',
  },
};

export const TRUST_REASONS = {
  email_verified: {
    category: 'identity',
    delta: 5,
    label: 'Xác thực email',
    description: 'Email đã được xác thực thành công.',
  },
  kyc_verified: {
    category: 'identity',
    delta: 5,
    label: 'Xác thực danh tính (KYC)',
    description: 'Hồ sơ CCCD/hộ chiếu đã được xác thực.',
  },
  profile_completed: {
    category: 'identity',
    delta: 5,
    label: 'Hoàn thiện hồ sơ',
    description: 'Đã có ảnh đại diện và số điện thoại hợp lệ.',
  },
  account_age: {
    category: 'tenure',
    delta: 1,
    label: 'Thâm niên tài khoản',
    description: 'Tự động cộng 1 điểm cho mỗi 30 ngày hoạt động.',
  },
  pledge_paid: {
    category: 'backing',
    delta: 1,
    label: 'Tài trợ thành công',
    description: 'Một khoản tài trợ đã được thanh toán thành công.',
  },
  campaign_completed: {
    category: 'owner',
    delta: 5,
    label: 'Hoàn thành chiến dịch',
    description: 'Chiến dịch do bạn sở hữu đã đạt mục tiêu.',
  },
  progress_update_on_time: {
    category: 'updates',
    delta: 2,
    label: 'Cập nhật tiến độ đúng hạn',
    description: 'Bản tin tiến độ được đăng trong thời gian chiến dịch.',
  },
  report_violation: {
    category: 'penalty',
    delta: -10,
    label: 'Vi phạm bị xác nhận',
    description: 'Báo cáo vi phạm đã được quản trị viên xác nhận.',
  },
  fraud_confirmed: {
    category: 'penalty',
    delta: -30,
    label: 'Gian lận được xác nhận',
    description: 'Cảnh báo gian lận đã được quản trị viên xác nhận.',
  },
  admin_adjustment: {
    category: 'admin',
    delta: 0,
    label: 'Điều chỉnh của quản trị viên',
    description: 'Quản trị viên điều chỉnh điểm kèm lý do.',
  },
  legacy_adjustment: {
    category: 'legacy',
    delta: 0,
    label: 'Điểm kế thừa',
    description: 'Bảo toàn điểm tín nhiệm trước khi chuyển sang tính theo bằng chứng.',
  },
};

const CATEGORY_KEYS = Object.keys(TRUST_CATEGORIES);
const REASON_KEYS = Object.keys(TRUST_REASONS);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Chuẩn hoá một dòng tổng hợp theo danh mục thành breakdown hiển thị cho UI. */
function buildBreakdown(rows) {
  const totals = new Map(rows.map((row) => [row.category, row]));
  return CATEGORY_KEYS.map((key) => {
    const meta = TRUST_CATEGORIES[key];
    const row = totals.get(key);
    const raw = num(row?.total);
    const applied = meta.cap === null ? raw : Math.min(raw, meta.cap);
    return {
      key,
      label: meta.label,
      description: meta.description,
      cap: meta.cap,
      raw,
      applied,
      count: Number(row?.events || 0),
      capped: meta.cap !== null && raw >= meta.cap,
      remaining: meta.cap === null ? null : Math.max(0, meta.cap - applied),
    };
  });
}

function scoreFromRows(rows) {
  const breakdown = buildBreakdown(rows);
  const bonus = breakdown.reduce((sum, item) => sum + item.applied, 0);
  return {
    score: clamp(Math.round((TRUST_BASE_SCORE + bonus) * 100) / 100, 0, 100),
    breakdown,
  };
}

export function trustLevel(score) {
  const value = num(score);
  if (value >= 90) {
    return { key: 'excellent', label: 'Rất cao', tone: 'emerald', description: 'Hồ sơ có nhiều bằng chứng đáng tin cậy.' };
  }
  if (value >= 75) {
    return { key: 'high', label: 'Cao', tone: 'emerald', description: 'Hồ sơ đáng tin cậy, nên tiếp tục duy trì hoạt động tốt.' };
  }
  if (value >= 60) {
    return { key: 'good', label: 'Khá', tone: 'blue', description: 'Điểm ở mức nền; hãy bổ sung xác thực và hoạt động để tăng điểm.' };
  }
  if (value >= 40) {
    return { key: 'medium', label: 'Trung bình', tone: 'amber', description: 'Cần cải thiện bằng chứng xác thực và lịch sử hoạt động.' };
  }
  return { key: 'low', label: 'Thấp', tone: 'red', description: 'Điểm thấp do vi phạm hoặc thiếu bằng chứng xác thực.' };
}

async function writeScore(db, userId, rows) {
  const { score, breakdown } = scoreFromRows(rows);
  await db.query('update users set trust_score = $1 where id = $2', [score, userId]);
  return { score, breakdown };
}

/**
 * Tính lại điểm của một người dùng từ toàn bộ sự kiện.
 * Hàm nhận `db` là pool hoặc client trong transaction.
 */
export async function recomputeUserTrustScore(db, userId) {
  const { rows } = await db.query(
    `select category,
            coalesce(sum(delta), 0) as total,
            count(*)::int as events
       from trust_events
      where user_id = $1
      group by category`,
    [userId],
  );
  return writeScore(db, userId, rows);
}

/**
 * Ghi một sự kiện tín nhiệm. Idempotent nhờ UNIQUE
 * (user_id, reason, reference_id). Nếu `db` là pool, cả việc ghi sự kiện và
 * cập nhật điểm diễn ra trong cùng một transaction.
 *
 * `upsert: true` dùng cho các sự kiện admin có thể sửa (ví dụ mức phạt báo
 * cáo); khi đó sự kiện cũ được cập nhật thay vì bỏ qua.
 */
export async function applyTrustEvent(db, input) {
  if (!db || db === pool) {
    return withTransaction((client) => applyTrustEvent(client, input));
  }

  const reason = String(input.reason || '').trim();
  const meta = TRUST_REASONS[reason];
  if (!meta) throw new Error(`Lý do tín nhiệm không hợp lệ: ${reason}`);

  const userId = input.userId;
  if (!userId) throw new Error('applyTrustEvent cần userId.');

  const delta = clamp(num(input.delta === undefined ? meta.delta : input.delta), -50, 50);
  if (delta === 0) throw new Error('Mức thay đổi điểm tín nhiệm phải khác 0.');

  const category = input.category || meta.category;
  if (!TRUST_CATEGORIES[category]) throw new Error(`Danh mục tín nhiệm không hợp lệ: ${category}`);

  const referenceId = String(input.referenceId ?? 'once');
  const note = input.note ? String(input.note).slice(0, 1000) : null;
  const source = String(input.source || 'system').slice(0, 20);
  const createdBy = input.createdBy || null;
  const createdAt = input.createdAt ? new Date(input.createdAt) : null;

  const insert = await db.query(
    `insert into trust_events
       (user_id, category, delta, reason, reference_id, note, source, created_by, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, now()))
     on conflict (user_id, reason, reference_id) do ${
       input.upsert
         ? `update set delta = excluded.delta,
                       category = excluded.category,
                       note = excluded.note,
                       source = excluded.source,
                       created_by = excluded.created_by,
                       created_at = excluded.created_at`
         : 'nothing'
     }
     returning *`,
    [userId, category, delta, reason, referenceId, note, source, createdBy, createdAt],
  );

  const applied = insert.rowCount > 0;
  const state = await recomputeUserTrustScore(db, userId);
  return { applied, event: insert.rows[0] || null, ...state };
}

/**
 * Cộng các mốc thâm niên còn thiếu (1 điểm/30 ngày, tối đa 10 mốc).
 */
export async function ensureTenureEvents(db, userId) {
  const run = async (client) => {
    const inserted = await client.query(
      `insert into trust_events
         (user_id, category, delta, reason, reference_id, note, source, created_at)
       select u.id, 'tenure', 1, 'account_age',
              'month-' || gs.month,
              'Thâm niên tài khoản tháng ' || gs.month,
              'system',
              least(now(), u.created_at + (gs.month * interval '30 days'))
         from users u
         cross join lateral generate_series(
           1,
           least(10, floor(extract(epoch from (now() - u.created_at)) / 86400 / 30)::int)
         ) as gs(month)
        where u.id = $1
       on conflict (user_id, reason, reference_id) do nothing
       returning id`,
      [userId],
    );
    if (!inserted.rowCount) return { applied: 0, ...(await recomputeUserTrustScore(client, userId)) };
    return { applied: inserted.rowCount, ...(await recomputeUserTrustScore(client, userId)) };
  };
  return !db || db === pool ? withTransaction(run) : run(db);
}

/**
 * Đồng bộ định kỳ cho toàn bộ người dùng: bổ sung các mốc thâm niên còn thiếu
 * rồi tính lại điểm tổng hợp từ sự kiện. Idempotent, dùng cho scheduler và
 * script vận hành.
 */
export async function syncTrustMetrics(db = pool) {
  const run = async (client) => {
    const inserted = await client.query(
      `insert into trust_events
         (user_id, category, delta, reason, reference_id, note, source, created_at)
       select u.id, 'tenure', 1, 'account_age', 'month-' || gs.month,
              'Thâm niên tài khoản tháng ' || gs.month, 'system',
              least(now(), u.created_at + (gs.month * interval '30 days'))
         from users u
         cross join lateral generate_series(
           1,
           least(10, floor(extract(epoch from (now() - u.created_at)) / 86400 / 30)::int)
         ) as gs(month)
       on conflict (user_id, reason, reference_id) do nothing`,
    );
    const users = await recomputeTrustScores(client);
    return { tenure_events: inserted.rowCount, users };
  };
  return !db || db === pool ? withTransaction(run) : run(db);
}

/** SQL tổng hợp dùng chung cho tính lại toàn bộ người dùng. */
function aggregateSql() {
  const sums = CATEGORY_KEYS.map(
    (key) => `coalesce(sum(case when e.category = '${key}' then e.delta else 0 end), 0) as ${key}`,
  ).join(',\n         ');
  const capped = [
    `least(${TRUST_CATEGORIES.identity.cap}, identity)`,
    `least(${TRUST_CATEGORIES.tenure.cap}, tenure)`,
    `least(${TRUST_CATEGORIES.backing.cap}, backing)`,
    `least(${TRUST_CATEGORIES.owner.cap}, owner)`,
    `least(${TRUST_CATEGORIES.updates.cap}, updates)`,
    'penalty',
    'admin',
    'legacy',
  ].join(' + ');
  const evidenceCapped = capped.replace(' + legacy', '');
  return {
    grouped: `
      select u.id,
             ${sums}
        from users u
        left join trust_events e on e.user_id = u.id
       group by u.id`,
    evidenceCapped,
    scoreExpr: `greatest(0, least(100, ${TRUST_BASE_SCORE} + ${capped}))`,
    evidenceExpr: `greatest(0, least(100, ${TRUST_BASE_SCORE} + ${evidenceCapped}))`,
  };
}

/**
 * Tính lại `users.trust_score` cho toàn bộ người dùng từ sự kiện hiện có.
 * Trả về số tài khoản đã cập nhật.
 */
export async function recomputeTrustScores(db) {
  const { grouped, scoreExpr } = aggregateSql();
  const { rows } = await db.query(
    `with grouped as (${grouped})
     update users u
        set trust_score = ${scoreExpr}
       from grouped g
      where g.id = u.id
      returning u.id`,
  );
  return rows.length;
}

/**
 * Bảo toàn điểm hiện tại bằng một sự kiện legacy duy nhất cho mỗi người dùng.
 * Chạy sau backfill để dữ liệu seed/demo giữ nguyên điểm đang trình bày.
 */
export async function preserveTrustScores(db) {
  const { grouped, evidenceExpr } = aggregateSql();
  const { rows } = await db.query(
    `with grouped as (${grouped}),
     evidence as (
       select u.id, u.trust_score, ${evidenceExpr} as evidence_score
         from users u join grouped g on g.id = u.id
     )
     insert into trust_events
       (user_id, category, delta, reason, reference_id, note, source, created_at)
     select id, 'legacy', trust_score - evidence_score, 'legacy_adjustment', 'initial',
            'Bảo toàn điểm tín nhiệm trước khi chuyển sang tính theo bằng chứng',
            'migration', now()
       from evidence
      where trust_score <> evidence_score
     on conflict (user_id, reason, reference_id) do nothing
     returning id`,
  );
  return rows.length;
}

/**
 * Sinh sự kiện từ bằng chứng sẵn có trong database: email, KYC, hồ sơ,
 * tài trợ, chiến dịch hoàn thành, cập nhật đúng hạn, vi phạm và gian lận.
 * Idempotent — có thể chạy nhiều lần.
 */
export async function backfillTrustEvents(db) {
  const result = {};

  const statements = [
    [
      'email_verified',
      `insert into trust_events
         (user_id, category, delta, reason, reference_id, note, source, created_at)
       select id, 'identity', 5, 'email_verified', 'once', 'Xác thực email', 'migration',
              email_verified_at
         from users
        where email_verified_at is not null
       on conflict (user_id, reason, reference_id) do nothing`,
    ],
    [
      'kyc_verified',
      `insert into trust_events
         (user_id, category, delta, reason, reference_id, note, source, created_at)
       select id, 'identity', 5, 'kyc_verified', 'once', 'Xác thực danh tính (KYC)', 'migration',
              coalesce(kyc_verified_at, updated_at)
         from users
        where kyc_status = 'verified'
       on conflict (user_id, reason, reference_id) do nothing`,
    ],
    [
      'profile_completed',
      `insert into trust_events
         (user_id, category, delta, reason, reference_id, note, source, created_at)
       select id, 'identity', 5, 'profile_completed', 'once',
              'Hoàn thiện hồ sơ (ảnh đại diện + số điện thoại)', 'migration',
              coalesce(updated_at, created_at)
         from users
        where phone is not null and btrim(phone) <> ''
          and avatar_url is not null and btrim(avatar_url) <> ''
       on conflict (user_id, reason, reference_id) do nothing`,
    ],
    [
      'tenure',
      `insert into trust_events
         (user_id, category, delta, reason, reference_id, note, source, created_at)
       select u.id, 'tenure', 1, 'account_age', 'month-' || gs.month,
              'Thâm niên tài khoản tháng ' || gs.month, 'migration',
              least(now(), u.created_at + (gs.month * interval '30 days'))
         from users u
         cross join lateral generate_series(
           1,
           least(10, floor(extract(epoch from (now() - u.created_at)) / 86400 / 30)::int)
         ) as gs(month)
       on conflict (user_id, reason, reference_id) do nothing`,
    ],
    [
      'pledge_paid',
      `insert into trust_events
         (user_id, category, delta, reason, reference_id, note, source, created_at)
       select pl.backer_id, 'backing', 1, 'pledge_paid', pl.id::text,
              'Tài trợ cho dự án “' || p.title || '”', 'migration',
              coalesce(pl.updated_at, pl.created_at)
         from pledges pl
         join projects p on p.id = pl.project_id
        where pl.status = 'paid'
       on conflict (user_id, reason, reference_id) do nothing`,
    ],
    [
      'campaign_completed',
      `insert into trust_events
         (user_id, category, delta, reason, reference_id, note, source, created_at)
       select p.owner_id, 'owner', 5, 'campaign_completed', p.id::text,
              'Hoàn thành chiến dịch “' || p.title || '”', 'migration',
              coalesce(p.completed_at, p.updated_at)
         from projects p
        where p.status in ('successful', 'awaiting_disbursement', 'disbursed', 'in_progress')
       on conflict (user_id, reason, reference_id) do nothing`,
    ],
    [
      'progress_update_on_time',
      `insert into trust_events
         (user_id, category, delta, reason, reference_id, note, source, created_at)
       select p.owner_id, 'updates', 2, 'progress_update_on_time', pu.id::text,
              'Cập nhật “' || pu.title || '” đúng hạn', 'migration', pu.created_at
         from project_updates pu
         join projects p on p.id = pu.project_id
        where pu.created_at < (p.end_date + interval '1 day')
          and p.status in ('active', 'successful', 'awaiting_disbursement', 'disbursed', 'in_progress')
       on conflict (user_id, reason, reference_id) do nothing`,
    ],
    [
      'report_violation',
      `insert into trust_events
         (user_id, category, delta, reason, reference_id, note, source, created_at)
       select p.owner_id, 'penalty', -r.penalty_points, 'report_violation', r.id::text,
              r.reason, 'migration', coalesce(r.reviewed_at, r.created_at)
         from reports r
         join projects p on p.id = r.project_id
        where r.penalty_points > 0 and r.status = 'closed'
       on conflict (user_id, reason, reference_id) do nothing`,
    ],
    [
      'fraud_user',
      `insert into trust_events
         (user_id, category, delta, reason, reference_id, note, source, created_at)
       select f.entity_id, 'penalty', -30, 'fraud_confirmed', 'fraud-' || f.id,
              'Gian lận được xác nhận: ' || f.reason, 'migration',
              coalesce(f.reviewed_at, f.flagged_at)
         from fraud_flags f
        where f.review_status = 'confirmed' and f.entity_type = 'user'
       on conflict (user_id, reason, reference_id) do nothing`,
    ],
    [
      'fraud_project',
      `insert into trust_events
         (user_id, category, delta, reason, reference_id, note, source, created_at)
       select p.owner_id, 'penalty', -30, 'fraud_confirmed', 'fraud-' || f.id,
              'Gian lận được xác nhận: ' || f.reason, 'migration',
              coalesce(f.reviewed_at, f.flagged_at)
         from fraud_flags f
         join projects p on p.id = f.entity_id
        where f.review_status = 'confirmed' and f.entity_type = 'project'
       on conflict (user_id, reason, reference_id) do nothing`,
    ],
    [
      'fraud_pledge',
      `insert into trust_events
         (user_id, category, delta, reason, reference_id, note, source, created_at)
       select pl.backer_id, 'penalty', -30, 'fraud_confirmed', 'fraud-' || f.id,
              'Gian lận được xác nhận: ' || f.reason, 'migration',
              coalesce(f.reviewed_at, f.flagged_at)
         from fraud_flags f
         join pledges pl on pl.id = f.entity_id
        where f.review_status = 'confirmed' and f.entity_type = 'pledge'
       on conflict (user_id, reason, reference_id) do nothing`,
    ],
  ];

  for (const [key, sql] of statements) {
    const { rowCount } = await db.query(sql);
    result[key] = rowCount;
  }
  return result;
}

function buildActions(user, breakdown, reasonCounts) {
  const byCategory = Object.fromEntries(breakdown.map((item) => [item.key, item]));
  const byReason = Object.fromEntries(reasonCounts.map((row) => [row.reason, row]));
  const done = (reason) => Number(byReason[reason]?.total || 0) > 0;

  const identityPoints = byCategory.identity?.applied || 0;
  const backingPoints = byCategory.backing?.applied || 0;
  const ownerPoints = byCategory.owner?.applied || 0;
  const updatePoints = byCategory.updates?.applied || 0;
  const tenurePoints = byCategory.tenure?.applied || 0;

  return [
    {
      key: 'email_verified',
      label: 'Xác thực email',
      description: 'Cộng ngay 5 điểm khi email được xác thực.',
      points: 5,
      category: 'identity',
      done: Boolean(user.email_verified_at) || done('email_verified'),
      available: !user.email_verified_at,
      automatic: false,
    },
    {
      key: 'kyc_verified',
      label: 'Xác thực danh tính (KYC)',
      description: 'Gửi hồ sơ CCCD/hộ chiếu và xác thực email KYC để cộng 5 điểm.',
      points: 5,
      category: 'identity',
      done: user.kyc_status === 'verified' || done('kyc_verified'),
      available: user.kyc_status !== 'verified',
      automatic: false,
    },
    {
      key: 'profile_completed',
      label: 'Hoàn thiện hồ sơ',
      description: 'Thêm ảnh đại diện và số điện thoại để cộng 5 điểm.',
      points: 5,
      category: 'identity',
      done: Boolean(user.phone && user.avatar_url) || done('profile_completed'),
      available: !(user.phone && user.avatar_url),
      automatic: false,
    },
    {
      key: 'account_age',
      label: 'Thâm niên tài khoản',
      description: 'Tự động cộng 1 điểm mỗi 30 ngày, tối đa 10 điểm.',
      points: 1,
      category: 'tenure',
      current: tenurePoints,
      cap: TRUST_CATEGORIES.tenure.cap,
      done: tenurePoints >= TRUST_CATEGORIES.tenure.cap,
      available: tenurePoints < TRUST_CATEGORIES.tenure.cap,
      automatic: true,
    },
    {
      key: 'pledge_paid',
      label: 'Tài trợ thành công',
      description: 'Mỗi khoản tài trợ đã thanh toán cộng 1 điểm, tối đa 10 điểm.',
      points: 1,
      category: 'backing',
      current: backingPoints,
      cap: TRUST_CATEGORIES.backing.cap,
      done: backingPoints >= TRUST_CATEGORIES.backing.cap,
      available: backingPoints < TRUST_CATEGORIES.backing.cap,
      automatic: false,
    },
    {
      key: 'campaign_completed',
      label: 'Hoàn thành chiến dịch',
      description: 'Mỗi chiến dịch do bạn sở hữu đạt mục tiêu cộng 5 điểm, tối đa 15 điểm.',
      points: 5,
      category: 'owner',
      current: ownerPoints,
      cap: TRUST_CATEGORIES.owner.cap,
      done: ownerPoints >= TRUST_CATEGORIES.owner.cap,
      available: ownerPoints < TRUST_CATEGORIES.owner.cap,
      automatic: false,
    },
    {
      key: 'progress_update_on_time',
      label: 'Cập nhật tiến độ đúng hạn',
      description: 'Mỗi bản tin tiến độ đăng trước ngày kết thúc cộng 2 điểm, tối đa 10 điểm.',
      points: 2,
      category: 'updates',
      current: updatePoints,
      cap: TRUST_CATEGORIES.updates.cap,
      done: updatePoints >= TRUST_CATEGORIES.updates.cap,
      available: updatePoints < TRUST_CATEGORIES.updates.cap,
      automatic: false,
    },
  ].filter((action) => {
    // Danh tính đã đủ 15 điểm thì không cần hiển thị thêm mục đã hoàn thành.
    if (action.category === 'identity' && identityPoints >= TRUST_CATEGORIES.identity.cap) return false;
    return true;
  });
}

/**
 * Trả về điểm, phân rã theo danh mục, lịch sử gần đây và các việc có thể làm
 * để tăng điểm. Được dùng cho cả trang cá nhân và trang quản trị.
 */
export async function getTrustDetail(db, userId, { eventLimit = 30, includeActor = false } = {}) {
  await ensureTenureEvents(db, userId);

  const userResult = await db.query(
    `select id, full_name, email, phone, avatar_url, role, kyc_status, status,
            trust_score, email_verified_at, created_at
       from users where id = $1`,
    [userId],
  );
  const user = userResult.rows[0];
  if (!user) return null;

  const state = await recomputeUserTrustScore(db, userId);
  const events = await db.query(
    `select e.id, e.category, e.delta, e.reason, e.reference_id, e.note, e.source,
            e.created_by, e.created_at,
            u.full_name as created_by_name, u.email as created_by_email
       from trust_events e
       left join users u on u.id = e.created_by
      where e.user_id = $1
      order by e.created_at desc, e.id desc
      limit $2`,
    [userId, Math.max(1, Math.min(200, Number(eventLimit) || 30))],
  );
  const reasonCounts = await db.query(
    `select reason, count(*)::int as total, coalesce(sum(delta), 0) as delta
       from trust_events
      where user_id = $1
      group by reason`,
    [userId],
  );
  const totals = await db.query(
    `select coalesce(sum(delta), 0) as total, count(*)::int as total_events
       from trust_events where user_id = $1`,
    [userId],
  );

  const level = trustLevel(state.score);
  return {
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      kyc_status: user.kyc_status,
      status: user.status,
      trust_score: state.score,
      email_verified: Boolean(user.email_verified_at),
      created_at: user.created_at,
      account_days: Math.max(
        0,
        Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86_400_000),
      ),
    },
    score: state.score,
    base_score: TRUST_BASE_SCORE,
    level,
    breakdown: state.breakdown,
    actions: buildActions(user, state.breakdown, reasonCounts.rows),
    events: events.rows.map((event) => ({
      ...event,
      delta: num(event.delta),
      label: TRUST_REASONS[event.reason]?.label || event.reason,
      category_label: TRUST_CATEGORIES[event.category]?.label || event.category,
      created_by_name: includeActor ? event.created_by_name : undefined,
      created_by_email: includeActor ? event.created_by_email : undefined,
    })),
    totals: {
      events: Number(totals.rows[0]?.total_events || 0),
      delta: num(totals.rows[0]?.total),
    },
  };
}

/** Danh sách lý do để route kiểm tra đầu vào. */
export const TRUST_REASON_LIST = REASON_KEYS;
