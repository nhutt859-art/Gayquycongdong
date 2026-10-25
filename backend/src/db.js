import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

// Postgres trả NUMERIC dạng string -> ép về number cho tiền VND.
// DATE trả về Date object theo timezone -> giữ nguyên chuỗi YYYY-MM-DD.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

const sslDisabled = String(process.env.PGSSL || 'require').toLowerCase() === 'disable';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 5),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 20_000,
});

pool.on('error', (err) => {
  console.error('[db] Lỗi pool không mong muốn:', err.message);
});

export const query = (text, params) => pool.query(text, params);

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
