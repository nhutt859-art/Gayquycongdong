import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const sslDisabled = String(process.env.PGSSL || 'require').toLowerCase() === 'disable';

if (!connectionString) {
  console.error('❌ Thiếu DIRECT_URL/DATABASE_URL trong backend/.env');
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
});

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

async function run() {
  await client.connect();
  const sql = await fs.readFile(
    path.join(here, '..', 'db', 'migrate-disbursement-statuses.sql'),
    'utf8',
  );
  console.log('Đang chạy migration trạng thái chờ giải ngân / đã giải ngân...');
  await client.query(sql);

  const counts = await client.query(`
    select status, count(*)::int as total
      from projects
     group by status
     order by status
  `);
  console.log('📊 Trạng thái dự án sau migration:');
  for (const row of counts.rows) {
    console.log(`   - ${row.status}: ${row.total}`);
  }

  const payouts = await client.query(`
    select status, count(*)::int as total
      from transactions
     where type = 'payout'
     group by status
     order by status
  `);
  console.log('💰 Giao dịch giải ngân:');
  for (const row of payouts.rows) {
    console.log(`   - ${row.status}: ${row.total}`);
  }
}

run()
  .then(() => {
    console.log('✅ Migration hoàn tất.');
  })
  .catch((err) => {
    console.error('❌ Migration thất bại:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => {});
  });
