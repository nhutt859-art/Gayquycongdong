import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;
const seedOnly = process.argv.includes('--seed-only');

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const sslDisabled = String(process.env.PGSSL || 'require').toLowerCase() === 'disable';

function mask(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(không đọc được URL)';
  }
}

if (!connectionString) {
  console.error('\n❌ Thiếu DATABASE_URL (hoặc DIRECT_URL) trong file .env');
  console.error('   Copy .env.example -> .env rồi dán chuỗi kết nối Neon vào.\n');
  process.exit(1);
}

const client = new Client({
  connectionString,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
});

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

async function run() {
  console.log(`\n🔌 Kết nối: ${mask(connectionString)}`);
  await client.connect();

  const { rows } = await client.query('select version(), current_database() as db, current_user as usr');
  console.log(`✅ Đã kết nối ${rows[0].db} — ${rows[0].usr}`);
  console.log(`   ${rows[0].version.split(' on ')[0]}`);

  if (!seedOnly) {
    const schema = await fs.readFile(path.join(here, '..', 'db', 'schema.sql'), 'utf8');
    console.log('🏗️  Đang tạo schema (16 bảng)...');
    await client.query(schema);
    console.log('✅ Schema xong.');
  }

  const seed = await fs.readFile(path.join(here, '..', 'db', 'seed.sql'), 'utf8');
  console.log('🌱 Đang nạp dữ liệu mẫu (10 dự án)...');
  await client.query(seed);
  console.log('✅ Seed xong.');

  const counts = await client.query(`
    select
      (select count(*) from users)::int      as users,
      (select count(*) from categories)::int as categories,
      (select count(*) from projects)::int   as projects,
      (select count(*) from rewards)::int    as rewards,
      (select count(*) from pledges)::int    as pledges,
      (select count(*) from transactions)::int as transactions
  `);
  const c = counts.rows[0];
  console.log(`\n📊 users=${c.users}  categories=${c.categories}  projects=${c.projects}  rewards=${c.rewards}  pledges=${c.pledges}  transactions=${c.transactions}`);

  const projects = await client.query('select title, status, current_amount, goal_amount from projects order by created_at limit 10');
  console.log('\n📁 10 dự án:');
  for (const p of projects.rows) {
    console.log(`   • [${p.status}] ${p.title} — ${Number(p.current_amount).toLocaleString('vi-VN')}/${Number(p.goal_amount).toLocaleString('vi-VN')}đ`);
  }
  console.log('\n🎉 Hoàn tất. Chạy tiếp: npm run dev\n');
}

run()
  .catch((err) => {
    console.error('\n❌ Lỗi khi khởi tạo database:');
    console.error(`   ${err.message}`);
    if (err.code === 'ECONNREFUSED') console.error('   → Kiểm tra PostgreSQL đã chạy và đúng host/port.');
    if (err.code === '28P01') console.error('   → Sai mật khẩu trong DATABASE_URL.');
    if (err.code === 'ENOTFOUND') console.error('   → Sai host Neon (copy lại connection string).');
    if (String(err.message).includes('self-signed')) console.error('   → Đặt PGSSL=require trong .env.');
    console.error('');
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => {});
  });
