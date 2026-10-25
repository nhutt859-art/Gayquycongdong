/**
 * Smoke test API — chạy sau khi server đã khởi động:
 *   node scripts/smoke.js
 * Có thể đổi địa chỉ: API_URL=http://localhost:4000/api node scripts/smoke.js
 */
const BASE = process.env.API_URL || 'http://localhost:4000/api';
let passed = 0;
let failed = 0;
const failures = [];

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

async function login(email, password = '123456') {
  const r = await request('POST', '/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`Đăng nhập ${email} thất bại: ${JSON.stringify(r.data)}`);
  return r.data;
}

async function main() {
  console.log(`\n🧪 Smoke test API: ${BASE}`);

  section('Health & dữ liệu công khai');
  const health = await request('GET', '/health');
  check('GET /health trả 200', health.status === 200 && health.data?.ok === true, JSON.stringify(health.data));

  const list = await request('GET', '/projects?limit=50');
  check('GET /projects trả danh sách', list.status === 200 && Array.isArray(list.data?.items));
  check('Có 9 dự án công khai (ẩn pending_review)', list.data?.total === 9, `total=${list.data?.total}`);

  const active = await request('GET', '/projects?status=active&limit=50');
  check('Lọc trạng thái active', active.status === 200 && active.data?.items?.length === 5, `count=${active.data?.items?.length}`);

  const search = await request('GET', '/projects?q=Học%20bổng');
  check('Tìm kiếm theo từ khoá', search.status === 200 && search.data?.items?.length >= 1);

  // Danh mục được kiểm tra gián tiếp qua dữ liệu dự án
  check('Danh mục có trong dự án', !!list.data?.items?.[0]?.category_name);

  const p1 = '20000000-0000-4000-8000-000000000001';
  const p4 = '20000000-0000-4000-8000-000000000004';
  const p5 = '20000000-0000-4000-8000-000000000005';
  const p6 = '20000000-0000-4000-8000-000000000006';

  const detail = await request('GET', `/projects/${p1}`);
  check('Chi tiết dự án trả 200', detail.status === 200);
  check('Chi tiết có rewards', Array.isArray(detail.data?.rewards) && detail.data.rewards.length === 3);
  check('Chi tiết có comments', Array.isArray(detail.data?.comments) && detail.data.comments.length >= 4);
  check('Chi tiết có updates', Array.isArray(detail.data?.updates) && detail.data.updates.length >= 2);
  check('Tiến độ tính đúng', detail.data?.current_amount === 342500000 && detail.data?.progress === 69, `current=${detail.data?.current_amount}`);

  section('Xác thực & quyền');
  const guestCreate = await request('POST', '/projects', { body: {} });
  check('Guest tạo dự án bị 401', guestCreate.status === 401);

  const backer = await login('backer@demo.vn');
  check('Đăng nhập backer', !!backer.token && backer.user.email === 'backer@demo.vn');
  check('Backer có role backer', backer.user.role === 'backer');

  const me = await request('GET', '/auth/me', { token: backer.token });
  check('GET /auth/me trả hồ sơ + stats', me.status === 200 && me.data?.user?.id === backer.user.id);
  check('Stats có số dư tài trợ', typeof me.data?.stats?.total_pledged === 'number');

  const noAuth = await request('GET', '/me/projects');
  check('Route /me bị chặn khi chưa đăng nhập', noAuth.status === 401);

  const backerAdmin = await request('GET', '/admin/stats', { token: backer.token });
  check('Backer vào admin bị 403', backerAdmin.status === 403);

  section('AI gợi ý & tương tác');
  const recs = await request('GET', '/me/recommendations', { token: backer.token });
  check('AI trả gợi ý', recs.status === 200 && recs.data?.items?.length > 0, `count=${recs.data?.items?.length}`);

  const follow = await request('POST', `/projects/${p6}/follow`, { token: backer.token });
  check('Theo dõi dự án', follow.status === 200 && follow.data?.following === true);
  const unfollow = await request('DELETE', `/projects/${p6}/follow`, { token: backer.token });
  check('Bỏ theo dõi dự án', unfollow.status === 200 && unfollow.data?.following === false);

  const comment = await request('POST', `/projects/${p6}/comments`, {
    token: backer.token,
    body: { content: 'Smoke test: dự án rất ý nghĩa, mình sẽ ủng hộ.' },
  });
  check('Gửi bình luận', comment.status === 201 && !!comment.data?.comment?.id);

  const before = await request('GET', `/projects/${p6}`);
  const pledge = await request('POST', `/projects/${p6}/pledges`, {
    token: backer.token,
    body: { amount: 100000, method: 'VNPay', is_anonymous: false },
  });
  check('Tài trợ thành công', pledge.status === 201 && pledge.data?.pledge?.amount === 100000, JSON.stringify(pledge.data));
  const after = await request('GET', `/projects/${p6}`);
  check(
    'Trigger cộng tiền sau tài trợ',
    after.data?.current_amount === before.data?.current_amount + 100000,
    `${before.data?.current_amount} -> ${after.data?.current_amount}`,
  );

  const simulateFail = await request('POST', `/projects/${p6}/pledges`, {
    token: backer.token,
    body: { amount: 100000, simulate_failure: true },
  });
  check('Giả lập thanh toán thất bại trả 402', simulateFail.status === 402, JSON.stringify(simulateFail.data));

  const inactivePledge = await request('POST', '/projects/20000000-0000-4000-8000-000000000003/pledges', {
    token: backer.token,
    body: { amount: 100000 },
  });
  check('Không tài trợ dự án đã kết thúc', inactivePledge.status === 400, JSON.stringify(inactivePledge.data));

  const myPledges = await request('GET', '/me/pledges', { token: backer.token });
  check('Lịch sử tài trợ có khoản mới', myPledges.status === 200 && myPledges.data.items.length >= 6, `count=${myPledges.data?.items?.length}`);

  const transactions = await request('GET', '/me/transactions', { token: backer.token });
  check('Lịch sử giao dịch trả dữ liệu', transactions.status === 200 && transactions.data.items.length > 0);

  const notifications = await request('GET', '/me/notifications', { token: backer.token });
  check('Thông báo của backer', notifications.status === 200 && notifications.data.items.length > 0);

  section('Chủ dự án & cộng tác viên');
  const owner = await login('owner@demo.vn');
  check('Đăng nhập owner', owner.user.role === 'owner');

  const ownerProjects = await request('GET', '/me/projects', { token: owner.token });
  check('Owner có 4 dự án', ownerProjects.status === 200 && ownerProjects.data.owned.length === 4, `count=${ownerProjects.data?.owned?.length}`);

  const manage = await request('GET', `/projects/${p1}`, { token: owner.token });
  check('Owner xem được quyền quản lý', manage.data?.can_manage === true);

  const update = await request('POST', `/projects/${p1}/updates`, {
    token: owner.token,
    body: { title: 'Smoke test cập nhật', content: 'Nội dung bản tin kiểm thử tự động, dài hơn mười ký tự.' },
  });
  check('Đăng bản tin tiến độ', update.status === 201);

  const ownPledge = await request('POST', `/projects/${p1}/pledges`, {
    token: owner.token,
    body: { amount: 100000 },
  });
  check('Owner không tự tài trợ dự án mình', ownPledge.status === 400, JSON.stringify(ownPledge.data));

  const payout = await request('POST', `/projects/${p1}/payouts`, {
    token: owner.token,
    body: { amount: 1000000 },
  });
  check('Owner gửi yêu cầu giải ngân', payout.status === 201 && payout.data?.transaction?.status === 'pending', JSON.stringify(payout.data));

  const collab = await login('collab@demo.vn');
  const collabProjects = await request('GET', '/me/projects', { token: collab.token });
  check('Collab thấy lời mời đang chờ', collabProjects.data?.invitations?.length >= 1, `count=${collabProjects.data?.invitations?.length}`);

  const accept = await request('POST', `/me/invitations/${p6}/accept`, { token: collab.token });
  check('Chấp nhận lời mời cộng tác', accept.status === 200);
  const collabAfter = await request('GET', '/me/projects', { token: collab.token });
  check('Collab thấy dự án sau khi nhận', collabAfter.data?.collaborating?.some((p) => p.id === p6));

  const collabEdit = await request('PATCH', `/projects/${p6}`, {
    token: collab.token,
    body: { goal_amount: 999999999 },
  });
  check('Collab không được đổi mục tiêu', collabEdit.status === 403);

  section('Admin');
  const admin = await login('admin@demo.vn');
  check('Đăng nhập admin', admin.user.role === 'admin');

  const stats = await request('GET', '/admin/stats', { token: admin.token });
  check('Thống kê admin', stats.status === 200 && stats.data?.total_projects === 10);
  check('Biểu đồ 7 ngày có 7 điểm', stats.data?.chart?.length === 7, `count=${stats.data?.chart?.length}`);

  const pending = await request('GET', '/admin/projects?status=pending_review', { token: admin.token });
  check('Danh sách chờ duyệt có dự án', pending.status === 200 && pending.data.items.length >= 1);

  const approve = await request('POST', `/admin/projects/${p5}/approve`, { token: admin.token });
  check('Duyệt dự án', approve.status === 200 && approve.data?.project?.status === 'active', JSON.stringify(approve.data));

  const publicAfter = await request('GET', '/projects?limit=50');
  check('Dự án đã duyệt xuất hiện công khai', publicAfter.data?.items?.some((p) => p.id === p5));

  const flags = await request('GET', '/admin/fraud-flags', { token: admin.token });
  check('Danh sách cảnh báo gian lận', flags.status === 200 && flags.data.items.length >= 3);
  const flagId = flags.data.items.find((f) => f.review_status === 'pending')?.id;
  const reviewFlag = await request('PATCH', `/admin/fraud-flags/${flagId}`, {
    token: admin.token,
    body: { review_status: 'false_positive' },
  });
  check('Duyệt cảnh báo báo nhầm', reviewFlag.status === 200 && reviewFlag.data?.flag?.review_status === 'false_positive');

  const reports = await request('GET', '/admin/reports', { token: admin.token });
  check('Danh sách báo cáo', reports.status === 200 && reports.data.items.length >= 2);
  const reportId = reports.data.items.find((r) => r.status === 'open')?.id;
  const reviewReport = await request('PATCH', `/admin/reports/${reportId}`, {
    token: admin.token,
    body: { status: 'reviewed' },
  });
  check('Đánh dấu báo cáo đã xem', reviewReport.status === 200);

  const payouts = await request('GET', '/admin/payouts', { token: admin.token });
  check('Danh sách giải ngân', payouts.status === 200 && payouts.data.items.length >= 3);
  const pendingPayout = payouts.data.items.find((p) => p.status === 'pending');
  const approvePayout = await request('POST', `/admin/payouts/${pendingPayout.id}/approve`, { token: admin.token });
  check('Duyệt giải ngân', approvePayout.status === 200 && approvePayout.data?.transaction?.status === 'success');

  const refund = await request('POST', `/admin/projects/${p4}/refund`, { token: admin.token });
  check('Hoàn tiền dự án thất bại', refund.status === 200 && refund.data?.count === 3, JSON.stringify(refund.data));
  const afterRefund = await request('GET', `/projects/${p4}`, { token: admin.token });
  check('Hoàn tiền đưa current_amount về 0', afterRefund.data?.current_amount === 0, `current=${afterRefund.data?.current_amount}`);

  const users = await request('GET', '/admin/users', { token: admin.token });
  check('Danh sách người dùng', users.status === 200 && users.data.items.length >= 10);

  const lock = await request('PATCH', `/admin/users/${backer.user.id}/status`, {
    token: admin.token,
    body: { status: 'locked' },
  });
  check('Khóa tài khoản', lock.status === 200 && lock.data?.user?.status === 'locked');
  const lockedLogin = await request('POST', '/auth/login', {
    body: { email: 'backer@demo.vn', password: '123456' },
  });
  check('Tài khoản bị khóa không đăng nhập được', lockedLogin.status === 403, JSON.stringify(lockedLogin.data));
  const unlock = await request('PATCH', `/admin/users/${backer.user.id}/status`, {
    token: admin.token,
    body: { status: 'active' },
  });
  check('Mở khóa tài khoản', unlock.status === 200 && unlock.data?.user?.status === 'active');

  const catList = await request('GET', '/admin/categories', { token: admin.token });
  check('Danh sách danh mục', catList.status === 200 && catList.data.items.length === 5);

  const newCat = await request('POST', '/admin/categories', {
    token: admin.token,
    body: { name: 'Smoke test', description: 'Danh mục kiểm thử' },
  });
  check('Thêm danh mục', newCat.status === 201);
  const delCat = await request('DELETE', `/admin/categories/${newCat.data.category.id}`, { token: admin.token });
  check('Xoá danh mục rỗng', delCat.status === 204);

  section('Đăng ký mới → KYC → tạo dự án');
  const email = `smoke${Date.now()}@demo.vn`;
  const register = await request('POST', '/auth/register', {
    body: { full_name: 'Người Dùng Smoke', email, password: '123456' },
  });
  check(
    'Đăng ký tài khoản mới (chưa cấp token)',
    register.status === 201 && register.data?.user?.email === email && !register.data?.token,
    JSON.stringify(register.data),
  );

  let newToken;
  if (register.data?.dev_verification_url) {
    const verifyToken = new URL(register.data.dev_verification_url).searchParams.get('token');
    const verify = await request('POST', '/auth/verify-email', { body: { token: verifyToken } });
    check('Xác thực email tài khoản mới', verify.status === 200 && verify.data?.user?.email_verified === true, JSON.stringify(verify.data));

    const newLogin = await request('POST', '/auth/login', { body: { email, password: '123456' } });
    check('Đăng nhập sau khi xác thực email', newLogin.status === 200 && !!newLogin.data?.token, JSON.stringify(newLogin.data));
    newToken = newLogin.data?.token;
  } else {
    check('Có liên kết xác thực để chạy smoke (SMTP đang bật)', false, JSON.stringify(register.data));
  }
  if (!newToken) {
    throw new Error('Không lấy được token đăng nhập sau xác thực email — dừng smoke test.');
  }

  const noKyc = await request('POST', '/projects', {
    token: newToken,
    body: { title: 'Dự án kiểm thử tự động', description: 'Mô tả đủ dài cho dự án kiểm thử tự động.', category_id: catList.data.items[0].id, goal_amount: 50000000, end_date: iso(30) },
  });
  check('Chưa KYC không tạo được dự án', noKyc.status === 403, JSON.stringify(noKyc.data));

  const kyc = await request('POST', '/me/kyc', { token: newToken });
  check('KYC demo tự duyệt', kyc.status === 200 && kyc.data?.user?.kyc_status === 'verified');

  const created = await request('POST', '/projects', {
    token: newToken,
    body: {
      title: 'Dự án kiểm thử tự động',
      description: 'Mô tả đủ dài cho dự án kiểm thử tự động, bám sát quy trình tạo dự án của đồ án.',
      category_id: catList.data.items[0].id,
      goal_amount: 50000000,
      start_date: iso(0),
      end_date: iso(30),
      rewards: [{ title: 'Gói cảm ơn', min_amount: 100000, quantity_available: 100 }],
    },
  });
  check('Tạo dự án sau KYC', created.status === 201 && created.data?.project?.status === 'pending_review', JSON.stringify(created.data));
  const newProjectId = created.data?.project?.id;

  const meAfterCreate = await request('GET', '/auth/me', { token: newToken });
  check('Backer được nâng thành owner', meAfterCreate.data?.user?.role === 'owner');

  const approveNew = await request('POST', `/admin/projects/${newProjectId}/approve`, { token: admin.token });
  check('Admin duyệt dự án mới', approveNew.status === 200 && approveNew.data?.project?.status === 'active');

  const newDetail = await request('GET', `/projects/${newProjectId}`);
  check('Dự án mới có reward', newDetail.data?.rewards?.length === 1);

  section('Tổng kết');
  console.log(`\n✅ ${passed} passed   ❌ ${failed} failed`);
  if (failed) {
    console.log('\nChi tiết lỗi:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\n💥 Smoke test dừng do lỗi:', err.message);
  process.exitCode = 1;
});
