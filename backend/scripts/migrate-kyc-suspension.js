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
  const sql = await fs.readFile(path.join(here, '..', 'db', 'migrate-kyc-suspension.sql'), 'utf8');
  console.log('Đang chạy migration KYC + tạm ngưng dự án...');
  await client.query(sql);

  const columns = await client.query(`
    select table_name, column_name
      from information_schema.columns
     where table_schema = 'public'
       and ((table_name = 'users' and column_name like 'kyc_%')
         or (table_name = 'projects' and column_name = 'suspended_from_status')
         or (table_name = 'project_updates' and column_name = 'image_urls'))
     order by table_name, column_name
  `);
  console.log(`✅ Đã có ${columns.rowCount} cột KYC/tạm ngưng.`);

  const enumValues = await client.query(`
    select enumlabel
      from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'project_status'
     order by enumsortorder
  `);
  console.log(`   project_status: ${enumValues.rows.map((r) => r.enumlabel).join(', ')}`);
}

run()
  .catch((err) => {
    console.error('❌ Migration KYC/tạm ngưng thất bại:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => {});
  });
