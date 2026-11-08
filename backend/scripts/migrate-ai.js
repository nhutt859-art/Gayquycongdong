import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const sslDisabled = String(process.env.PGSSL || 'require').toLowerCase() === 'disable';

if (!connectionString) {
  console.error('Thiếu DATABASE_URL (hoặc DIRECT_URL) trong backend/.env');
  process.exit(1);
}

const client = new Client({
  connectionString,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
});

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

async function run() {
  await client.connect();
  const sql = await fs.readFile(path.join(here, '..', 'db', 'migrate-ai.sql'), 'utf8');
  console.log('Đang chạy migration AI...');
  await client.query(sql);
  const columns = await client.query(`
    select table_name, column_name
      from information_schema.columns
     where table_schema = 'public'
       and ((table_name = 'ai_predictions' and column_name in ('label','confidence','contributions','model_metrics'))
         or (table_name = 'ai_recommendations' and column_name in ('reason','score_breakdown'))
         or (table_name = 'fraud_flags' and column_name in ('evidence','model_version')))
     order by table_name, column_name
  `);
  console.log(`Đã thêm/cập nhật ${columns.rowCount} cột AI.`);
  const modelTable = await client.query(`select to_regclass('public.ai_model_versions') as table_name`);
  console.log(`Bảng ai_model_versions: ${modelTable.rows[0]?.table_name || 'chưa có'}`);
}

run()
  .catch((err) => {
    console.error('Migration AI thất bại:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => {});
  });
