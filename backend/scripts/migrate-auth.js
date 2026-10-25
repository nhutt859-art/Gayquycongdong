import 'dotenv/config';
import pg from 'pg';

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ Thiếu DIRECT_URL/DATABASE_URL trong backend/.env');
  process.exit(1);
}

const sslDisabled = String(process.env.PGSSL || 'require').toLowerCase() === 'disable';
const client = new pg.Client({
  connectionString,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
});

try {
  await client.connect();

  await client.query(`
    alter table users
      add column if not exists email_verified_at timestamptz,
      add column if not exists verification_token_hash char(64),
      add column if not exists verification_token_expires_at timestamptz,
      add column if not exists reset_token_hash char(64),
      add column if not exists reset_token_expires_at timestamptz,
      add column if not exists token_version integer not null default 0
  `);

  await client.query(`
    create index if not exists users_verification_token_idx
      on users (verification_token_hash)
      where verification_token_hash is not null
  `);
  await client.query(`
    create index if not exists users_reset_token_idx
      on users (reset_token_hash)
      where reset_token_hash is not null
  `);

  // Các tài khoản có trước khi bật xác thực email được coi là đã xác thực.
  const verified = await client.query(
    `update users
        set email_verified_at = created_at
      where email_verified_at is null
      returning id`,
  );

  console.log('✅ Đã thêm cột xác thực email / đặt lại mật khẩu vào bảng users.');
  console.log(`   Đánh dấu ${verified.rowCount} tài khoản cũ là đã xác thực email.`);
} catch (err) {
  console.error('❌ Migration thất bại:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
