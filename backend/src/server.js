import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pool } from './db.js';
import { ApiError } from './lib/errors.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import projectRoutes from './routes/projects.js';
import categoryRoutes from './routes/categories.js';
import adminRoutes from './routes/admin.js';

if (!process.env.DATABASE_URL) {
  console.error('\n❌ Thiếu DATABASE_URL trong backend/.env');
  console.error('   Copy .env.example -> .env rồi dán chuỗi kết nối Neon.\n');
  process.exit(1);
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 20) {
  console.error('\n❌ JWT_SECRET chưa được đặt hoặc quá ngắn (tối thiểu 20 ký tự).');
  console.error('   Tạo bằng: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n');
  process.exit(1);
}
if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) {
  console.warn('\n⚠️  Chưa cấu hình SMTP (SMTP_HOST/SMTP_FROM).');
  console.warn('   Email xác thực và đặt lại mật khẩu sẽ chỉ được in ra console.');
  console.warn('   Điền SMTP trong backend/.env để gửi email thật.\n');
}

const app = express();
const port = Number(process.env.PORT || 4000);
const origins = String(process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({ origin: origins, credentials: false }));
app.use(express.json({ limit: '2mb' }));

if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      if (!req.path.startsWith('/api/health')) {
        console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - started}ms)`);
      }
    });
    next();
  });
}

app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('select now() as now, current_database() as db');
    res.json({ ok: true, db: rows[0].db, time: rows[0].now });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/me', meRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/admin', adminRoutes);

app.use((req, _res, next) => {
  next(new ApiError(404, `Không tìm thấy API: ${req.method} ${req.originalUrl}`));
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details || undefined });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON body không hợp lệ.' });
  }
  if (err?.code === '23505') {
    return res.status(409).json({ error: 'Dữ liệu đã tồn tại.' });
  }
  if (err?.code === '23503') {
    return res.status(400).json({ error: 'Dữ liệu tham chiếu không tồn tại hoặc đang được sử dụng.' });
  }
  if (err?.code === '22P02') {
    return res.status(400).json({ error: 'ID hoặc kiểu dữ liệu không hợp lệ.' });
  }
  console.error('[api] Lỗi không xử lý:', err);
  res.status(500).json({ error: 'Lỗi hệ thống, vui lòng thử lại.' });
});

async function start() {
  try {
    await pool.query('select 1');
    console.log('✅ Đã kết nối PostgreSQL');
  } catch (err) {
    console.error('\n❌ Không kết nối được database:', err.message);
    console.error('   Chạy: npm run db:check\n');
    process.exit(1);
  }

  const server = app.listen(port, () => {
    console.log(`🚀 API chạy tại http://localhost:${port}/api`);
    console.log(`   CORS cho phép: ${origins.join(', ')}`);
    console.log(`   Health check: http://localhost:${port}/api/health\n`);
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} — đang dừng server...`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
