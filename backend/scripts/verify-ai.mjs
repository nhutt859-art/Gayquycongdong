import 'dotenv/config';
import { query, closePool } from '../src/db.js';

const model = await query(
  `select version, sample_size, positive_count, metrics, coefficients, trained_at
     from ai_model_versions where is_active order by trained_at desc limit 1`,
);
console.log('ACTIVE MODEL:', JSON.stringify(model.rows[0], null, 2));

const versions = await query(
  `select model_version, count(*)::int as n from ai_predictions group by model_version order by n desc`,
);
console.log('PREDICTION VERSIONS:', versions.rows);

const pred = await query(
  `select p.title, p.status, a.success_probability, a.label, a.confidence,
          a.contributions, a.model_metrics
     from ai_predictions a join projects p on p.id = a.project_id
    order by a.success_probability desc limit 1`,
);
console.log('TOP PREDICTION:', JSON.stringify(pred.rows[0], null, 2));

const rec = await query(
  `select u.email, p.title, r.score, r.reason, r.score_breakdown
     from ai_recommendations r
     join users u on u.id = r.user_id
     join projects p on p.id = r.project_id
    order by r.score desc limit 3`,
);
console.log('TOP RECOMMENDATIONS:', JSON.stringify(rec.rows, null, 2));

const flags = await query(
  `select entity_type, risk_score, model_version, evidence from fraud_flags order by risk_score desc limit 3`,
);
console.log('FRAUD FLAGS:', JSON.stringify(flags.rows, null, 2));

const counts = await query(`
  select
    (select count(*) from users)::int as users,
    (select count(*) from projects)::int as projects,
    (select count(*) from projects where status = 'successful')::int as successful,
    (select count(*) from projects where status = 'failed')::int as failed,
    (select count(*) from ai_predictions)::int as predictions,
    (select count(*) from ai_recommendations)::int as recommendations,
    (select count(*) from fraud_flags)::int as fraud_flags
`);
console.log('COUNTS:', counts.rows[0]);

await closePool();
