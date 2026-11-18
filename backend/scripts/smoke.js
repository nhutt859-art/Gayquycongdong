/**
 * Smoke test API — chạy sau khi server đã khởi động:
 *   node scripts/smoke.js
 * Có thể đổi địa chỉ: API_URL=http://localhost:4000/api node scripts/smoke.js
 *
 * Script dùng dữ liệu động, không phụ thuộc UUID/count của seed cũ. Nếu có
 * DATABASE_URL, script tạo một admin tạm và dọn sạch dự án/tài khoản tạm sau khi chạy.
 * Có thể chỉ định admin có sẵn qua SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Client } from 'pg';

const BASE = process.env.API_URL || 'http://localhost:4000/api';
const BACKER_EMAIL = process.env.SMOKE_BACKER_EMAIL || 'minhanh.nguyen@gayquy.vn';
const COLLAB_EMAIL = process.env.SMOKE_COLLAB_EMAIL || 'thu.ha.le@gayquy.vn';
const PASSWORD = '12345678';

let passed = 0;
let failed = 0;
const failures = [];

let db = null;
let tempAdminId = null;
let tempDuplicateUserId = null;
let registeredUserId = null;
let backerId = null;
let smokeCommentProjectId = null;
const smokeStartedAt = new Date();
const tempProjectIds = [];

async function request(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

/**
 * Hoàn tất giao dịch qua trang mô phỏng VNPay (chỉ dùng được khi server chạy
 * chế độ mock, tức chưa cấu hình VNPAY_TMN_CODE/VNPAY_HASH_SECRET).
 */
