import 'dotenv/config';
import pg from 'pg';
import {
  backfillTrustEvents,
  preserveTrustScores,
  recomputeTrustScores,
} from '../src/services/trust.js';

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const sslDisabled = String(process.env.PGSSL || 'require').toLowerCase() === 'disable';
const preserve = process.argv.includes('--preserve');
const noBackfill = process.argv.includes('--no-backfill');

if (!connectionString) {
  console.error('❌ Thiếu DIRECT_URL/DATABASE_URL trong backend/.env');
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
});

async function run() {
  await client.connect();
  await client.query('BEGIN');

  let backfill = null;
  if (!noBackfill) {
    console.log('🧾 Đang sinh sự kiện tín nhiệm từ bằng chứng sẵn có...');
    backfill = await backfillTrustEvents(client);
    const total = Object.values(backfill).reduce((sum, value) => sum + value, 0);
    console.log(`   Đã thêm ${total} sự kiện mới:`);
    for (const [key, value] of Object.entries(backfill)) {
      if (value > 0) console.log(`   - ${key}: ${value}`);
    }
  } else {
    console.log('⏭️  Bỏ qua backfill (--no-backfill).');
  }

  if (preserve) {
    console.log('🔒 Đang bảo toàn điểm hiện tại bằng sự kiện legacy...');
    const legacy = await preserveTrustScores(client);
    console.log(`   Đã tạo ${legacy} sự kiện legacy_adjustment.`);
  }

  console.log('🔄 Đang tính lại điểm tín nhiệm cho toàn bộ người dùng...');
  const updated = await recomputeTrustScores(client);
  console.log(`   Đã cập nhật ${updated} tài khoản.`);

  await client.query('COMMIT');

  const stats = await client.query(`
    select
      (select count(*) from trust_events)::int as events,
      (select count(distinct user_id) from trust_events)::int as users,
      round(avg(trust_score)::numeric, 1) as avg_score,
      min(trust_score) as min_score,
      max(trust_score) as max_score
    from users
  `);
  const row = stats.rows[0];
  console.log(
    `📊 ${row.events} sự kiện · ${row.users} người dùng có sự kiện · điểm TB ${row.avg_score} (${row.min_score}–${row.max_score})`,
  );
}

run()
  .then(() => {
    console.log('✅ Hoàn tất tính lại điểm tín nhiệm.');
  })
  .catch(async (err) => {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Thất bại:', err.message);
    if (err.message.includes('penalty_points')) {
      console.error('   → Hãy chạy npm run db:migrate-trust trước.');
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => {});
  });
