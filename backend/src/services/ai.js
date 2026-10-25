import { query, withTransaction } from '../db.js';
import { mapProject } from '../lib/mappers.js';

const CATEGORY_BONUS = {
  'Giáo dục': 12,
  'Y tế': 8,
  'Môi trường': 6,
  'Văn hoá': 4,
  'Khởi nghiệp': -4,
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

/**
 * Heuristic dự đoán khả năng thành công (0–100).
 * Đây là mô hình rule-based phục vụ đồ án, không phải ML thật.
 */
export function predictSuccess({ goalAmount, categoryName, rewardsCount = 0, description = '', durationDays = 45 }) {
  let score = 55;
  score += CATEGORY_BONUS[categoryName] ?? 0;
  if (goalAmount <= 150_000_000) score += 12;
  else if (goalAmount <= 300_000_000) score += 8;
  else if (goalAmount <= 500_000_000) score += 3;
  else if (goalAmount <= 800_000_000) score -= 6;
  else score -= 14;

  if (rewardsCount >= 3) score += 7;
  else if (rewardsCount === 2) score += 4;
  else if (rewardsCount === 0) score -= 5;

  if (description.length >= 220) score += 6;
  else if (description.length >= 120) score += 3;
  else if (description.length < 60) score -= 6;

  if (durationDays <= 60) score += 3;
  else if (durationDays > 120) score -= 6;

  return Math.round(clamp(score, 5, 95));
}

export function fraudScoreForProject({ goalAmount, trustScore = 60, kycStatus = 'none', description = '' }) {
  let score = 8;
  if (goalAmount > 800_000_000) score += 12;
  if (goalAmount > 2_000_000_000) score += 10;
  if (kycStatus !== 'verified') score += 20;
  if (Number(trustScore) < 40) score += 22;
  if (/lợi nhuận|cam kết|siêu lợi/i.test(description)) score += 15;
  if (/50\s*%|100\s*%/i.test(description)) score += 10;
  return Math.round(clamp(score, 0, 98));
}

export function fraudScoreForPledge({ amount, isAnonymous, trustScore = 60, recentCount = 1 }) {
  let score = 10;
  if (Number(amount) >= 50_000_000) score += 18;
  if (Number(amount) >= 200_000_000) score += 18;
  if (isAnonymous && Number(amount) >= 50_000_000) score += 12;
  if (Number(trustScore) < 40) score += 22;
  if (recentCount >= 4) score += 30;
  else if (recentCount >= 2) score += 12;
  return Math.round(clamp(score, 0, 98));
}

/**
 * Tính điểm gợi ý cho user, lưu lại vào ai_recommendations rồi trả về.
 */
export async function refreshRecommendations(userId, limit = 6) {
  const { rows } = await query(
    `select p.*, c.name as category_name, u.full_name as owner_name,
            round(least(1, greatest(0,
              0.55 * coalesce(ui.weight, 0)
              + 0.25 * (p.current_amount::numeric / p.goal_amount)
              + 0.20 * (p.ai_success_score::numeric / 100)
              + 0.10 * least(1, coalesce(pc.cnt, 0)::numeric / 3)
            ))::numeric, 3) as score
       from projects p
       join categories c on c.id = p.category_id
       join users u on u.id = p.owner_id
       left join user_interests ui
              on ui.user_id = $1 and ui.category_id = p.category_id
       left join (
         select pr.category_id, count(*)::int as cnt
           from pledges pl
           join projects pr on pr.id = pl.project_id
          where pl.backer_id = $1 and pl.status = 'paid'
          group by pr.category_id
       ) pc on pc.category_id = p.category_id
      where p.status = 'active'
        and p.owner_id <> $1
      order by score desc, p.created_at desc
      limit $2`,
    [userId, limit],
  );

  if (!rows.length) return [];

  await withTransaction(async (client) => {
    for (const row of rows) {
      await client.query(
        `insert into ai_recommendations (user_id, project_id, score, generated_at)
         values ($1, $2, $3, now())
         on conflict (user_id, project_id)
         do update set score = excluded.score, generated_at = now()`,
        [userId, row.id, row.score],
      );
    }
  });

  return rows.map((row) => ({ ...mapProject(row), score: Number(row.score) }));
}

export async function savePrediction(db, projectId, probability, features) {
  await db.query(
    `insert into ai_predictions (project_id, success_probability, model_version, features_snapshot)
     values ($1, $2, 'v2.3', $3::jsonb)`,
    [projectId, probability, JSON.stringify(features)],
  );
}