async function completeMockPayment(paymentUrl, result = 'success') {
  let url;
  try {
    url = new URL(paymentUrl);
  } catch {
    return { ok: false, reason: 'payment_url không hợp lệ' };
  }
  const token = url.searchParams.get('token');
  if (!token || !url.pathname.endsWith('/payments/vnpay/mock')) {
    return { ok: false, reason: 'server đang dùng VNPay thật, không thể mô phỏng' };
  }
  const res = await fetch(
    `${BASE}/payments/vnpay/mock/complete?token=${encodeURIComponent(token)}&result=${result}`,
    { redirect: 'manual' },
  );
  return { ok: res.status >= 300 && res.status < 400, reason: `HTTP ${res.status}` };
}

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n── ${title}`);
}

const iso = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

async function login(email, password = PASSWORD) {
  const r = await request('POST', '/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`Đăng nhập ${email} thất bại: ${JSON.stringify(r.data)}`);
  return r.data;
}

async function connectDb() {
  if (!process.env.DATABASE_URL) return;
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
}

async function ensureAdmin() {
  if (process.env.SMOKE_ADMIN_EMAIL && process.env.SMOKE_ADMIN_PASSWORD) {
    return { email: process.env.SMOKE_ADMIN_EMAIL, password: process.env.SMOKE_ADMIN_PASSWORD };
  }
  if (!db) {
    throw new Error('Cần DATABASE_URL hoặc SMOKE_ADMIN_EMAIL/SMOKE_ADMIN_PASSWORD để chạy phần admin.');
  }
  const email = `smoke.admin.${Date.now()}@gayquy.vn`;
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const { rows } = await db.query(
    `insert into users (full_name, email, password_hash, role, kyc_status, trust_score, email_verified_at)
     values ('Smoke Admin', $1, $2, 'admin', 'verified', 80, now())
     returning id`,
    [email, passwordHash],
  );
  tempAdminId = rows[0].id;
  return { email, password: PASSWORD };
}

async function cleanup() {
  if (!db) return;
  try {
    if (tempProjectIds.length) {
      await db.query(
        `delete from transactions where project_id = any($1::uuid[])`,
        [tempProjectIds],
      );
      await db.query(
        `delete from fraud_flags
          where (entity_type = 'project' and entity_id = any($1::uuid[]))
             or (entity_type = 'pledge' and entity_id in (
                   select id from pledges where project_id = any($1::uuid[])
                 ))`,
        [tempProjectIds],
      );
      await db.query('delete from projects where id = any($1::uuid[])', [tempProjectIds]);
    }
    if (registeredUserId) {
      await db.query(`delete from fraud_flags where entity_type = 'user' and entity_id = $1`, [registeredUserId]);
      await db.query('delete from users where id = $1 and created_at >= $2', [registeredUserId, smokeStartedAt]);
    }
    if (tempDuplicateUserId) {
      await db.query('delete from users where id = $1 and created_at >= $2', [tempDuplicateUserId, smokeStartedAt]);
    }
    if (backerId) {
      await db.query(`delete from comments where user_id = $1 and content like 'Smoke test:%'`, [backerId]);
      await db.query(
        `delete from notifications
          where type = 'comment' and created_at >= $1
            and ($2::uuid is null or link = '/du-an/' || $2::text)`,
        [smokeStartedAt, smokeCommentProjectId],
      );
    }
    if (tempAdminId) {
      await db.query('delete from users where id = $1', [tempAdminId]);
    }
  } finally {
    await db.end();
  }
}

async function main() {
  console.log(`\n🧪 Smoke test API: ${BASE}`);
  await connectDb();

  section('Health & dữ liệu công khai');
  const health = await request('GET', '/health');
  check('GET /health trả 200', health.status === 200 && health.data?.ok === true, JSON.stringify(health.data));

  const list = await request('GET', '/projects?limit=50');
  check('GET /projects trả danh sách', list.status === 200 && Array.isArray(list.data?.items));
  check('Có dữ liệu dự án công khai', Number(list.data?.total) > 0, `total=${list.data?.total}`);

  const active = await request('GET', '/projects?status=active&limit=50');
  const activeItems = active.data?.items || [];
  check('Lọc trạng thái active', active.status === 200 && activeItems.length > 0, `count=${activeItems.length}`);

  const publicStats = await request('GET', '/projects/stats');
  check('GET /projects/stats trả số liệu tổng hợp', publicStats.status === 200 && Number(publicStats.data?.active_projects) > 0, JSON.stringify(publicStats.data));
  check('Tổng đã huy động và nhà tài trợ hợp lệ',
    Number(publicStats.data?.total_raised) >= 0 && Number(publicStats.data?.total_backers) >= 1);
  check('Tổng số dự án bao phủ danh sách công khai',
    Number(publicStats.data?.total_projects) >= Number(list.data?.total));
  check('Số dự án đang gây quỹ khớp bộ lọc active',
    Number(publicStats.data?.active_projects) === Number(active.data?.total),
    `stats=${publicStats.data?.active_projects} list=${active.data?.total}`);

  const search = await request('GET', '/projects?q=H%E1%BB%8Dc');
  check('Tìm kiếm theo từ khoá', search.status === 200 && search.data?.items?.length >= 1);

  const sample = activeItems.find((p) => Number(p.reward_count) > 0) || activeItems[0];
  check('Danh mục có trong dự án', !!sample?.category_name);

  const detail = await request('GET', `/projects/${sample.id}`);
  check('Chi tiết dự án trả 200', detail.status === 200);
  check('Chi tiết có mảng rewards/comments/updates',
    Array.isArray(detail.data?.rewards) && Array.isArray(detail.data?.comments) && Array.isArray(detail.data?.updates));
  check('Chi tiết có dự báo thành công', !!detail.data?.prediction && Number(detail.data.prediction.success_probability) > 0);
  check('Dự báo có đóng góp tín hiệu', Array.isArray(detail.data?.prediction?.contributions) && detail.data.prediction.contributions.length === 6);
  check('Dự báo có metrics mô hình', Number(detail.data?.prediction?.model_metrics?.auc) > 0.5);
  check('Khách không thấy bằng chứng gian lận', Array.isArray(detail.data?.fraud_flags) && detail.data.fraud_flags.length === 0);

  section('Xác thực & quyền');
  const guestCreate = await request('POST', '/projects', { body: {} });
  check('Guest tạo dự án bị 401', guestCreate.status === 401);

  const backer = await login(BACKER_EMAIL);
  backerId = backer.user.id;
  check('Đăng nhập backer', !!backer.token && backer.user.email === BACKER_EMAIL);
  check('Backer có role backer', backer.user.role === 'backer');

  const me = await request('GET', '/auth/me', { token: backer.token });
  check('GET /auth/me trả hồ sơ + stats', me.status === 200 && me.data?.user?.id === backer.user.id);
  check('Stats có số dư tài trợ', typeof me.data?.stats?.total_pledged === 'number');

  const adminContact = await request('GET', '/auth/admin-contact');
  check(
    'Có thông tin liên hệ quản trị viên',
    adminContact.status === 200 && Boolean(adminContact.data?.contact?.name),
    JSON.stringify(adminContact.data),
  );

  const noAuth = await request('GET', '/me/projects');
  check('Route /me bị chặn khi chưa đăng nhập', noAuth.status === 401);

  const backerAdmin = await request('GET', '/admin/stats', { token: backer.token });
  check('Backer vào admin bị 403', backerAdmin.status === 403);

  section('AI gợi ý & mô hình');
  const recs = await request('GET', '/me/recommendations', { token: backer.token });
  const recItems = recs.data?.items || [];
  check('AI trả gợi ý', recs.status === 200 && recItems.length > 0, `count=${recItems.length}`);
  check('Gợi ý có lý do', recItems.every((r) => typeof r.reason === 'string' && r.reason.length > 0));
  check('Gợi ý có score_breakdown', recItems.every((r) => Array.isArray(r.score_breakdown?.components)));

  const model = await request('GET', '/ai/model');
  check('Model card công khai', model.status === 200 && model.data?.model?.version === 'success-model-v4.0');
  check('Model card có 6 tín hiệu', model.data?.model?.features?.length === 6);
  check('Model card có metrics kiểm định chéo', Number(model.data?.model?.metrics?.folds) === 5);

  const categories = await request('GET', '/categories');
  const categoryId = categories.data?.items?.[0]?.id;
  check('Danh mục công khai', categories.status === 200 && !!categoryId);

  const estimate = await request('POST', '/ai/estimate', {
    body: {
      category_id: categoryId,
      goal_amount: 150000000,
      description: 'Chiến dịch kiểm thử mô hình với mô tả đủ dài để mô hình có tín hiệu.'.repeat(2),
      rewards_count: 3,
      start_date: iso(0),
      end_date: iso(45),
    },
  });
  const estimatePrediction = estimate.data?.prediction;
  check('Ước tính AI trả dự báo', estimate.status === 200 && Number(estimatePrediction?.score) > 0);
  check('Ước tính có nhãn + độ tin cậy', !!estimatePrediction?.label_text && Number(estimatePrediction?.confidence) > 0);
  check('Ước tính có đủ 6 đóng góp', estimatePrediction?.contributions?.length === 6);

  section('Tương tác của nhà tài trợ');
  const follow = await request('POST', `/projects/${sample.id}/follow`, { token: backer.token });
  check('Theo dõi dự án', follow.status === 200 && follow.data?.following === true);
  const unfollow = await request('DELETE', `/projects/${sample.id}/follow`, { token: backer.token });
  check('Bỏ theo dõi dự án', unfollow.status === 200 && unfollow.data?.following === false);

  const comment = await request('POST', `/projects/${sample.id}/comments`, {
    token: backer.token,
    body: { content: 'Smoke test: dự án rất ý nghĩa, mình sẽ ủng hộ.' },
  });
  smokeCommentProjectId = sample.id;
  check('Gửi bình luận', comment.status === 201 && !!comment.data?.comment?.id);

  section('Đăng ký mới → KYC → tạo dự án');
  const registerEmail = process.env.SMOKE_REGISTER_EMAIL || '';
  let email;

  // Kiểm tra validate của endpoint đăng ký mà không gửi email.
  const invalidRegister = await request('POST', '/auth/register', {
    body: { full_name: 'Người Dùng Smoke', email: 'khong-phai-email', password: PASSWORD },
  });
  check('Đăng ký email không hợp lệ bị từ chối', invalidRegister.status === 400, JSON.stringify(invalidRegister.data));

  const shortPasswordRegister = await request('POST', '/auth/register', {
    body: { full_name: 'Người Dùng Smoke', email: `smoke.short.${Date.now()}@gayquy.invalid`, password: '1234567' },
  });
  check('Đăng ký mật khẩu dưới 8 ký tự bị từ chối', shortPasswordRegister.status === 400, JSON.stringify(shortPasswordRegister.data));

  if (db) {
    // Dùng tài khoản tạm bị khóa để kiểm tra email trùng mà không gửi email ra ngoài.
    const dupEmail = `smoke.dup.${Date.now()}@gayquy.invalid`;
    const dupHash = await bcrypt.hash(PASSWORD, 10);
    const dup = await db.query(
      `insert into users (full_name, email, password_hash, status, email_verified_at)
       values ('Smoke Duplicate', $1, $2, 'locked', now())
       returning id`,
      [dupEmail, dupHash],
    );
    tempDuplicateUserId = dup.rows[0].id;
    const duplicateRegister = await request('POST', '/auth/register', {
      body: { full_name: 'Người Dùng Smoke', email: dupEmail, password: PASSWORD },
    });
    check(
      'Đăng ký email đã tồn tại trả lỗi 409',
      duplicateRegister.status === 409 &&
        duplicateRegister.data?.details?.code === 'EMAIL_EXISTS' &&
        /Email đã tồn tại/.test(duplicateRegister.data?.error || ''),
      JSON.stringify(duplicateRegister.data),
    );
  } else {
    check('Bỏ qua kiểm tra email trùng (không có DATABASE_URL)', true);
  }

  if (registerEmail) {
    // Chỉ chạy luồng đăng ký đầy đủ khi có hộp thư thật do người chạy kiểm soát.
    email = registerEmail;
    const register = await request('POST', '/auth/register', {
      body: { full_name: 'Người Dùng Smoke', email, password: PASSWORD },
    });
    check(
      'Đăng ký tài khoản mới thành công (chưa cấp token)',
      register.status === 201 &&
        register.data?.email === email.toLowerCase() &&
        !register.data?.token &&
        !register.data?.user &&
        /Đăng ký thành công/.test(register.data?.message || ''),
      JSON.stringify(register.data),
    );
    if (db) {
      const regRows = await db.query('select id from users where lower(email) = $1', [email.toLowerCase()]);
      registeredUserId = regRows.rows[0]?.id || null;
    }

    if (register.data?.dev_verification_url) {
      const verifyToken = new URL(register.data.dev_verification_url).searchParams.get('token');
      const verify = await request('POST', '/auth/verify-email', { body: { token: verifyToken } });
      check('Xác thực email tài khoản mới', verify.status === 200 && verify.data?.user?.email_verified === true, JSON.stringify(verify.data));
    } else if (db && registeredUserId) {
      await db.query('update users set email_verified_at = now() where id = $1', [registeredUserId]);
      check('Xác thực email tài khoản mới (qua DB test)', true);
    } else {
      check('Có cách xác thực email để chạy smoke', false, JSON.stringify(register.data));
    }
  } else {
    // Mặc định không gửi email ra ngoài: tạo tài khoản đã xác thực trực tiếp trong DB.
    if (!db) {
      throw new Error('Cần DATABASE_URL hoặc SMOKE_REGISTER_EMAIL để chạy phần đăng ký.');
    }
    email = `smoke.${Date.now()}@gayquy.invalid`;
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const { rows } = await db.query(
      `insert into users (full_name, email, password_hash, email_verified_at)
       values ('Người Dùng Smoke', $1, $2, now())
       returning id`,
      [email, passwordHash],
    );
    registeredUserId = rows[0].id;
    check('Tạo tài khoản kiểm thử đã xác thực (không gửi email)', true);
  }

  const newLogin = await request('POST', '/auth/login', { body: { email, password: PASSWORD } });
  check('Đăng nhập sau khi xác thực email', newLogin.status === 200 && !!newLogin.data?.token, JSON.stringify(newLogin.data));
  let newToken = newLogin.data?.token;
  if (!newToken) throw new Error('Không lấy được token đăng nhập sau xác thực email — dừng smoke test.');

  const noKyc = await request('POST', '/projects', {
    token: newToken,
    body: {
      title: 'Dự án kiểm thử tự động',
      description: 'Mô tả đủ dài cho dự án kiểm thử tự động.',
      category_id: categoryId,
      goal_amount: 50000000,
      end_date: iso(30),
    },
  });
  check('Chưa KYC không tạo được dự án', noKyc.status === 403, JSON.stringify(noKyc.data));

  const missingKyc = await request('POST', '/me/kyc', { token: newToken, body: {} });
  check('KYC thiếu hồ sơ bị từ chối', missingKyc.status === 400, JSON.stringify(missingKyc.data));

  if (db && registeredUserId) {
    // Tạo hồ sơ KYC đang chờ + token xác thực, sau đó chạy đúng endpoint xác thực email KYC.
    const kycToken = `smoke-kyc-${Date.now()}`;
    const kycHash = crypto.createHash('sha256').update(kycToken).digest('hex');
    await db.query(
      `update users
          set kyc_status = 'pending',
              kyc_document_type = 'cccd',
              kyc_document_number = $1,
              kyc_full_name = 'Người Dùng Smoke',
              kyc_dob = '1995-05-20',
              kyc_contact_email = $2,
              kyc_submitted_at = now(),
              kyc_token_hash = $3,
              kyc_token_expires_at = now() + interval '1 hour'
        where id = $4`,
      [`SMOKE${Date.now()}`, email, kycHash, registeredUserId],
    );
    const kyc = await request('POST', '/auth/verify-kyc', { body: { token: kycToken } });
    check(
      'Xác thực KYC qua email token',
      kyc.status === 200 && kyc.data?.user?.kyc_status === 'verified',
      JSON.stringify(kyc.data),
    );
  } else {
    check('Xác thực KYC qua email token', false, 'Thiếu DATABASE_URL hoặc tài khoản smoke');
  }

  const created = await request('POST', '/projects', {
    token: newToken,
    body: {
      title: 'Dự án kiểm thử tự động',
      description: 'Mô tả đủ dài cho dự án kiểm thử tự động, bám sát quy trình tạo dự án của đồ án. Chiến dịch cần được kiểm tra tự động.',
      category_id: categoryId,
      goal_amount: 50000000,
      start_date: iso(0),
      end_date: iso(30),
      rewards: [{ title: 'Gói cảm ơn', min_amount: 100000, quantity_available: 100 }],
    },
  });
  check('Tạo dự án sau KYC', created.status === 201 && created.data?.project?.status === 'pending_review', JSON.stringify(created.data));
  const projectA = created.data?.project?.id;
  if (projectA) tempProjectIds.push(projectA);
  check('Dự án mới có dự báo + đóng góp', !!created.data?.prediction && created.data.prediction.contributions?.length === 6);
  check('Dự án mới có điểm gian lận + bằng chứng', typeof created.data?.fraud?.score === 'number' && Array.isArray(created.data?.fraud?.signals));

  const meAfterCreate = await request('GET', '/auth/me', { token: newToken });
  check('Backer được nâng thành owner', meAfterCreate.data?.user?.role === 'owner');

  const adminCreds = await ensureAdmin();
  const admin = await login(adminCreds.email, adminCreds.password);
  check('Đăng nhập admin', admin.user.role === 'admin');

  const approveNew = await request('POST', `/admin/projects/${projectA}/approve`, { token: admin.token });
  check('Admin duyệt dự án mới', approveNew.status === 200 && approveNew.data?.project?.status === 'active');

  const newDetail = await request('GET', `/projects/${projectA}`, { token: newToken });
  check('Dự án mới có reward', newDetail.data?.rewards?.length === 1);
  check('Owner xem được quyền quản lý', newDetail.data?.can_manage === true);

  const update = await request('POST', `/projects/${projectA}/updates`, {
    token: newToken,
    body: { title: 'Smoke test cập nhật', content: 'Nội dung bản tin kiểm thử tự động, dài hơn mười ký tự.' },
  });
  check('Đăng bản tin tiến độ', update.status === 201);

  const ownPledge = await request('POST', `/projects/${projectA}/pledges`, {
    token: newToken,
    body: { amount: 100000 },
  });
  check('Owner không tự tài trợ dự án mình', ownPledge.status === 400, JSON.stringify(ownPledge.data));

  const before = await request('GET', `/projects/${projectA}`);
  const pledge = await request('POST', `/projects/${projectA}/pledges`, {
    token: backer.token,
    body: { amount: 100000, method: 'VNPay', is_anonymous: false },
  });
  check(
    'Tạo tài trợ ở trạng thái chờ thanh toán',
    pledge.status === 201 && pledge.data?.pledge?.status === 'pending' && !!pledge.data?.payment_url,
    JSON.stringify(pledge.data),
  );
  check('Tài trợ chưa cộng tiền trước khi thanh toán', Number(pledge.data?.project?.current_amount) === Number(before.data?.current_amount));

  if (String(pledge.data?.payment_url || '').includes('/payments/vnpay/mock')) {
    const mockPage = await fetch(pledge.data.payment_url);
    const html = await mockPage.text();
    check(
      'Trang thanh toán VNPay hiển thị đúng',
      mockPage.status === 200 &&
        html.includes('VNPAY') &&
        html.includes('100.000') &&
        !html.includes('MÔ PHỎNG') &&
        !html.includes('vnp_TmnCode'),
      `HTTP ${mockPage.status}`,
    );
  }

  const confirm = await completeMockPayment(pledge.data?.payment_url);
  check('Mô phỏng VNPay xác nhận thanh toán', confirm.ok, confirm.reason);

  const after = await request('GET', `/projects/${projectA}`);
  check(
    'Chỉ cộng tiền sau khi thanh toán được xác nhận',
    Number(after.data?.current_amount) === Number(before.data?.current_amount) + 100000,
    `${before.data?.current_amount} -> ${after.data?.current_amount}`,
  );

  const paymentStatus = await request('GET', `/payments/status/${encodeURIComponent(pledge.data?.txn_ref)}`, {
    token: backer.token,
  });
  check(
    'Tra cứu trạng thái giao dịch VNPay',
    paymentStatus.status === 200 && paymentStatus.data?.result === 'success' && Number(paymentStatus.data?.amount) === 100000,
    JSON.stringify(paymentStatus.data),
  );

  const confirmAgain = await completeMockPayment(pledge.data?.payment_url);
  const afterAgain = await request('GET', `/projects/${projectA}`);
  check(
    'Xác nhận lại không cộng tiền lần hai',
    confirmAgain.ok && Number(afterAgain.data?.current_amount) === Number(after.data?.current_amount),
    `${after.data?.current_amount} -> ${afterAgain.data?.current_amount}`,
  );

  const unsupportedMethod = await request('POST', `/projects/${projectA}/pledges`, {
    token: backer.token,
    body: { amount: 100000, method: 'Momo' },
  });
  check('Chặn phương thức thanh toán chưa hỗ trợ', unsupportedMethod.status === 400, JSON.stringify(unsupportedMethod.data));

  const beforeCancel = await request('GET', `/projects/${projectA}`);
  const cancelPledge = await request('POST', `/projects/${projectA}/pledges`, {
    token: backer.token,
    body: { amount: 150000, method: 'VNPay' },
  });
  const cancel = await completeMockPayment(cancelPledge.data?.payment_url, 'failed');
  const cancelStatus = await request('GET', `/payments/status/${encodeURIComponent(cancelPledge.data?.txn_ref)}`, {
    token: backer.token,
  });
  const afterCancel = await request('GET', `/projects/${projectA}`);
  check(
    'Huỷ thanh toán không ghi nhận tài trợ',
    cancel.ok &&
      cancelStatus.data?.result === 'failed' &&
      Number(afterCancel.data?.current_amount) === Number(beforeCancel.data?.current_amount),
    JSON.stringify({ cancel, status: cancelStatus.data?.result }),
  );

  const payConfig = await request('GET', '/payments/config');
  check(
    'Cấu hình thanh toán trả nhà cung cấp VNPay',
    payConfig.status === 200 && payConfig.data?.provider === 'VNPay' && ['mock', 'vnpay'].includes(payConfig.data?.mode),
    JSON.stringify(payConfig.data),
  );

  const myPledges = await request('GET', '/me/pledges', { token: backer.token });
  check('Lịch sử tài trợ có dữ liệu', myPledges.status === 200 && myPledges.data.items.length >= 1, `count=${myPledges.data?.items?.length}`);

  const transactions = await request('GET', '/me/transactions', { token: backer.token });
  check('Lịch sử giao dịch trả dữ liệu', transactions.status === 200 && transactions.data.items.length > 0);

  const notifications = await request('GET', '/me/notifications', { token: backer.token });
  check('Thông báo của backer', notifications.status === 200 && notifications.data.items.length > 0);

  const payout = await request('POST', `/projects/${projectA}/payouts`, {
    token: newToken,
    body: { amount: 100000 },
  });
  check(
    'Chưa hoàn thành thì chưa được yêu cầu giải ngân',
    payout.status === 400,
    JSON.stringify(payout.data),
  );

  section('Cộng tác viên');
  const collab = await login(COLLAB_EMAIL);
  const invite = await request('POST', `/projects/${projectA}/collaborators`, {
    token: newToken,
    body: { email: COLLAB_EMAIL, role: 'editor' },
  });
  check('Owner mời cộng tác viên', invite.status === 201, JSON.stringify(invite.data));

  const collabProjects = await request('GET', '/me/projects', { token: collab.token });
  check('Collab thấy lời mời đang chờ', collabProjects.data?.invitations?.some((p) => p.id === projectA));

  const accept = await request('POST', `/me/invitations/${projectA}/accept`, { token: collab.token });
  check('Chấp nhận lời mời cộng tác', accept.status === 200);
  const collabAfter = await request('GET', '/me/projects', { token: collab.token });
  check('Collab thấy dự án sau khi nhận', collabAfter.data?.collaborating?.some((p) => p.id === projectA));

  const collabEdit = await request('PATCH', `/projects/${projectA}`, {
    token: collab.token,
    body: { goal_amount: 999999999 },
  });
  check('Collab không được đổi mục tiêu', collabEdit.status === 403);

  const removeCollab = await request('DELETE', `/projects/${projectA}/collaborators/${collab.user.id}`, { token: newToken });
  check('Owner xoá cộng tác viên', removeCollab.status === 204, JSON.stringify(removeCollab.data));

  section('Đóng chiến dịch & hoàn tiền');
  const createdB = await request('POST', '/projects', {
    token: newToken,
    body: {
      title: 'Dự án kiểm thử hoàn tiền',
      description: 'Dự án thứ hai phục vụ kiểm thử quy trình đóng chiến dịch và hoàn tiền tự động.',
      category_id: categoryId,
      goal_amount: 80000000,
      start_date: iso(0),
      end_date: iso(30),
      rewards: [{ title: 'Gói cảm ơn', min_amount: 100000, quantity_available: 100 }],
    },
  });
  const projectB = createdB.data?.project?.id;
  if (projectB) tempProjectIds.push(projectB);
  check('Tạo dự án thứ hai', createdB.status === 201 && !!projectB);

  await request('POST', `/admin/projects/${projectB}/approve`, { token: admin.token });
  const pledgeB = await request('POST', `/projects/${projectB}/pledges`, {
    token: backer.token,
    body: { amount: 100000 },
  });
  check('Tạo tài trợ dự án thứ hai', pledgeB.status === 201 && pledgeB.data?.pledge?.status === 'pending', JSON.stringify(pledgeB.data));
  const confirmB = await completeMockPayment(pledgeB.data?.payment_url);
  check('Xác nhận thanh toán dự án thứ hai', confirmB.ok, confirmB.reason);

  const closeB = await request('POST', `/projects/${projectB}/close`, {
    token: newToken,
    body: { outcome: 'failed' },
  });
  check('Owner đóng chiến dịch thất bại', closeB.status === 200 && closeB.data?.project?.status === 'failed');

  const refund = await request('POST', `/admin/projects/${projectB}/refund`, { token: admin.token });
  check('Hoàn tiền dự án thất bại', refund.status === 200 && refund.data?.count === 1, JSON.stringify(refund.data));
  const afterRefund = await request('GET', `/projects/${projectB}`, { token: admin.token });
  check('Hoàn tiền đưa current_amount về 0', Number(afterRefund.data?.current_amount) === 0, `current=${afterRefund.data?.current_amount}`);

  section('Hoàn thành sớm & giải ngân đúng hạn');
  const createdC = await request('POST', '/projects', {
    token: newToken,
    body: {
      title: 'Dự án kiểm thử hoàn thành sớm',
      description: 'Dự án thứ ba kiểm thử tự động việc đạt mục tiêu trước hạn, tạo yêu cầu giải ngân và chuyển trạng thái đang triển khai.',
      category_id: categoryId,
      goal_amount: 100000,
      start_date: iso(0),
      end_date: iso(30),
      rewards: [{ title: 'Gói cảm ơn', min_amount: 100000, quantity_available: 100 }],
    },
  });
  const projectC = createdC.data?.project?.id;
  if (projectC) tempProjectIds.push(projectC);
  check('Tạo dự án kiểm thử hoàn thành sớm', createdC.status === 201 && !!projectC);
  await request('POST', `/admin/projects/${projectC}/approve`, { token: admin.token });

  const pledgeC = await request('POST', `/projects/${projectC}/pledges`, {
    token: backer.token,
    body: { amount: 100000 },
  });
  check(
    'Tạo tài trợ đủ mục tiêu ở trạng thái chờ thanh toán',
    pledgeC.status === 201 && pledgeC.data?.pledge?.status === 'pending',
    JSON.stringify(pledgeC.data),
  );

  const confirmC = await completeMockPayment(pledgeC.data?.payment_url);
  check('Xác nhận thanh toán dự án đủ mục tiêu', confirmC.ok, confirmC.reason);

  const paidC = await request('GET', `/projects/${projectC}`, { token: newToken });
  check(
    'Thanh toán đủ mục tiêu tự chuyển chờ giải ngân',
    paidC.data?.status === 'awaiting_disbursement',
    JSON.stringify({ status: paidC.data?.status }),
  );

  const detailC = await request('GET', `/projects/${projectC}`, { token: newToken });
  check(
    'Dự án hoàn thành có completed_at và ngừng nhận tài trợ',
    detailC.data?.status === 'awaiting_disbursement' && !!detailC.data?.completed_at && detailC.data?.can_pledge === false,
    JSON.stringify({ status: detailC.data?.status, completed_at: detailC.data?.completed_at }),
  );
  const autoPayout = detailC.data?.payouts?.[0];
  check(
    'Tự tạo yêu cầu giải ngân chờ duyệt',
    detailC.data?.payouts?.length === 1 && autoPayout?.status === 'pending' && Number(autoPayout?.amount) === 100000,
    JSON.stringify(detailC.data?.payouts),
  );
  check(
    'Trạng thái giải ngân ban đầu là chờ giải ngân',
    detailC.data?.disbursement?.status === 'pending' &&
      detailC.data?.disbursement?.can_disburse === false &&
      Number(detailC.data?.disbursement?.pending_amount) === 100000,
    JSON.stringify(detailC.data?.disbursement),
  );

  const earlyApprove = await request('POST', `/admin/payouts/${autoPayout?.id}/approve`, { token: admin.token });
  check(
    'Admin bị chặn giải ngân trước ngày kết thúc',
    earlyApprove.status === 400,
    JSON.stringify(earlyApprove.data),
  );

  const duplicatePayout = await request('POST', `/projects/${projectC}/payouts`, {
    token: newToken,
    body: { amount: 100000 },
  });
  check(
    'Owner không thể yêu cầu trùng khi đã có khoản chờ duyệt',
    duplicatePayout.status === 400,
    JSON.stringify(duplicatePayout.data),
  );

  const closeC = await request('POST', `/projects/${projectC}/close`, {
    token: newToken,
    body: { outcome: 'failed' },
  });
  check(
    'Không thể đổi trạng thái dự án đã hoàn thành',
    closeC.status === 400,
    JSON.stringify(closeC.data),
  );

  if (db) {
    await db.query(
      `update projects set start_date = current_date - 10, end_date = current_date - 1 where id = $1`,
      [projectC],
    );
    check('Mô phỏng tới hạn chiến dịch', true);

    const adminPayouts = await request('GET', '/admin/payouts', { token: admin.token });
    const targetPayout = adminPayouts.data?.items?.find((item) => item.project_id === projectC);
    check(
      'Admin thấy yêu cầu đủ điều kiện giải ngân sau hạn',
      targetPayout?.can_disburse === true,
      JSON.stringify(targetPayout),
    );

    const approveC = await request('POST', `/admin/payouts/${autoPayout?.id}/approve`, { token: admin.token });
    check(
      'Duyệt giải ngân ghi người duyệt và thời điểm',
      approveC.status === 200 &&
        approveC.data?.transaction?.status === 'success' &&
        approveC.data?.transaction?.processed_by === admin.user.id &&
        !!approveC.data?.transaction?.processed_at,
      JSON.stringify(approveC.data),
    );

    const afterDisburse = await request('GET', `/projects/${projectC}`, { token: newToken });
    check(
      'Dự án chuyển sang đã giải ngân sau khi admin duyệt',
      afterDisburse.data?.status === 'disbursed',
      JSON.stringify({ status: afterDisburse.data?.status }),
    );
    check(
      'Chi tiết có số tiền, ngày và người giải ngân',
      afterDisburse.data?.disbursement?.status === 'disbursed' &&
        Number(afterDisburse.data?.disbursement?.amount) === 100000 &&
        !!afterDisburse.data?.disbursement?.disbursed_at &&
        !!afterDisburse.data?.disbursement?.disbursed_by_name,
      JSON.stringify(afterDisburse.data?.disbursement),
    );

    const backerNotifications = await request('GET', '/me/notifications', { token: backer.token });
    check(
      'Backer nhận thông báo khi admin duyệt giải ngân',
      backerNotifications.data?.items?.some(
        (n) => n.link === `/du-an/${projectC}` && n.type === 'payout' && String(n.content).includes('giải ngân'),
      ),
      JSON.stringify(backerNotifications.data?.items?.slice(0, 3)),
    );
    const ownerNotifications = await request('GET', '/me/notifications', { token: newToken });
    check(
      'Chủ dự án nhận thông báo khi admin duyệt giải ngân',
      ownerNotifications.data?.items?.some(
        (n) => n.link === `/quan-ly/${projectC}` && String(n.content).includes('giải ngân'),
      ),
      JSON.stringify(ownerNotifications.data?.items?.slice(0, 3)),
    );

    const startImpl = await request('POST', `/projects/${projectC}/start-implementation`, {
      token: newToken,
    });
    check(
      'Chủ dự án bắt đầu triển khai sau khi giải ngân',
      startImpl.status === 200 && startImpl.data?.project?.status === 'in_progress',
      JSON.stringify(startImpl.data),
    );

    const adminNotifications = await request('GET', '/me/notifications', { token: admin.token });
    check(
      'Admin nhận thông báo khi dự án bắt đầu triển khai',
      adminNotifications.data?.items?.some(
        (n) => n.link === `/admin/du-an/${projectC}` || (n.link === '/admin/du-an' && String(n.content).includes('triển khai')),
      ),
      JSON.stringify(adminNotifications.data?.items?.slice(0, 3)),
    );

    const updateC = await request('POST', `/projects/${projectC}/updates`, {
      token: newToken,
      body: { title: 'Báo cáo sau giải ngân', content: 'Chủ dự án cập nhật tiến độ sau khi nhận tiền giải ngân từ quản trị viên.' },
    });
    check('Chủ dự án cập nhật tiến độ sau giải ngân', updateC.status === 201, JSON.stringify(updateC.data));

    const closeInProgress = await request('POST', `/projects/${projectC}/close`, {
      token: newToken,
      body: { outcome: 'failed' },
    });
    check(
      'Không thể đổi trạng thái khi đang triển khai',
      closeInProgress.status === 400,
      JSON.stringify(closeInProgress.data),
    );
  } else {
    check('Mô phỏng tới hạn chiến dịch', false, 'Thiếu DATABASE_URL để cập nhật ngày kết thúc.');
  }

  section('Admin');
  const stats = await request('GET', '/admin/stats', { token: admin.token });
  check('Thống kê admin', stats.status === 200 && Number(stats.data?.total_projects) >= 200, `total=${stats.data?.total_projects}`);
  check('Biểu đồ 7 ngày có 7 điểm', stats.data?.chart?.length === 7, `count=${stats.data?.chart?.length}`);
  check('Stats có model card dự đoán', stats.data?.ai_model?.version === 'success-model-v4.0');
  check('Stats có model gian lận + ngưỡng', stats.data?.fraud_model?.threshold === 60);

  const pending = await request('GET', '/admin/projects?status=pending_review', { token: admin.token });
  check('Danh sách chờ duyệt có dự án', pending.status === 200 && pending.data.items.length >= 1);

  const flags = await request('GET', '/admin/fraud-flags', { token: admin.token });
  const flagItems = flags.data?.items || [];
  check('Danh sách cảnh báo gian lận', flags.status === 200 && flagItems.length >= 1, `count=${flagItems.length}`);
  check('Cảnh báo có bằng chứng tín hiệu', flagItems.every((f) => Array.isArray(f.evidence?.signals) && f.evidence.signals.length > 0));
  check('Cảnh báo có model version', flagItems.every((f) => typeof f.model_version === 'string' && f.model_version.length > 0));

  const reports = await request('GET', '/admin/reports', { token: admin.token });
  check('Danh sách báo cáo', reports.status === 200 && reports.data.items.length >= 1);

  const payouts = await request('GET', '/admin/payouts', { token: admin.token });
  check('Danh sách giải ngân', payouts.status === 200 && payouts.data.items.length >= 1);
  check(
    'Danh sách giải ngân có trạng thái dự án và điều kiện duyệt',
    payouts.data.items.every((p) => typeof p.can_disburse === 'boolean' && !!p.project_status),
  );

  const users = await request('GET', '/admin/users', { token: admin.token });
  check('Danh sách người dùng', users.status === 200 && users.data.items.length >= 1000, `count=${users.data?.items?.length}`);

  const catList = await request('GET', '/admin/categories', { token: admin.token });
  check('Danh sách danh mục', catList.status === 200 && catList.data.items.length >= 6);

  const newCat = await request('POST', '/admin/categories', {
    token: admin.token,
    body: { name: `Smoke test ${Date.now()}`, description: 'Danh mục kiểm thử' },
  });
  check('Thêm danh mục', newCat.status === 201);
  const delCat = await request('DELETE', `/admin/categories/${newCat.data?.category?.id}`, { token: admin.token });
  check('Xoá danh mục rỗng', delCat.status === 204);

  const lock = await request('PATCH', `/admin/users/${collab.user.id}/status`, {
    token: admin.token,
    body: { status: 'locked' },
  });
  check('Khóa tài khoản', lock.status === 200 && lock.data?.user?.status === 'locked');
  const lockedLogin = await request('POST', '/auth/login', {
    body: { email: COLLAB_EMAIL, password: PASSWORD },
  });
  check(
    'Tài khoản bị khóa không đăng nhập được',
    lockedLogin.status === 403 && lockedLogin.data?.details?.code === 'ACCOUNT_LOCKED',
    JSON.stringify(lockedLogin.data),
  );
  const unlock = await request('PATCH', `/admin/users/${collab.user.id}/status`, {
    token: admin.token,
    body: { status: 'active' },
  });
  check('Mở khóa tài khoản', unlock.status === 200 && unlock.data?.user?.status === 'active');
  const collabRelogin = await login(COLLAB_EMAIL);
  check('Đăng nhập lại được sau khi mở khóa', Boolean(collabRelogin.token));
  collab.token = collabRelogin.token;

  section('Tạm ngưng dự án khi chủ tài khoản bị khóa');
  const lockOwner = await request('PATCH', `/admin/users/${registeredUserId}/status`, {
    token: admin.token,
    body: { status: 'locked' },
  });
  check(
    'Khóa chủ dự án tạm ngưng các dự án đang hoạt động',
    lockOwner.status === 200 && lockOwner.data?.suspended_projects?.some((p) => p.id === projectA),
    JSON.stringify(lockOwner.data),
  );
  const suspendedDetail = await request('GET', `/projects/${projectA}`, { token: admin.token });
  check('Dự án chuyển sang trạng thái tạm ngưng', suspendedDetail.data?.status === 'suspended', JSON.stringify(suspendedDetail.data?.status));
  const pledgeSuspended = await request('POST', `/projects/${projectA}/pledges`, {
    token: backer.token,
    body: { amount: 100000 },
  });
  check(
    'Không thể tài trợ dự án đang tạm ngưng',
    pledgeSuspended.status === 400 && pledgeSuspended.data?.details?.code === 'PROJECT_SUSPENDED',
    JSON.stringify(pledgeSuspended.data),
  );
  const collabBlocked = await request('PATCH', `/projects/${projectA}`, {
    token: collab.token,
    body: { title: 'Cập nhật khi dự án tạm ngưng' },
  });
  check(
    'Cộng tác viên bị chặn thao tác trên dự án tạm ngưng',
    collabBlocked.status === 403 && collabBlocked.data?.details?.code === 'PROJECT_SUSPENDED',
    JSON.stringify(collabBlocked.data),
  );
  const unlockOwner = await request('PATCH', `/admin/users/${registeredUserId}/status`, {
    token: admin.token,
    body: { status: 'active' },
  });
  check(
    'Mở khóa khôi phục trạng thái dự án trước đó',
    unlockOwner.status === 200 && unlockOwner.data?.restored_projects?.some((p) => p.id === projectA && p.status === 'active'),
    JSON.stringify(unlockOwner.data),
  );

  section('Tổng kết');
  console.log(`\n✅ ${passed} passed   ❌ ${failed} failed`);
  if (failed) {
    console.log('\nChi tiết lỗi:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('\n💥 Smoke test dừng do lỗi:', err.message);
    process.exitCode = 1;
  })
  .finally(cleanup);
