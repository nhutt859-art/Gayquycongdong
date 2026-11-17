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

  const duplicates = await client.query(`
    select gateway_ref, count(*)::int as total
      from transactions
     where type = 'payment' and gateway_ref is not null
     group by gateway_ref
    having count(*) > 1
     order by total desc
     limit 20
  `);

  if (duplicates.rowCount) {
    console.error('❌ Có gateway_ref bị trùng, không thể tạo unique index:');
    for (const row of duplicates.rows) {
      console.error(`   - ${row.gateway_ref}: ${row.total} giao dịch`);
    }
    throw new Error('Cần xử lý gateway_ref trùng trước khi chạy migration.');
  }

  const sql = await fs.readFile(path.join(here, '..', 'db', 'migrate-vnpay.sql'), 'utf8');
  console.log('Đang chạy migration thanh toán VNPay...');
  await client.query(sql);

  const counts = await client.query(`
    select status, count(*)::int as total
      from transactions
     where type = 'payment'
     group by status
     order by status
  `);
  console.log('📊 Giao dịch thanh toán theo trạng thái:');
  for (const row of counts.rows) {
    console.log(`   - ${row.status}: ${row.total}`);
  }

  const column = await client.query(`
    select column_name
      from information_schema.columns
     where table_name = 'transactions' and column_name = 'gateway_payload'
  `);
  console.log(column.rowCount ? '✅ Đã có cột transactions.gateway_payload' : '⚠️  Chưa thấy cột gateway_payload');
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
