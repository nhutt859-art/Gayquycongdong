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

  const sql = await fs.readFile(path.join(here, '..', 'db', 'migrate-trust.sql'), 'utf8');
  console.log('Đang chạy migration điểm tín nhiệm...');
  await client.query(sql);

  const table = await client.query(`
    select column_name, data_type
      from information_schema.columns
     where table_name = 'trust_events'
     order by ordinal_position
  `);
  console.log(`✅ trust_events có ${table.rowCount} cột.`);

  const reportColumns = await client.query(`
    select column_name
      from information_schema.columns
     where table_name = 'reports' and column_name in ('penalty_points', 'reviewed_by')
     order by column_name
  `);
  console.log(`✅ reports bổ sung: ${reportColumns.rows.map((row) => row.column_name).join(', ') || '(không có)'}`);

  const count = await client.query('select count(*)::int as total from trust_events');
  console.log(`📊 Số sự kiện tín nhiệm hiện có: ${count.rows[0].total}`);
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
