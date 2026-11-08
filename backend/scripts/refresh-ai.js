import 'dotenv/config';
import { query, closePool } from '../src/db.js';
import { trainModel, predictAllProjects } from '../src/services/ai-model.js';
import { refreshRecommendations } from '../src/services/ai.js';

/**
 * Huấn luyện lại mô hình và làm mới dự báo/gợi ý mà không xoá dữ liệu.
 * Dùng sau khi đổi feature set hoặc thêm dự án lịch sử mới.
 */
async function run() {
  console.log('Đang huấn luyện lại mô hình...');
  const model = await trainModel({ persist: true });
  console.log(`Mô hình ${model.version}: ${model.sample_size} mẫu, AUC=${model.metrics?.auc ?? 'n/a'}, accuracy=${model.metrics?.accuracy ?? 'n/a'}`);

  console.log('Đang tạo lại dự báo cho toàn bộ dự án...');
  const predictions = await predictAllProjects();
  const projectMeta = await query('select id, created_at, status from projects');
  const metaMap = new Map(projectMeta.rows.map((row) => [row.id, row]));

  await query('delete from ai_predictions');
  for (const { project_id, prediction, status } of predictions) {
    const meta = metaMap.get(project_id);
    const historical = ['successful', 'failed'].includes(status);
    await query(
      `insert into ai_predictions
         (project_id, success_probability, label, confidence, model_version,
          features_snapshot, contributions, model_metrics, predicted_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)`,
      [
        project_id,
        prediction.score,
        prediction.label,
        prediction.confidence,
        prediction.model.version,
        JSON.stringify({ ...prediction.features_snapshot, evaluation: historical ? 'backtest' : 'live' }),
        JSON.stringify(prediction.contributions),
        JSON.stringify(prediction.model.metrics),
        historical ? meta?.created_at ?? new Date() : new Date(),
      ],
    );
    await query('update projects set ai_success_score = $1 where id = $2', [prediction.score, project_id]);
  }

  console.log('Đang tạo lại gợi ý cho nhóm người dùng mẫu...');
  const users = await query(
    `select id from users
      where role in ('backer', 'owner') and status = 'active'
      order by case when email like '%@gayquy.vn' then 0 else 1 end, created_at desc
      limit 48`,
  );
  await query('delete from ai_recommendations');
  for (const user of users.rows) {
    try {
      await refreshRecommendations(user.id, 8);
    } catch (err) {
      console.warn(`Không tạo được gợi ý cho ${user.id}: ${err.message}`);
    }
  }

  const counts = await query(`
    select
      (select count(*) from ai_predictions)::int as predictions,
      (select count(*) from ai_recommendations)::int as recommendations,
      (select count(*) from ai_model_versions where is_active)::int as active_models
  `);
  console.log('AI:', JSON.stringify(counts.rows[0]));
}

run()
  .catch((err) => {
    console.error('Làm mới AI thất bại:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => {});
  });
