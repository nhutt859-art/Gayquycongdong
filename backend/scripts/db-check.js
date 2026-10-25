import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error('\n❌ Chưa có DATABASE_URL trong .env\n');
  process.exit(1);
}

const masked = (() => {
  try {
    const u = new URL(connectionString);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(invalid url)';
  }
})();

const client = new Client({
  connectionString,
  ssl: String(process.env.PGSSL || 'require').toLowerCase() === 'disable' ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
});

const TABLES = [
  'users', 'categories', 'projects', 'project_collaborators', 'rewards', 'pledges',
  'transactions', 'project_updates', 'comments', 'user_interests', 'ai_recommendations',
  'ai_predictions', 'fraud_flags', 'reports', 'notifications', 'follows',
];

try {
  console.log(`\n🔌 ${masked}`);
  await client.connect();
  const meta = await client.query('select version(), current_database() as db, current_user as usr, now() as now');
  console.log(`✅ Kết nối thành công — db=${meta.rows[0].db}, user=${meta.rows[0].usr}`);
  console.log(`   ${meta.rows[0].version.split(' on ')[0]}`);
  console.log(`   Giờ server: ${meta.rows[0].now.toISOString()}`);

  const existing = await client.query(`
    select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name
  `);
  const names = existing.rows.map((r) => r.table_name);
  const missing = TABLES.filter((t) => !names.includes(t));

  console.log(`\n📋 Bảng trong public: ${names.length}`);
  if (missing.length) {
    console.log(`⚠️  Thiếu ${missing.length} bảng: ${missing.join(', ')}`);
    console.log('   → Chạy: npm run db:setup');
  } else {
    console.log('✅ Đủ 16 bảng theo thiết kế.');
  }

  if (!missing.length) {
    const counts = await client.query(`
      select
        (select count(*) from users)::int as users,
        (select count(*) from categories)::int as categories,
        (select count(*) from projects)::int as projects,
        (select count(*) from rewards)::int as rewards,
        (select count(*) from pledges)::int as pledges,
        (select count(*) from transactions)::int as transactions,
        (select count(*) from comments)::int as comments,
        (select count(*) from notifications)::int as notifications
    `);
    console.log('\n📊 Số dòng:');
    for (const [k, v] of Object.entries(counts.rows[0])) console.log(`   ${k.padEnd(14)} ${v}`);

    const trg = await client.query(`select tgname from pg_trigger where tgname = 'pledges_refresh_aggregates'`);
    console.log(`\n⚙️  Trigger đồng bộ tiền: ${trg.rowCount ? 'OK' : 'THIẾU'}`);

    if (counts.rows[0].projects > 0) {
      const projects = await client.query('select title, status, current_amount, goal_amount from projects order by created_at');
      console.log('\n📁 Dự án:');
      for (const p of projects.rows) {
        const pct = Math.round((Number(p.current_amount) / Number(p.goal_amount)) * 100);
        console.log(`   • [${p.status}] ${p.title} — ${Number(p.current_amount).toLocaleString('vi-VN')}/${Number(p.goal_amount).toLocaleString('vi-VN')}đ (${pct}%)`);
      }
    }
  }
  console.log('');
} catch (err) {
  console.error(`\n❌ Không kết nối được: ${err.message}`);
  console.error('   Kiểm tra: DATABASE_URL, mật khẩu, PGSSL, host Neon.\n');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
