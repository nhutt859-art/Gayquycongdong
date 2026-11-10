import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { trainModel, predictAllProjects } from '../src/services/ai-model.js';
import { refreshRecommendations } from '../src/services/ai.js';
import { closePool } from '../src/db.js';

const { Client } = pg;
const APPLY = process.argv.includes('--apply');
const DRY_RUN = process.argv.includes('--dry-run');
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
const sslDisabled = String(process.env.PGSSL || 'require').toLowerCase() === 'disable';

if (!connectionString) {
  console.error('Thiếu DATABASE_URL (hoặc DIRECT_URL) trong backend/.env');
  process.exit(1);
}

if (!APPLY && !DRY_RUN) {
  console.log('\nĐây là script reseed dữ liệu lịch sử mô phỏng cho môi trường demo.');
  console.log('Script sẽ xoá toàn bộ dự án/pledge/giao dịch cũ và tạo ~200 dự án lịch sử.');
  console.log('Tài khoản admin thật (email không phải @demo.vn / @gayquy.vn) được giữ lại.');
  console.log('Chạy thử không ghi database: npm run db:seed:realistic -- --dry-run');
  console.log('Chạy thật: npm run db:seed:realistic -- --apply\n');
  process.exit(0);
}

const client = new Client({
  connectionString,
  ssl: sslDisabled ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
});

const NOW = new Date();
const DAY = 86_400_000;
const PASSWORD_HASH = bcrypt.hashSync('12345678', 10);

// PRNG cố định để bộ dữ liệu tái lập được.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261105);
const rand = () => rng();
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const roundTo = (n, step = 10_000) => Math.max(step, Math.round(n / step) * step);
const gaussian = () => {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const logNormal = (median, sigma = 0.6) => median * Math.exp(gaussian() * sigma);
const sigmoid = (z) => 1 / (1 + Math.exp(-clamp(z, -20, 20)));

function daysAgo(n) {
  return new Date(NOW.getTime() - n * DAY);
}
function daysFromNow(n) {
  return new Date(NOW.getTime() + n * DAY);
}
function dateOnly(date) {
  return new Date(date).toISOString().slice(0, 10);
}
function addDays(date, n) {
  return new Date(new Date(date).getTime() + n * DAY);
}
function randomHour(date, { evening = true } = {}) {
  const d = new Date(date);
  const hour = evening && chance(0.55) ? randInt(18, 22) : randInt(7, 17);
  d.setHours(hour, randInt(0, 59), randInt(0, 59), 0);
  return d;
}
function uuid(prefix, n) {
  return `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}
function removeDiacritics(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}
function slugEmail(name, index, domain = 'gmail.com') {
  const slug = removeDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return `${slug}.${index}@${domain}`;
}

const CATEGORIES = [
  {
    id: uuid('b0000000', 1),
    name: 'Giáo dục',
    description: 'Học bổng, trường học, thư viện và thiết bị học tập cho trẻ em vùng khó khăn.',
    medianGoal: 280_000_000,
    bonus: 0.22,
  },
  {
    id: uuid('b0000000', 2),
    name: 'Y tế',
    description: 'Thiết bị y tế, viện phí, trạm y tế và chăm sóc sức khoẻ cộng đồng.',
    medianGoal: 360_000_000,
    bonus: 0.14,
  },
  {
    id: uuid('b0000000', 3),
    name: 'Môi trường',
    description: 'Trồng rừng, sông sạch, tái chế và ứng phó biến đổi khí hậu.',
    medianGoal: 320_000_000,
    bonus: 0.06,
  },
  {
    id: uuid('b0000000', 4),
    name: 'Cộng đồng',
    description: 'Mái ấm, bếp ăn, sinh kế và hỗ trợ nhóm yếu thế.',
    medianGoal: 220_000_000,
    bonus: 0.10,
  },
  {
    id: uuid('b0000000', 5),
    name: 'Văn hoá',
    description: 'Di sản, làng nghề, nghệ thuật và không gian văn hoá cộng đồng.',
    medianGoal: 180_000_000,
    bonus: -0.06,
  },
  {
    id: uuid('b0000000', 6),
    name: 'Khởi nghiệp',
    description: 'Startup xã hội, nông nghiệp bền vững và mô hình sinh kế.',
    medianGoal: 420_000_000,
    bonus: -0.16,
  },
];

const PLACES = [
  'Mường Lát', 'Hà Giang', 'Sơn La', 'Cao Bằng', 'Quảng Bình', 'Nghệ An',
  'Điện Biên', 'Lào Cai', 'Bến Tre', 'Cà Mau', 'Phú Yên', 'Kon Tum',
  'Gia Lai', 'Thừa Thiên Huế', 'Ninh Thuận', 'Quảng Ngãi', 'Bình Định', 'Yên Bái',
];

const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Ngô', 'Dương', 'Lý', 'Trịnh', 'Đinh', 'Tạ', 'Phan', 'Lâm', 'Mai', 'Tô', 'Vương'];
const DEM = [
  'Minh Anh', 'Thu Hà', 'Ngọc Lan', 'Quốc Hùng', 'Thanh Thảo', 'Hoàng Nam', 'Mai Phương', 'Đức Long', 'Bảo Trâm', 'Khánh Linh',
  'Văn Sơn', 'Thị Hoa', 'Gia Huy', 'Tuấn Kiệt', 'Phương Thảo', 'Hải Yến', 'Trung Hiếu', 'Mỹ Duyên', 'Quang Vinh', 'Kim Ngân',
  'Anh Tuấn', 'Diệu Linh', 'Minh Quân', 'Thu Trang', 'Hữu Phước', 'Ngọc Hà', 'Thành Đạt', 'Bích Ngọc', 'Đình Khoa', 'Lan Anh',
  'Bảo An', 'Gia Bảo', 'Minh Châu', 'Quốc Cường', 'Thùy Dung', 'Hồng Đức', 'Tiến Dũng', 'Mỹ Hạnh', 'Việt Hoàng', 'Thanh Huyền',
  'Khánh Hòa', 'Đức Huy', 'Thu Hương', 'Minh Khang', 'Tuấn Long', 'Hoàng Mai', 'Thiện Minh', 'Yến Nhi', 'Hữu Nghĩa', 'Bảo Ngọc',
  'Thành Nhân', 'Ánh Phương', 'Minh Phúc', 'Hồng Quân', 'Thanh Sơn', 'Minh Tâm', 'Anh Thư', 'Đức Toàn', 'Hoài Trang', 'Quốc Trung',
];
const ORGANIZATIONS = [
  'Quỹ Học Bổng Vùng Cao', 'Nhóm Sông Sạch', 'Mái Ấm Y Tế', 'Hội Chữ Thập Đỏ Cộng Đồng',
  'Trung Tâm Sinh Kế Bền Vững', 'Nhóm Trồng Rừng Ven Biển', 'Quỹ Bảo Tồn Di Sản', 'Hợp Tác Xã Thổ Cẩm',
  'Nhóm Bếp Ăn 0 Đồng', 'Quỹ Trẻ Em Miền Núi', 'Nhóm Nông Nghiệp Sạch', 'Trung Tâm Cộng Đồng Xanh',
  'Hội Người Cao Tuổi', 'Nhóm Xe Cứu Thương Đảo', 'Quỹ Sách Cho Em', 'Nhóm Tái Chế Cộng Đồng',
];

const OWNER_NAMES = [
  ...ORGANIZATIONS.slice(0, 12).map((name, index) => ({
    name,
    organization: true,
    email: slugEmail(name, index + 1, 'gayquy.vn'),
  })),
  ...Array.from({ length: 24 }, (_, index) => {
    const name = `${HO[index % HO.length]} ${DEM[Math.floor(index / HO.length) % DEM.length]}`;
    return { name, organization: false, email: slugEmail(name, index + 1, 'gmail.com') };
  }),
];

const BACKER_NAMES = Array.from({ length: 1200 }, (_, index) => {
  const name = `${HO[index % HO.length]} ${DEM[Math.floor(index / HO.length) % DEM.length]}`;
  return { name, email: slugEmail(name, index + 101, index % 4 === 0 ? 'gayquy.vn' : 'gmail.com') };
});

const TEST_USERS = [
  { name: 'Nguyễn Minh Anh', email: 'minhanh.nguyen@gayquy.vn', role: 'backer', kyc: 'verified', trust: 88, quality: 0.8 },
  { name: 'Trần Hoàng Nam', email: 'hoang.nam.tran@gayquy.vn', role: 'owner', kyc: 'verified', trust: 91, quality: 0.86 },
  { name: 'Lê Thu Hà', email: 'thu.ha.le@gayquy.vn', role: 'backer', kyc: 'verified', trust: 84, quality: 0.72 },
];

function categoryFor(index) {
  return CATEGORIES[index % CATEGORIES.length];
}

function buildUsers() {
  const users = [];
  let seq = 1;
  for (const [index, owner] of OWNER_NAMES.entries()) {
    const org = owner.organization;
    const quality = org ? 0.62 + rand() * 0.33 : 0.28 + rand() * 0.62;
    const kyc = org ? (chance(0.9) ? 'verified' : 'pending') : (chance(0.62) ? 'verified' : chance(0.2) ? 'pending' : 'none');
    const trust = clamp(Math.round(42 + quality * 48 + (kyc === 'verified' ? 8 : -4) + gaussian() * 5), 22, 98);
    const createdDays = randInt(120, 1000);
    users.push({
      id: uuid('10000000', seq++),
      full_name: owner.name,
      email: owner.email,
      password_hash: PASSWORD_HASH,
      phone: `09${randInt(10000000, 99999999)}`,
      role: 'owner',
      kyc_status: kyc,
      trust_score: trust,
      status: chance(0.03) ? 'locked' : 'active',
      email_verified_at: daysAgo(createdDays - randInt(1, 20)),
      created_at: daysAgo(createdDays),
      quality,
      categoryBias: org ? (index % CATEGORIES.length) : null,
      seedKind: 'owner',
    });
  }

  for (const [index, backer] of BACKER_NAMES.entries()) {
    const quality = 0.35 + rand() * 0.6;
    const kyc = chance(0.55) ? 'verified' : chance(0.25) ? 'pending' : 'none';
    const trust = clamp(Math.round(45 + quality * 42 + (kyc === 'verified' ? 6 : -3) + gaussian() * 6), 20, 97);
    const createdDays = randInt(30, 1200);
    users.push({
      id: uuid('10000000', seq++),
      full_name: backer.name,
      email: backer.email,
      password_hash: PASSWORD_HASH,
      phone: `09${randInt(10000000, 99999999)}`,
      role: 'backer',
      kyc_status: kyc,
      trust_score: trust,
      status: chance(0.02) ? 'locked' : 'active',
      email_verified_at: daysAgo(createdDays - randInt(1, 10)),
      created_at: daysAgo(createdDays),
      quality,
      categoryBias: index % CATEGORIES.length,
      seedKind: 'backer',
    });
  }

  for (const test of TEST_USERS) {
    users.push({
      id: uuid('10000000', seq++),
      full_name: test.name,
      email: test.email,
      password_hash: PASSWORD_HASH,
      phone: `09${randInt(10000000, 99999999)}`,
      role: test.role,
      kyc_status: test.kyc,
      trust_score: test.trust,
      status: 'active',
      email_verified_at: daysAgo(randInt(200, 500)),
      created_at: daysAgo(randInt(200, 500)),
      quality: test.quality,
      categoryBias: 0,
      seedKind: 'test',
    });
  }

  return users;
}

const TITLE_TEMPLATES = {
  'Giáo dục': [
    (p) => `Học bổng đến trường cho 120 em vùng cao ${p}`,
    (p) => `Thư viện cộng đồng tại ${p}`,
    (p) => `Sửa phòng học sau mưa lũ ở ${p}`,
    (p) => `100 bộ sách và đồ dùng học tập cho trẻ em ${p}`,
    (p) => `Nuôi dưỡng bữa trưa cho học sinh bán trú ${p}`,
    (p) => `Xe đạp đến trường cho học sinh xa nhà ${p}`,
  ],
  'Y tế': [
    (p) => `Máy lọc nước cho trạm y tế xã ${p}`,
    (p) => `Xe cứu thương cho trạm y tế đảo ${p}`,
    (p) => `Bữa ăn dinh dưỡng cho bệnh nhi ${p}`,
    (p) => `Thiết bị cấp cứu cho trạm y tế ${p}`,
    (p) => `Khám sức khoẻ miễn phí cho người già ${p}`,
    (p) => `Tủ thuốc thiết yếu cho bản làng ${p}`,
  ],
  'Môi trường': [
    (p) => `Trồng 10.000 cây bản địa ven biển ${p}`,
    (p) => `Hồi sinh dòng sông ${p}`,
    (p) => `Lắp lưới chắn rác cửa sông ${p}`,
    (p) => `Mô hình tái chế nhựa cộng đồng ${p}`,
    (p) => `Vườn ươm cây rừng cho ${p}`,
    (p) => `Làm sạch bãi biển và trồng rừng ngập mặn ${p}`,
  ],
  'Cộng đồng': [
    (p) => `Mái ấm cho người già neo đơn ${p}`,
    (p) => `Bếp ăn 0 đồng cho bệnh nhân nghèo ${p}`,
    (p) => `Nhà sinh hoạt cộng đồng cho ${p}`,
    (p) => `Hỗ trợ sinh kế cho phụ nữ đơn thân ${p}`,
    (p) => `Nước sạch cho hộ nghèo ${p}`,
    (p) => `Sửa nhà cho gia đình chính sách ${p}`,
  ],
  'Văn hoá': [
    (p) => `Khôi phục nghề dệt thổ cẩm ${p}`,
    (p) => `Bảo tồn nhà cổ và không gian làng ${p}`,
    (p) => `Lớp truyền nghề cho thanh niên ${p}`,
    (p) => `Phục dựng lễ hội truyền thống ${p}`,
    (p) => `Thư viện di sản địa phương ${p}`,
    (p) => `Sân khấu cộng đồng cho trẻ em ${p}`,
  ],
  'Khởi nghiệp': [
    (p) => `Nông trại hữu cơ của phụ nữ ${p}`,
    (p) => `Xưởng tái chế nhựa cộng đồng ${p}`,
    (p) => `Mô hình trồng nấm sạch ${p}`,
    (p) => `Chuỗi cà phê đặc sản ${p}`,
    (p) => `Xưởng may cho lao động nông thôn ${p}`,
    (p) => `Trang trại nuôi ong bền vững ${p}`,
  ],
};

const REWARD_TITLES = {
  'Giáo dục': ['Thư cảm ơn điện tử', 'Bộ sách thiếu nhi', 'Tên trên bảng tri ân', 'Học bổng 1 tháng', 'Đồng hành 1 năm học'],
  'Y tế': ['Thư cảm ơn', 'Tên trên bảng tri ân', 'Gói khám sức khoẻ', 'Ủng hộ 1 ngày thuốc', 'Đồng hành thiết bị'],
  'Môi trường': ['Thư cảm ơn + ảnh cây', 'Cây mang tên bạn', 'Áo chiến dịch', 'Ngày trồng cây cùng cộng đồng', 'Gói doanh nghiệp xanh'],
  'Cộng đồng': ['Thư cảm ơn', 'Bữa ăn 0 đồng', 'Tên trên bảng tri ân', 'Gói quà cộng đồng', 'Đồng hành 3 tháng'],
  'Văn hoá': ['Postcard thổ cẩm', 'Khăn thủ công', 'Vé trải nghiệm làng nghề', 'Tên trên bảng tri ân', 'Gói quà lưu niệm'],
  'Khởi nghiệp': ['Thư cảm ơn', 'Giỏ nông sản', 'Trải nghiệm tại nông trại', 'Tên trên bảng tri ân', 'Gói đồng hành doanh nghiệp'],
};

const REWARD_AMOUNTS = [100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000];

const SUSPICIOUS_DESCRIPTIONS = [
  (title, goalText) =>
    `${title} là cơ hội đầu tư sinh lời nhanh với cam kết lợi nhuận 50%/tháng, không rủi ro. Chỉ cần góp vốn ${goalText}, nhà đầu tư sẽ nhận lại vốn và lợi nhuận sau 30 ngày. Dự án đang mở gấp, số suất có hạn, ai nhanh thì được. Liên hệ chuyển khoản riêng để nhận ưu đãi.`,
  (title) =>
    `${title}. Mở gấp, suất có hạn. Chuyển khoản riêng để giữ suất.`,
  (title, goalText) =>
    `${title} cam kết lợi nhuận cố định 30%/tháng, bao lãi và không rủi ro. Góp vốn ${goalText}, nhận lãi sau 30 ngày. Dự án đang mở gấp, số suất có hạn.`,
];

function buildDescription(category, title, goal, duration, suspicious = false, suspiciousStyle = 0) {
  const goalText = `${Math.round(goal / 1_000_000).toLocaleString('vi-VN')} triệu đồng`;
  if (suspicious) {
    return SUSPICIOUS_DESCRIPTIONS[suspiciousStyle % SUSPICIOUS_DESCRIPTIONS.length](title, goalText);
  }
  const categoryPlan = {
    'Giáo dục': 'rà soát danh sách học sinh khó khăn, phối hợp nhà trường và chính quyền địa phương để trao học bổng, sách và đồ dùng học tập đúng đối tượng',
    'Y tế': 'làm việc với trạm y tế xã, lựa chọn thiết bị phù hợp nhu cầu khám chữa bệnh và tổ chức tập huấn sử dụng cho nhân viên y tế',
    'Môi trường': 'khảo sát hiện trạng, thiết kế phương án trồng và chăm sóc cây, huy động tình nguyện viên địa phương tham gia các ngày hành động',
    'Cộng đồng': 'phối hợp tổ chức địa phương rà soát hộ khó khăn, công khai danh sách thụ hưởng và tổ chức các hoạt động hỗ trợ trực tiếp',
    'Văn hoá': 'làm việc với nghệ nhân và chính quyền địa phương để phục dựng không gian, mở lớp truyền nghề và quảng bá sản phẩm',
    'Khởi nghiệp': 'hoàn thiện mô hình sản xuất, đào tạo kỹ năng vận hành và kết nối đầu ra cho nhóm lao động địa phương',
  }[category.name];
  return `${title} nhằm giải quyết một vấn đề đang được cộng đồng địa phương quan tâm. Nhóm thực hiện đã khảo sát thực địa, xác định nhu cầu và xây dựng kế hoạch triển khai trong ${duration} ngày.

Kế hoạch chính gồm: ${categoryPlan}. Mỗi hạng mục đều có người phụ trách, thời hạn hoàn thành và tiêu chí nghiệm thu rõ ràng. Nhóm sẽ đăng bản tin tiến độ hàng tuần kèm hình ảnh, hoá đơn và báo cáo tài chính.

Tổng kinh phí dự kiến ${goalText}, trong đó ưu tiên chi trực tiếp cho hoạt động chuyên môn, vật tư và hỗ trợ đối tượng thụ hưởng. Chi phí vận hành được giữ ở mức tối thiểu. Sau khi chiến dịch kết thúc, toàn bộ sao kê và báo cáo kết quả sẽ được công khai để nhà tài trợ đối chiếu.

Nhóm cam kết minh bạch, phản hồi bình luận trong 24 giờ và hoàn trả kinh phí theo quy định nếu dự án không thể triển khai.`;
}

function buildProjects(users) {
  const owners = users.filter((u) => u.role === 'owner' && u.seedKind !== 'test');
  const testOwner = users.find((u) => u.email === 'hoang.nam.tran@gayquy.vn');
  const allOwners = [...owners, testOwner];
  const projects = [];
  let seq = 1;

  function makeProject({ status, createdDays, duration, category, owner, suspicious = false, suspiciousStyle = 0 }) {
    const place = pick(PLACES);
    const title = pick(TITLE_TEMPLATES[category.name])(place);
    const goal = roundTo(logNormal(category.medianGoal, 0.5), 10_000_000);
    // Không để dự án ra đời trước tài khoản chủ dự án. Với dự án đã kết thúc,
    // còn phải bảo đảm ngày kết thúc nằm trong quá khứ.
    const ownerAgeDays = Math.max(30, Math.floor((NOW - new Date(owner.created_at)) / DAY));
    const safeDuration = Math.max(14, Math.min(duration, ownerAgeDays - 4));
    const isClosed = !['active', 'pending_review'].includes(status);
    const minCreatedDays = isClosed ? safeDuration + 2 : 1;
    const maxCreatedDays = Math.max(minCreatedDays, ownerAgeDays - 1);
    const safeCreatedDays = clamp(createdDays, minCreatedDays, maxCreatedDays);
    const start = randomHour(daysAgo(safeCreatedDays), { evening: false });
    const end = addDays(start, safeDuration);
    const rewardCount = suspicious ? 0 : clamp(Math.round(logNormal(2.6, 0.5)), 0, 5);
    const description = buildDescription(category, title, goal, safeDuration, suspicious, suspiciousStyle);
    const ownerQuality = owner.quality ?? 0.5;
    const categoryBonus = category.bonus;
    const goalZ = (Math.log10(goal) - Math.log10(category.medianGoal)) / 0.45;
    const durationZ = (safeDuration - 45) / 20;
    const rewardZ = (rewardCount - 2.5) / 1.2;
    const descZ = (description.length - 700) / 300;
    const z =
      0.52 +
      0.95 * (ownerQuality - 0.5) -
      0.42 * goalZ -
      0.12 * durationZ +
      0.22 * rewardZ +
      0.12 * descZ +
      categoryBonus +
      gaussian() * 0.58;
    const probability = sigmoid(z);
    return {
      id: uuid('20000000', seq++),
      owner,
      category,
      title,
      description,
      cover_emoji: pick({ 'Giáo dục': ['🎒', '📚', '🏫'], 'Y tế': ['💧', '🚑', '❤️'], 'Môi trường': ['🌱', '🌊', '♻️'], 'Cộng đồng': ['🏠', '🍚', '🤝'], 'Văn hoá': ['🏮', '🧵', '🎭'], 'Khởi nghiệp': ['🌾', '🍄', '🐝'] }[category.name]),
      cover_image_url: `https://picsum.photos/seed/${removeDiacritics(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}/900/500`,
      goal_amount: goal,
      start_date: dateOnly(start),
      end_date: dateOnly(end),
      status,
      suspicious,
      probability,
      duration_days: safeDuration,
      reward_count: rewardCount,
      created_at: start,
      owner_quality: ownerQuality,
    };
  }

  // 176 dự án đã kết thúc: 112 thành công + 64 thất bại, ưu tiên phân bổ theo xác suất.
  const historical = [];
  for (let i = 0; i < 176; i += 1) {
    const category = categoryFor(randInt(0, CATEGORIES.length - 1));
    const owner = pick(allOwners);
    const duration = randInt(30, 90);
    const createdDays = randInt(duration + 5, 1000);
    historical.push(makeProject({ status: 'candidate', createdDays, duration, category, owner }));
  }
  historical.sort((a, b) => b.probability - a.probability);
  historical.slice(0, 112).forEach((p) => { p.status = 'successful'; });
  historical.slice(112).forEach((p) => { p.status = 'failed'; });
  projects.push(...historical);

  // 16 dự án đang gây quỹ, trải đều các danh mục.
  for (let i = 0; i < 16; i += 1) {
    const category = CATEGORIES[i % CATEGORIES.length];
    const owner = i === 0 ? testOwner : pick(allOwners);
    const duration = randInt(35, 75);
    const elapsed = randInt(4, Math.max(5, duration - 8));
    const createdDays = elapsed;
    const p = makeProject({ status: 'active', createdDays, duration, category, owner });
    p.progress = clamp(0.12 + rand() * 0.8, 0.12, 0.94);
    projects.push(p);
  }

  // 5 dự án chờ duyệt, trong đó có 2 hồ sơ đáng ngờ.
  for (let i = 0; i < 5; i += 1) {
    const category = categoryFor(randInt(0, CATEGORIES.length - 1));
    const owner = i < 2 ? pick(allOwners.filter((o) => o.kyc_status !== 'verified' || o.trust_score < 55)) : pick(allOwners);
    const duration = randInt(30, 70);
    const p = makeProject({
      status: 'pending_review',
      createdDays: randInt(1, 9),
      duration,
      category,
      owner: owner || allOwners[0],
      suspicious: i < 2,
      suspiciousStyle: i,
    });
    projects.push(p);
  }

  // 3 dự án đã dừng.
  for (let i = 0; i < 3; i += 1) {
    const category = categoryFor(randInt(0, CATEGORIES.length - 1));
    const owner = pick(allOwners);
    const duration = randInt(30, 80);
    const p = makeProject({
      status: 'canceled',
      createdDays: randInt(duration + 5, 180),
      duration,
      category,
      owner,
      suspicious: i === 0,
    });
    p.progress = 0.15 + rand() * 0.4;
    projects.push(p);
  }

  // Gắn thêm vài hồ sơ có dấu hiệu bất thường vào nhóm đã kết thúc để admin có dữ liệu đối chiếu.
  // Ưu tiên chủ dự án chưa KYC hoặc tín nhiệm thấp để cảnh báo có đủ bằng chứng.
  const suspiciousCandidates = [];
  const suspiciousPerOwner = new Map();
  const rankedCandidates = projects
    .filter((p) => ['failed', 'canceled'].includes(p.status))
    .filter((p) => p.owner.kyc_status !== 'verified' || p.owner.trust_score < 55)
    .sort((a, b) => a.owner.trust_score - b.owner.trust_score);
  let candidateIndex = 0;
  for (const project of rankedCandidates) {
    const count = suspiciousPerOwner.get(project.owner.id) || 0;
    if (count >= 1) continue;
    const originalDescription = project.description;
    const originalRewardCount = project.reward_count;
    project.reward_count = 0;
    const passingStyles = [];
    for (let style = 0; style < SUSPICIOUS_DESCRIPTIONS.length; style += 1) {
      project.description = buildDescription(project.category, project.title, project.goal_amount, project.duration_days, true, style);
      const evidence = projectFraudEvidence(project, projects);
      if (evidence.score >= 60) passingStyles.push({ style, score: evidence.score });
    }
    if (!passingStyles.length) {
      project.description = originalDescription;
      project.reward_count = originalRewardCount;
      candidateIndex += 1;
      continue;
    }
    const chosen = passingStyles[candidateIndex % passingStyles.length];
    project.description = buildDescription(project.category, project.title, project.goal_amount, project.duration_days, true, chosen.style);
    suspiciousPerOwner.set(project.owner.id, count + 1);
    project.suspicious = true;
    suspiciousCandidates.push(project);
    candidateIndex += 1;
    if (suspiciousCandidates.length >= 6) break;
  }

  return projects;
}

function buildRewards(projects) {
  const rewards = [];
  let seq = 1;
  for (const project of projects) {
    const titles = REWARD_TITLES[project.category.name];
    const count = Math.min(project.reward_count, titles.length);
    const used = new Set();
    for (let i = 0; i < count; i += 1) {
      let title = titles[i];
      if (used.has(title)) title = `${title} ${i + 1}`;
      used.add(title);
      const min = REWARD_AMOUNTS[Math.min(i, REWARD_AMOUNTS.length - 1)] + (chance(0.3) ? randInt(1, 4) * 50_000 : 0);
      rewards.push({
        id: uuid('30000000', seq++),
        project_id: project.id,
        title,
        description: `Quà tri ân dành cho nhà tài trợ từ ${Math.round(min / 1000).toLocaleString('vi-VN')} nghìn đồng. Số lượng có hạn, đội dự án liên hệ sau khi chiến dịch kết thúc.`,
        min_amount: min,
        quantity_available: pick([30, 50, 100, 200, 300, 500]),
      });
    }
  }
  return rewards;
}

function buildPledges(projects, users, rewards) {
  const backers = users.filter((u) => u.seedKind === 'backer' || u.seedKind === 'test' || u.role === 'owner');
  // Phân bố dài đuôi: phần lớn người dùng tài trợ vài lần, một nhóm nhỏ là
  // người ủng hộ thường xuyên. Nhờ vậy dữ liệu không bị "mỗi người 80 lần".
  const backerPool = [];
  for (const backer of backers) {
    const weight = clamp(Math.round(Math.exp(gaussian() * 0.75)), 1, 7);
    for (let i = 0; i < weight; i += 1) backerPool.push(backer);
  }
  const rewardsByProject = new Map();
  for (const reward of rewards) {
    const list = rewardsByProject.get(reward.project_id) || [];
    list.push(reward);
    rewardsByProject.set(reward.project_id, list);
  }
  const pledges = [];
  const userCategoryCounts = new Map();
  let seq = 1;

  for (const project of projects) {
    let target = 0;
    if (project.status === 'successful') target = project.goal_amount * (1.02 + rand() * 0.38);
    else if (project.status === 'failed') target = project.goal_amount * (0.2 + rand() * 0.72);
    else if (project.status === 'active') target = project.goal_amount * (project.progress ?? 0.35);
    else if (project.status === 'canceled') target = project.goal_amount * (project.progress ?? 0.3);
    if (target < 50_000) continue;

    const n = clamp(Math.round(Math.sqrt(target / 1_000_000) * 2.2), 4, 46);
    const projectRewards = rewardsByProject.get(project.id) || [];
    const start = new Date(project.start_date);
    const end = new Date(project.end_date);
    const maxTime = project.status === 'active' ? new Date(Math.min(end.getTime(), NOW.getTime())) : end;
    const eligibleBackers = backerPool.filter(
      (backer) => backer.id !== project.owner.id && new Date(backer.created_at).getTime() < maxTime.getTime(),
    );
    if (!eligibleBackers.length) continue;
    let remaining = Math.round(target / 10_000) * 10_000;
    const amounts = [];
    for (let i = 0; i < n - 1; i += 1) {
      const slotsLeft = n - i;
      const maxForThis = Math.max(10_000, remaining - 10_000 * (slotsLeft - 1));
      const base = remaining / slotsLeft;
      let amount = roundTo(clamp(logNormal(base, 0.65), 10_000, maxForThis), 10_000);
      if (amount > maxForThis) amount = roundTo(maxForThis, 10_000);
      amounts.push(amount);
      remaining -= amount;
    }
    amounts.push(Math.max(10_000, roundTo(remaining, 10_000)));

    for (const amount of amounts) {
      const backer = pick(eligibleBackers);
      const earliest = Math.max(start.getTime(), new Date(backer.created_at).getTime());
      const fraction = Math.pow(rand(), 1.45);
      const ts = randomHour(new Date(earliest + fraction * (maxTime.getTime() - earliest)));
      if (ts.getTime() < earliest) ts.setTime(earliest);
      if (ts.getTime() > maxTime.getTime()) ts.setTime(maxTime.getTime() - 1);
      const affordable = projectRewards.filter((r) => amount >= Number(r.min_amount));
      const reward = affordable.length && chance(0.72) ? affordable[affordable.length - 1] : null;
      const refunded =
        (project.status === 'failed' && chance(0.15)) ||
        (project.status === 'canceled' && chance(0.6)) ||
        (project.status === 'successful' && chance(0.01));
      const pledge = {
        id: uuid('40000000', seq++),
        project_id: project.id,
        backer_id: backer.id,
        reward_id: reward?.id || null,
        amount,
        is_anonymous: chance(0.08),
        status: refunded ? 'refunded' : 'paid',
        created_at: ts,
        method: chance(0.55) ? 'VNPay' : chance(0.75) ? 'Momo' : 'Thẻ quốc tế',
      };
      pledges.push(pledge);
      if (!refunded) {
        const key = `${backer.id}:${project.category.id}`;
        userCategoryCounts.set(key, (userCategoryCounts.get(key) || 0) + 1);
      }
    }
  }

  // Vài giao dịch đáng ngờ, có cùng tài khoản và thời điểm để mô hình gian lận có bằng chứng.
  const suspiciousProject = projects.find((p) => p.status === 'active') || projects[0];
  const suspiciousBacker = backers.find((u) => u.trust_score < 45) || backers[0];
  if (suspiciousProject && suspiciousBacker && suspiciousProject.owner.id !== suspiciousBacker.id) {
    for (let i = 0; i < 3; i += 1) {
      const ts = new Date(NOW.getTime() - 4 * 60_000 + i * 45_000);
      pledges.push({
        id: uuid('40000000', seq++),
        project_id: suspiciousProject.id,
        backer_id: suspiciousBacker.id,
        reward_id: null,
        amount: 60_000_000 + i * 10_000_000,
        is_anonymous: i === 2,
        status: 'paid',
        created_at: ts,
        method: 'VNPay',
        suspicious: true,
      });
    }
  }

  return { pledges, userCategoryCounts };
}

function buildTransactions(pledges) {
  const transactions = [];
  let seq = 1;
  for (const pledge of pledges) {
    transactions.push({
      id: uuid('50000000', seq++),
      pledge_id: pledge.id,
      project_id: pledge.project_id,
      type: 'payment',
      amount: pledge.amount,
      method: pledge.method,
      gateway_ref: `${pledge.method.replace(/\s+/g, '').toUpperCase()}-${String(seq).padStart(6, '0')}`,
      status: 'success',
      created_at: pledge.created_at,
    });
    if (pledge.status === 'refunded') {
      transactions.push({
        id: uuid('50000000', seq++),
        pledge_id: pledge.id,
        project_id: pledge.project_id,
        type: 'refund',
        amount: pledge.amount,
        method: 'bank_transfer',
        gateway_ref: `REFUND-${String(seq).padStart(6, '0')}`,
        status: 'success',
        created_at: new Date(
          Math.min(NOW.getTime() - 3_600_000, new Date(pledge.created_at).getTime() + randInt(2, 20) * DAY),
        ),
      });
    }
  }
  return transactions;
}

function buildPayouts(projects, pledges) {
  const payouts = [];
  let seq = 1;
  for (const project of projects) {
    const paid = pledges
      .filter((p) => p.project_id === project.id && p.status === 'paid')
      .reduce((sum, p) => sum + p.amount, 0);
    if (!paid) continue;
    if (project.status === 'successful' && chance(0.85)) {
      const total = Math.round(paid * (0.55 + rand() * 0.35));
      const count = randInt(1, 2);
      let left = total;
      for (let i = 0; i < count; i += 1) {
        const amount = i === count - 1 ? left : Math.round(left * (0.45 + rand() * 0.2));
        left -= amount;
        if (amount < 100_000) continue;
        const earliest = new Date(project.end_date).getTime() + DAY;
        const latest = Math.max(earliest, NOW.getTime() - 3_600_000);
        const created = new Date(earliest + rand() * (latest - earliest));
        payouts.push({
          id: uuid('5b000000', seq++),
          pledge_id: null,
          project_id: project.id,
          type: 'payout',
          amount,
          method: 'bank_transfer',
          gateway_ref: `PAYOUT-${String(seq).padStart(6, '0')}`,
          status: chance(0.75) ? 'success' : 'pending',
          created_at: created,
        });
      }
    } else if (project.status === 'active' && chance(0.2)) {
      const amount = Math.round(paid * (0.1 + rand() * 0.2));
      if (amount >= 100_000) {
        payouts.push({
          id: uuid('5b000000', seq++),
          pledge_id: null,
          project_id: project.id,
          type: 'payout',
          amount,
          method: 'bank_transfer',
          gateway_ref: `PAYOUT-${String(seq).padStart(6, '0')}`,
          status: 'pending',
          created_at: daysAgo(randInt(1, 5)),
        });
      }
    }
  }
  return payouts;
}

const UPDATE_TITLES = [
  'Cập nhật tiến độ tuần này',
  'Báo cáo tài chính tháng gần nhất',
  'Khởi công hạng mục đầu tiên',
  'Cảm ơn những nhà tài trợ đầu tiên',
  'Hình ảnh thực địa và kết quả bước đầu',
  'Điều chỉnh kế hoạch do thời tiết',
  'Hoàn thành một phần mục tiêu',
];
const UPDATE_CONTENT = [
  'Đội dự án đã hoàn thành phần việc đầu tiên và đang tiếp tục triển khai theo kế hoạch. Cảm ơn các nhà tài trợ đã đồng hành.',
  'Báo cáo tài chính kỳ này đã được cập nhật, kèm hoá đơn và hình ảnh nghiệm thu. Mọi thắc mắc xin để lại bình luận.',
  'Chúng tôi đã làm việc với đối tác địa phương để thống nhất tiến độ và tiêu chí nghiệm thu cho giai đoạn tiếp theo.',
  'Nhóm đã tổ chức hoạt động cộng đồng với sự tham gia của tình nguyện viên và người dân địa phương. Kết quả cụ thể sẽ được cập nhật trong tuần tới.',
  'Một số hạng mục bị chậm do điều kiện thời tiết. Nhóm đã điều chỉnh lịch và sẽ bù tiến độ trong tháng này.',
  'Cảm ơn các nhà tài trợ đã tin tưởng. Nhóm cam kết công khai đầy đủ chi phí và kết quả sau khi hoàn thành.',
];

function buildUpdates(projects, users) {
  const updates = [];
  let seq = 1;
  for (const project of projects) {
    const count = project.status === 'successful' ? randInt(2, 5) : project.status === 'active' ? randInt(1, 4) : project.status === 'failed' ? randInt(0, 2) : project.status === 'canceled' ? randInt(0, 1) : 0;
    const start = new Date(project.start_date);
    const end = new Date(Math.min(new Date(project.end_date).getTime(), NOW.getTime()));
    for (let i = 0; i < count; i += 1) {
      const ts = randomHour(new Date(start.getTime() + rand() * Math.max(DAY, end - start)));
      updates.push({
        id: uuid('60000000', seq++),
        project_id: project.id,
        author_id: project.owner.id,
        title: pick(UPDATE_TITLES),
        content: pick(UPDATE_CONTENT),
        created_at: ts,
      });
    }
  }
  return updates;
}

const COMMENT_CONTENT = [
  'Dự án có báo cáo tài chính công khai không ạ?',
  'Mình muốn tham gia tình nguyện, đăng ký ở đâu?',
  'Mục tiêu này đã bao gồm chi phí vận chuyển chưa?',
  'Ủng hộ một gói, mong dự án sớm triển khai.',
  'Cảm ơn đội dự án đã cập nhật tiến độ.',
  'Cho mình hỏi thời gian hoàn thành dự kiến?',
  'Mình đã chia sẻ lên nhóm cộng đồng.',
  'Dự án rất ý nghĩa, chúc thành công!',
  'Chi phí quản lý chiếm bao nhiêu phần trăm vậy ạ?',
  'Mình ở xa có thể ủng hộ qua hình thức nào?',
];
const REPLY_CONTENT = [
  'Cảm ơn bạn, báo cáo được cập nhật hàng tuần ạ.',
  'Bạn để lại email, ban tổ chức sẽ liên hệ ngay.',
  'Chi phí vận chuyển đã được tính trong dự toán, bạn xem thêm ở mục Cập nhật nhé.',
  'Cảm ơn bạn đã đồng hành!',
  'Dự kiến hoàn thành trong 6-8 tuần tới ạ.',
];

function buildComments(projects, users, pledges) {
  const comments = [];
  const backers = users.filter((u) => u.seedKind === 'backer' || u.seedKind === 'test');
  let seq = 1;
  for (const project of projects) {
    // Dự án chưa được duyệt chưa công khai nên chưa thể có bình luận.
    if (project.status === 'pending_review') continue;
    const count = clamp(Math.round(randInt(0, 10)), 0, 10);
    const start = new Date(project.start_date);
    const end = new Date(Math.min(new Date(project.end_date).getTime(), NOW.getTime()));
    const eligible = backers.filter((u) => new Date(u.created_at).getTime() < end.getTime());
    if (!eligible.length) continue;
    for (let i = 0; i < count; i += 1) {
      const user = pick(eligible);
      const earliest = Math.max(start.getTime(), new Date(user.created_at).getTime());
      const ts = randomHour(new Date(earliest + rand() * Math.max(3_600_000, end.getTime() - earliest)));
      if (ts.getTime() < earliest) ts.setTime(earliest);
      if (ts.getTime() > end.getTime()) ts.setTime(end.getTime() - 1);
      const id = uuid('70000000', seq++);
      comments.push({
        id,
        project_id: project.id,
        user_id: user.id,
        parent_comment_id: null,
        content: pick(COMMENT_CONTENT),
        created_at: ts,
      });
      if (chance(0.28)) {
        comments.push({
          id: uuid('70000000', seq++),
          project_id: project.id,
          user_id: project.owner.id,
          parent_comment_id: id,
          content: pick(REPLY_CONTENT),
          created_at: new Date(ts.getTime() + randInt(1, 48) * 3_600_000),
        });
      }
    }
  }
  return comments;
}

function buildFollows(projects, users) {
  const follows = [];
  const backers = users.filter((u) => u.seedKind === 'backer' || u.seedKind === 'test');
  const seen = new Set();
  for (const project of projects) {
    if (project.status === 'pending_review') continue;
    const count = clamp(Math.round(randInt(0, 30)), 0, 30);
    const end = new Date(Math.min(new Date(project.end_date).getTime(), NOW.getTime()));
    const eligible = backers.filter((u) => new Date(u.created_at).getTime() < end.getTime());
    if (!eligible.length) continue;
    for (let i = 0; i < count; i += 1) {
      const user = pick(eligible);
      const key = `${user.id}:${project.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const earliest = Math.max(new Date(project.created_at).getTime(), new Date(user.created_at).getTime());
      const ts = new Date(earliest + rand() * Math.max(3_600_000, end.getTime() - earliest));
      if (ts.getTime() < earliest) ts.setTime(earliest);
      if (ts.getTime() > end.getTime()) ts.setTime(end.getTime() - 1);
      follows.push({
        user_id: user.id,
        project_id: project.id,
        created_at: ts,
      });
    }
  }
  return follows;
}

function buildCollaborators(projects, users) {
  const collaborators = [];
  const backers = users.filter((u) => u.seedKind === 'backer' || u.seedKind === 'test');
  const selected = projects.filter((_, index) => index % 11 === 0).slice(0, 18);
  for (const project of selected) {
    const count = randInt(1, 2);
    const used = new Set();
    const end = new Date(Math.min(new Date(project.end_date).getTime(), NOW.getTime()));
    const eligible = backers.filter((u) => new Date(u.created_at).getTime() < end.getTime());
    if (!eligible.length) continue;
    for (let i = 0; i < count; i += 1) {
      const user = pick(eligible);
      if (used.has(user.id) || user.id === project.owner.id) continue;
      used.add(user.id);
      const earliest = Math.max(new Date(project.created_at).getTime(), new Date(user.created_at).getTime());
      const invitedAt = new Date(Math.min(NOW.getTime() - DAY, earliest + randInt(1, 10) * DAY));
      const acceptedAt = chance(0.8)
        ? new Date(Math.min(NOW.getTime(), invitedAt.getTime() + randInt(1, 7) * DAY))
        : null;
      collaborators.push({
        project_id: project.id,
        user_id: user.id,
        role: i === 0 ? 'editor' : 'moderator',
        invited_at: invitedAt,
        accepted_at: acceptedAt,
      });
    }
  }
  return collaborators;
}

function buildInterests(users, projects, userCategoryCounts) {
  const interests = [];
  const seen = new Set();
  const userProjects = new Map();
  for (const project of projects) {
    const list = userProjects.get(project.owner.id) || [];
    list.push(project.category.id);
    userProjects.set(project.owner.id, list);
  }
  for (const user of users) {
    const counts = new Map();
    for (const category of CATEGORIES) {
      const key = `${user.id}:${category.id}`;
      if (userCategoryCounts.has(key)) counts.set(category.id, userCategoryCounts.get(key));
    }
    if (user.seedKind === 'owner') {
      for (const categoryId of userProjects.get(user.id) || []) {
        counts.set(categoryId, (counts.get(categoryId) || 0) + 2);
      }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (!sorted.length) {
      const category = CATEGORIES[user.categoryBias % CATEGORIES.length];
      sorted.push([category.id, 1]);
    }
    for (const [categoryId, count] of sorted) {
      const key = `${user.id}:${categoryId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      interests.push({
        user_id: user.id,
        category_id: categoryId,
        weight: clamp(0.45 + Math.min(0.5, count * 0.12) + rand() * 0.08, 0.45, 1),
      });
    }
  }
  return interests;
}

function categoryMedian(projects, categoryId) {
  const goals = projects.filter((p) => p.category.id === categoryId).map((p) => p.goal_amount).sort((a, b) => a - b);
  return goals.length ? goals[Math.floor(goals.length / 2)] : 0;
}

function projectFraudEvidence(project, allProjects) {
  const signals = [];
  const owner = project.owner;
  if (owner.kyc_status !== 'verified') {
    signals.push({ code: 'owner_unverified', label: 'Chủ dự án chưa xác thực KYC', points: 18, evidence: 'Tài khoản chưa hoàn tất xác thực danh tính.', severity: 'high' });
  }
  if (owner.trust_score < 45) {
    signals.push({ code: 'trust_low', label: 'Điểm tín nhiệm thấp', points: 12, evidence: `Điểm tín nhiệm ${Math.round(owner.trust_score)}/100.`, severity: 'medium' });
  }
  const median = categoryMedian(allProjects, project.category.id);
  if (median && project.goal_amount > median * 2.5) {
    signals.push({ code: 'goal_outlier', label: 'Mục tiêu cao bất thường so với danh mục', points: 14, evidence: `Mục tiêu ${Math.round(project.goal_amount / 1_000_000)} triệu, cao hơn nhiều so với trung vị ${Math.round(median / 1_000_000)} triệu của danh mục.`, severity: 'high' });
  }
  const ownerProjects = allProjects.filter((p) => p.owner.id === owner.id);
  const badHistory = ownerProjects.filter((p) => ['failed', 'canceled'].includes(p.status)).length;
  const decidedHistory = ownerProjects.filter((p) => ['successful', 'failed'].includes(p.status));
  const successHistory = decidedHistory.filter((p) => p.status === 'successful').length;
  if (badHistory >= 2) {
    signals.push({ code: 'owner_bad_history', label: 'Lịch sử dự án thất bại/đã dừng', points: 10, evidence: `Chủ dự án có ${badHistory} chiến dịch thất bại hoặc đã dừng trước đó.`, severity: 'medium' });
  }
  if (decidedHistory.length >= 2 && successHistory === 0) {
    signals.push({ code: 'owner_no_success', label: 'Chưa từng có chiến dịch thành công', points: 8, evidence: `Đã kết thúc ${decidedHistory.length} chiến dịch nhưng chưa có chiến dịch nào thành công.`, severity: 'medium' });
  }
  if (project.description.includes('cam kết lợi nhuận') || project.description.includes('không rủi ro')) {
    signals.push({ code: 'hype_language', label: 'Nội dung cam kết lợi nhuận bất thường', points: 20, evidence: 'Mô tả chứa cụm từ cam kết lợi nhuận/siêu lợi/không rủi ro.', severity: 'critical' });
  }
  if (project.description.includes('chuyển khoản riêng') || project.description.includes('thanh toán riêng')) {
    signals.push({ code: 'external_payment', label: 'Kêu gọi thanh toán ngoài nền tảng', points: 12, evidence: 'Mô tả có dấu hiệu yêu cầu chuyển khoản riêng hoặc liên hệ ngoài hệ thống.', severity: 'high' });
  }
  if (project.reward_count === 0) {
    signals.push({ code: 'no_rewards', label: 'Không có gói tri ân', points: 6, evidence: 'Chiến dịch không có gói tri ân để đối chiếu.', severity: 'low' });
  }
  const score = Math.round(clamp(8 + signals.reduce((s, x) => s + x.points, 0), 0, 98));
  return {
    score,
    level: score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low',
    signals,
    summary: signals.slice(0, 3).map((s) => `${s.label} (+${s.points} điểm)`).join('; ') || 'Chưa phát hiện tín hiệu gian lận đáng kể.',
    model_version: 'fraud-project-v2.0',
    evaluated_at: new Date().toISOString(),
  };
}

function buildFraudFlags(projects, pledges, users) {
  const flags = [];
  let seq = 1;
  const suspiciousProjects = [
    ...projects.filter((p) => p.suspicious),
    ...projects.filter((p) => p.status === 'pending_review').slice(0, 2),
    ...projects.filter((p) => p.status === 'active' && p.owner.trust_score < 55).slice(0, 2),
  ].filter((p, index, arr) => arr.findIndex((x) => x.id === p.id) === index).slice(0, 10);

  for (const project of suspiciousProjects) {
    const evidence = projectFraudEvidence(project, projects);
    if (evidence.score < 60) continue;
    flags.push({
      id: uuid('80000000', seq++),
      entity_type: 'project',
      entity_id: project.id,
      risk_score: evidence.score,
      reason: evidence.summary,
      evidence: JSON.stringify(evidence),
      model_version: evidence.model_version,
      flagged_at: daysAgo(randInt(1, 25)),
      review_status: chance(0.65) ? 'pending' : chance(0.7) ? 'confirmed' : 'false_positive',
    });
  }

  const suspiciousPledges = pledges.filter((p) => p.suspicious).concat(
    pledges.filter((p) => p.amount >= 40_000_000 && chance(0.25)).slice(0, 7),
  ).slice(0, 10);
  for (const pledge of suspiciousPledges) {
    const backer = users.find((u) => u.id === pledge.backer_id) || {};
    const signals = [];
    if (pledge.is_anonymous) signals.push({ code: 'anonymous_high', label: 'Tài trợ ẩn danh số tiền lớn', points: 10, evidence: `Giao dịch ẩn danh ${Math.round(pledge.amount / 1_000_000)} triệu đồng.`, severity: 'medium' });
    if (Number(backer.trust_score) < 45) signals.push({ code: 'trust_low', label: 'Điểm tín nhiệm thấp', points: 10, evidence: `Điểm tín nhiệm ${Math.round(backer.trust_score)}/100.`, severity: 'medium' });
    if (backer.kyc_status !== 'verified') signals.push({ code: 'unverified_high', label: 'Tài khoản chưa KYC tài trợ số tiền lớn', points: 8, evidence: `Giao dịch ${Math.round(pledge.amount / 1_000_000)} triệu từ tài khoản chưa xác thực.`, severity: 'medium' });
    if (pledge.suspicious) signals.push({ code: 'velocity_10m', label: 'Nhiều giao dịch trong thời gian ngắn', points: 26, evidence: 'Ba giao dịch lớn liên tiếp trong vòng 5 phút từ cùng một tài khoản.', severity: 'critical' });
    if (pledge.amount >= 50_000_000) signals.push({ code: 'round_amount', label: 'Số tiền tròn lớn', points: 5, evidence: `Giao dịch ${Math.round(pledge.amount / 1_000_000)} triệu đồng.`, severity: 'low' });
    if (!signals.length) continue;
    const score = Math.round(clamp(8 + signals.reduce((s, x) => s + x.points, 0), 0, 98));
    if (score < 60) continue;
    const evidence = {
      score,
      level: score >= 80 ? 'critical' : score >= 60 ? 'high' : 'medium',
      signals,
      summary: signals.slice(0, 3).map((s) => `${s.label} (+${s.points} điểm)`).join('; '),
      model_version: 'fraud-pledge-v2.0',
      evaluated_at: new Date().toISOString(),
    };
    flags.push({
      id: uuid('80000000', seq++),
      entity_type: 'pledge',
      entity_id: pledge.id,
      risk_score: score,
      reason: evidence.summary,
      evidence: JSON.stringify(evidence),
      model_version: evidence.model_version,
      flagged_at: daysAgo(randInt(1, 15)),
      review_status: chance(0.7) ? 'pending' : chance(0.7) ? 'confirmed' : 'false_positive',
    });
  }

  const suspiciousUsers = users.filter((u) => u.role === 'owner' && (u.status === 'locked' || u.trust_score < 35)).slice(0, 3);
  for (const user of suspiciousUsers) {
    const signals = [
      { code: 'trust_critical', label: 'Điểm tín nhiệm rất thấp', points: 22, evidence: `Điểm tín nhiệm ${Math.round(user.trust_score)}/100.`, severity: 'high' },
      { code: 'owner_many_projects', label: 'Tạo nhiều chiến dịch trong thời gian ngắn', points: 12, evidence: 'Nhiều dự án được tạo trong 30 ngày gần đây.', severity: 'high' },
    ];
    if (user.kyc_status !== 'verified') signals.push({ code: 'owner_unverified', label: 'Chưa xác thực KYC', points: 18, evidence: 'Tài khoản chưa hoàn tất xác thực danh tính.', severity: 'high' });
    const score = Math.round(clamp(8 + signals.reduce((s, x) => s + x.points, 0), 0, 98));
    if (score < 60) continue;
    const evidence = {
      score,
      level: 'critical',
      signals,
      summary: signals.map((s) => `${s.label} (+${s.points} điểm)`).join('; '),
      model_version: 'fraud-user-v2.0',
      evaluated_at: new Date().toISOString(),
    };
    flags.push({
      id: uuid('80000000', seq++),
      entity_type: 'user',
      entity_id: user.id,
      risk_score: score,
      reason: evidence.summary,
      evidence: JSON.stringify(evidence),
      model_version: evidence.model_version,
      flagged_at: daysAgo(randInt(1, 20)),
      review_status: chance(0.6) ? 'pending' : chance(0.6) ? 'confirmed' : 'false_positive',
    });
  }

  return flags;
}

function buildReports(projects, users) {
  const reports = [];
  let seq = 1;
  const reporters = users.filter((u) => u.seedKind === 'backer' || u.seedKind === 'test');
  const targets = projects
    .filter((p) => p.status !== 'pending_review' && (p.suspicious || p.status === 'canceled'))
    .slice(0, 12);
  for (const project of targets) {
    const count = randInt(1, 2);
    for (let i = 0; i < count; i += 1) {
      const reporter = pick(reporters);
      const createdAt = new Date(
        Math.max(
          new Date(reporter.created_at).getTime() + DAY,
          NOW.getTime() - randInt(1, 30) * DAY,
        ),
      );
      reports.push({
        id: uuid('90000000', seq++),
        project_id: project.id,
        reporter_id: reporter.id,
        reason: pick([
          'Nội dung cam kết lợi nhuận bất thường, nghi lừa đảo.',
          'Thông tin tổ chức chưa rõ ràng, đề nghị admin xác minh.',
          'Dự án đã dừng nhưng chưa thấy thông báo hoàn tiền.',
          'Hình ảnh và báo cáo tài chính chưa được cập nhật.',
          'Có dấu hiệu kêu gọi chuyển khoản ngoài nền tảng.',
        ]),
        status: chance(0.5) ? 'open' : chance(0.65) ? 'reviewed' : 'closed',
        created_at: createdAt,
      });
    }
  }
  return reports;
}

function buildNotifications(adminId, users, projects, flags, reports) {
  const notifications = [];
  let seq = 1;
  const push = (user_id, type, content, link, is_read = false, days = 1) => {
    notifications.push({
      id: uuid('a0000000', seq++),
      user_id,
      type,
      content,
      link,
      is_read,
      created_at: daysAgo(days),
    });
  };
  const pending = projects.filter((p) => p.status === 'pending_review').slice(0, 3);
  if (adminId) {
    for (const project of pending) {
      push(adminId, 'project', `Dự án “${project.title}” đang chờ duyệt.`, '/admin/duyet-du-an', false, randInt(1, 5));
    }
    for (const flag of flags.filter((f) => f.review_status === 'pending').slice(0, 5)) {
      push(adminId, 'fraud', `AI gắn cờ ${flag.entity_type} với rủi ro ${Math.round(flag.risk_score)}%: ${flag.reason}`, '/admin/gian-lan', false, randInt(1, 10));
    }
    for (const report of reports.filter((r) => r.status === 'open').slice(0, 3)) {
      push(adminId, 'report', 'Có báo cáo vi phạm mới cần xem xét.', '/admin/gian-lan', false, randInt(1, 7));
    }
    push(adminId, 'ai', 'Mô hình dự đoán thành công vừa được huấn luyện lại trên dữ liệu lịch sử của nền tảng.', '/admin/tong-quan', true, 1);
  }
  const testBacker = users.find((u) => u.email === 'minhanh.nguyen@gayquy.vn');
  const testOwner = users.find((u) => u.email === 'hoang.nam.tran@gayquy.vn');
  if (testBacker) {
    push(testBacker.id, 'pledge_success', 'Tài trợ của bạn đã được ghi nhận. Cảm ơn bạn đã đồng hành cùng dự án!', '/ca-nhan', false, 2);
    push(testBacker.id, 'ai', 'AI vừa gợi ý một số dự án phù hợp với sở thích và lịch sử tài trợ của bạn.', '/', false, 1);
  }
  if (testOwner) {
    push(testOwner.id, 'project', 'Chiến dịch của bạn đang gây quỹ. Hãy đăng bản tin tiến độ hàng tuần để giữ đà.', '/quan-ly', false, 1);
    push(testOwner.id, 'payout', 'Có yêu cầu giải ngân đang chờ quản trị viên duyệt.', '/quan-ly', false, 2);
  }
  return notifications;
}

async function insertRows(db, table, columns, rows, { chunkSize = 350, conflict = '' } = {}) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const params = [];
    const placeholders = chunk.map((row) => {
      const values = columns.map((column) => {
        params.push(row[column]);
        return `$${params.length}`;
      });
      return `(${values.join(', ')})`;
    });
    await db.query(
      `insert into ${table} (${columns.join(', ')}) values ${placeholders.join(', ')} ${conflict}`,
      params,
    );
  }
}

async function main() {
  if (DRY_RUN) {
    const users = buildUsers();
    const projects = buildProjects(users);
    const rewards = buildRewards(projects);
    const { pledges } = buildPledges(projects, users, rewards);
    const transactions = buildTransactions(pledges);
    const payouts = buildPayouts(projects, pledges);
    const updates = buildUpdates(projects, users);
    const comments = buildComments(projects, users, pledges);
    const follows = buildFollows(projects, users);
    const collaborators = buildCollaborators(projects, users);
    const flags = buildFraudFlags(projects, pledges, users);
    const reports = buildReports(projects, users);
    const statusCounts = projects.reduce((acc, project) => {
      acc[project.status] = (acc[project.status] || 0) + 1;
      return acc;
    }, {});
    const transactionIds = [...transactions, ...payouts].map((t) => t.id);
    const duplicateTransactionIds = transactionIds.filter((id, index) => transactionIds.indexOf(id) !== index);
    const projectsBeforeOwner = projects.filter(
      (project) => new Date(project.created_at) < new Date(project.owner.created_at),
    );
    const closedProjectsEndingInFuture = projects.filter(
      (project) => ['successful', 'failed', 'canceled'].includes(project.status) && new Date(project.end_date) >= NOW,
    );
    const paidByProject = new Map();
    for (const pledge of pledges) {
      if (pledge.status !== 'paid') continue;
      paidByProject.set(pledge.project_id, (paidByProject.get(pledge.project_id) || 0) + pledge.amount);
    }
    const totalRaised = projects.reduce((sum, project) => sum + (paidByProject.get(project.id) || 0), 0);
    const pledgeCountByBacker = new Map();
    for (const pledge of pledges) {
      pledgeCountByBacker.set(pledge.backer_id, (pledgeCountByBacker.get(pledge.backer_id) || 0) + 1);
    }
    const perBacker = [...pledgeCountByBacker.values()].sort((a, b) => a - b);
    const amounts = pledges.map((pledge) => pledge.amount).sort((a, b) => a - b);
    const percentile = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] || 0;
    const fundingRatios = projects
      .map((project) => (paidByProject.get(project.id) || 0) / project.goal_amount)
      .sort((a, b) => a - b);
    const userById = new Map(users.map((user) => [user.id, user]));
    const pledgesBeforeAccount = pledges.filter(
      (pledge) => new Date(pledge.created_at) < new Date(userById.get(pledge.backer_id).created_at),
    );
    const commentsBeforeAccount = comments.filter(
      (comment) => new Date(comment.created_at) < new Date(userById.get(comment.user_id).created_at),
    );
    const followsBeforeAccount = follows.filter(
      (follow) => new Date(follow.created_at) < new Date(userById.get(follow.user_id).created_at),
    );
    const reportsBeforeAccount = reports.filter(
      (report) => new Date(report.created_at) < new Date(userById.get(report.reporter_id).created_at),
    );
    const pendingWithSocialActivity = projects.filter(
      (project) => project.status === 'pending_review'
        && (comments.some((c) => c.project_id === project.id) || follows.some((f) => f.project_id === project.id)),
    );
    const futureTransactions = [...transactions, ...payouts].filter((t) => new Date(t.created_at) > NOW);
    const suspiciousDetails = projects
      .filter((project) => project.suspicious)
      .map((project) => {
        const evidence = projectFraudEvidence(project, projects);
        return {
          status: project.status,
          owner_kyc: project.owner.kyc_status,
          owner_trust: Math.round(project.owner.trust_score),
          score: evidence.score,
          signals: evidence.signals.map((signal) => signal.code),
        };
      });

    console.log(JSON.stringify({
      users: users.length,
      projects: projects.length,
      status_counts: statusCounts,
      rewards: rewards.length,
      pledges: pledges.length,
      transactions: transactions.length + payouts.length,
      total_raised_vnd: totalRaised,
      updates: updates.length,
      comments: comments.length,
      follows: follows.length,
      collaborators: collaborators.length,
      fraud_flags: flags.length,
      reports: reports.length,
      duplicate_transaction_ids: duplicateTransactionIds.slice(0, 5),
      projects_before_owner: projectsBeforeOwner.length,
      closed_projects_ending_in_future: closedProjectsEndingInFuture.length,
      pledges_before_account: pledgesBeforeAccount.length,
      comments_before_account: commentsBeforeAccount.length,
      follows_before_account: followsBeforeAccount.length,
      reports_before_account: reportsBeforeAccount.length,
      pending_with_social_activity: pendingWithSocialActivity.length,
      future_transactions: futureTransactions.length,
      suspicious_details: suspiciousDetails,
      pledges_per_backer: {
        median: percentile(perBacker, 0.5),
        p90: percentile(perBacker, 0.9),
        max: perBacker[perBacker.length - 1] || 0,
        backers_with_pledges: perBacker.length,
      },
      pledge_amount_vnd: {
        median: percentile(amounts, 0.5),
        p90: percentile(amounts, 0.9),
        max: amounts[amounts.length - 1] || 0,
      },
      funding_ratio: {
        median: Number(percentile(fundingRatios, 0.5).toFixed(2)),
        p10: Number(percentile(fundingRatios, 0.1).toFixed(2)),
        p90: Number(percentile(fundingRatios, 0.9).toFixed(2)),
      },
    }, null, 2));

    const problems = [
      duplicateTransactionIds.length,
      projectsBeforeOwner.length,
      closedProjectsEndingInFuture.length,
      pledgesBeforeAccount.length,
      commentsBeforeAccount.length,
      followsBeforeAccount.length,
      reportsBeforeAccount.length,
      pendingWithSocialActivity.length,
      futureTransactions.length,
    ].reduce((sum, value) => sum + value, 0);
    if (problems > 0) {
      throw new Error('Dữ liệu sinh ra chưa hợp lệ, xem các trường lỗi ở trên.');
    }
    return;
  }

  console.log(`\nKết nối database...`);
  await client.connect();
  console.log('Đã kết nối. Bắt đầu tạo dữ liệu lịch sử.\n');

  await client.query('BEGIN');
  await client.query(`
    delete from notifications;
    delete from reports;
    delete from fraud_flags;
    delete from ai_predictions;
    delete from ai_recommendations;
    delete from ai_model_versions;
    delete from user_interests;
    delete from comments;
    delete from project_updates;
    delete from transactions;
    delete from pledges;
    delete from rewards;
    delete from project_collaborators;
    delete from follows;
    delete from projects;
    delete from categories;
    delete from users where email like '%@demo.vn' or email like '%@gayquy.vn' or id::text like '10000000-%';
  `);

  const users = buildUsers();
  const projects = buildProjects(users);
  const rewards = buildRewards(projects);
  const { pledges, userCategoryCounts } = buildPledges(projects, users, rewards);
  const transactions = buildTransactions(pledges);
  const payouts = buildPayouts(projects, pledges);
  const updates = buildUpdates(projects, users);
  const comments = buildComments(projects, users, pledges);
  const follows = buildFollows(projects, users);
  const collaborators = buildCollaborators(projects, users);
  const interests = buildInterests(users, projects, userCategoryCounts);
  const flags = buildFraudFlags(projects, pledges, users);
  const reports = buildReports(projects, users);

  await insertRows(client, 'users', [
    'id', 'full_name', 'email', 'password_hash', 'phone', 'role', 'kyc_status',
    'trust_score', 'status', 'email_verified_at', 'created_at',
  ], users);

  await insertRows(client, 'categories', ['id', 'name', 'description'], CATEGORIES.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
  })));

  await insertRows(client, 'projects', [
    'id', 'owner_id', 'category_id', 'title', 'description', 'cover_image_url', 'cover_emoji',
    'goal_amount', 'current_amount', 'start_date', 'end_date', 'status', 'ai_success_score',
    'fraud_risk_score', 'created_at',
  ], projects.map((p) => ({
    id: p.id,
    owner_id: p.owner.id,
    category_id: p.category.id,
    title: p.title,
    description: p.description,
    cover_image_url: p.cover_image_url,
    cover_emoji: p.cover_emoji,
    goal_amount: p.goal_amount,
    current_amount: 0,
    start_date: p.start_date,
    end_date: p.end_date,
    status: p.status,
    ai_success_score: 50,
    fraud_risk_score: 0,
    created_at: p.created_at,
  })));

  await insertRows(client, 'rewards', [
    'id', 'project_id', 'title', 'description', 'min_amount', 'quantity_available',
  ], rewards);

  await insertRows(client, 'pledges', [
    'id', 'project_id', 'backer_id', 'reward_id', 'amount', 'is_anonymous', 'status', 'created_at',
  ], pledges.map((p) => ({
    id: p.id,
    project_id: p.project_id,
    backer_id: p.backer_id,
    reward_id: p.reward_id,
    amount: p.amount,
    is_anonymous: p.is_anonymous,
    status: p.status,
    created_at: p.created_at,
  })));

  await client.query(`
    update projects p
       set current_amount = coalesce((
         select sum(pl.amount)
           from pledges pl
          where pl.project_id = p.id and pl.status = 'paid'
       ), 0)
  `);

  await insertRows(client, 'transactions', [
    'id', 'pledge_id', 'project_id', 'type', 'amount', 'method', 'gateway_ref', 'status', 'created_at',
  ], [...transactions, ...payouts]);

  await insertRows(client, 'project_updates', [
    'id', 'project_id', 'author_id', 'title', 'content', 'created_at',
  ], updates);

  await insertRows(client, 'comments', [
    'id', 'project_id', 'user_id', 'parent_comment_id', 'content', 'created_at',
  ], comments);

  await insertRows(client, 'follows', ['user_id', 'project_id', 'created_at'], follows, { conflict: 'on conflict do nothing' });

  await insertRows(client, 'project_collaborators', [
    'project_id', 'user_id', 'role', 'invited_at', 'accepted_at',
  ], collaborators, { conflict: 'on conflict do nothing' });

  await insertRows(client, 'user_interests', ['user_id', 'category_id', 'weight'], interests, { conflict: 'on conflict do nothing' });

  await insertRows(client, 'fraud_flags', [
    'id', 'entity_type', 'entity_id', 'risk_score', 'reason', 'evidence', 'model_version',
    'flagged_at', 'review_status',
  ], flags);

  await insertRows(client, 'reports', [
    'id', 'project_id', 'reporter_id', 'reason', 'status', 'created_at',
  ], reports);

  await client.query('COMMIT');

  const counts = await client.query(`
    select
      (select count(*) from users)::int as users,
      (select count(*) from projects)::int as projects,
      (select count(*) from rewards)::int as rewards,
      (select count(*) from pledges)::int as pledges,
      (select count(*) from transactions)::int as transactions,
      (select count(*) from project_updates)::int as updates,
      (select count(*) from comments)::int as comments,
      (select count(*) from follows)::int as follows,
      (select count(*) from fraud_flags)::int as flags,
      (select count(*) from reports)::int as reports
  `);
  console.log('Đã ghi dữ liệu:', JSON.stringify(counts.rows[0]));

  // Huấn luyện mô hình trên lịch sử vừa tạo.
  console.log('\nĐang huấn luyện mô hình dự đoán thành công...');
  const model = await trainModel({ persist: true });
  console.log(`Mô hình ${model.version}: ${model.sample_size} mẫu, AUC=${model.metrics?.auc ?? 'n/a'}, accuracy=${model.metrics?.accuracy ?? 'n/a'}`);

  // Dự báo cho toàn bộ dự án.
  console.log('Đang tạo dự báo cho từng dự án...');
  const predictions = await predictAllProjects();
  const projectMeta = await client.query('select id, created_at, status from projects');
  const metaMap = new Map(projectMeta.rows.map((r) => [r.id, r]));
  const predictionRows = predictions.map(({ project_id, prediction, status }) => {
    const meta = metaMap.get(project_id);
    const historical = ['successful', 'failed'].includes(status);
    return {
      project_id,
      success_probability: prediction.score,
      label: prediction.label,
      confidence: prediction.confidence,
      model_version: prediction.model.version,
      features_snapshot: JSON.stringify({ ...prediction.features_snapshot, evaluation: historical ? 'backtest' : 'live' }),
      contributions: JSON.stringify(prediction.contributions),
      model_metrics: JSON.stringify(prediction.model.metrics),
      predicted_at: historical ? meta.created_at : new Date(),
    };
  });
  await insertRows(client, 'ai_predictions', [
    'project_id', 'success_probability', 'label', 'confidence', 'model_version',
    'features_snapshot', 'contributions', 'model_metrics', 'predicted_at',
  ], predictionRows);

  // Cập nhật điểm AI trên projects để danh sách/sắp xếp dùng được ngay.
  for (const row of predictionRows) {
    await client.query('update projects set ai_success_score = $1 where id = $2', [row.success_probability, row.project_id]);
  }

  // Cập nhật điểm rủi ro gian lận cho mọi dự án, kể cả hồ sơ chưa đủ ngưỡng tạo cảnh báo.
  for (const project of projects) {
    const evidence = projectFraudEvidence(project, projects);
    await client.query('update projects set fraud_risk_score = $1 where id = $2', [evidence.score, project.id]);
  }

  const admin = await client.query(`select id from users where email = 'nhutt859@gmail.com' limit 1`);
  const notifications = buildNotifications(admin.rows[0]?.id, users, projects, flags, reports);
  await insertRows(client, 'notifications', [
    'id', 'user_id', 'type', 'content', 'link', 'is_read', 'created_at',
  ], notifications);

  // Tạo gợi ý cho một nhóm người dùng mẫu; các user khác sẽ được tính khi mở trang chủ.
  console.log('Đang tạo gợi ý dự án...');
  const recommendationUsers = users
    .filter((u) => ['backer', 'owner'].includes(u.role))
    .sort((a, b) => (b.seedKind === 'test' ? 1 : 0) - (a.seedKind === 'test' ? 1 : 0))
    .slice(0, 36);
  for (const user of recommendationUsers) {
    try {
      await refreshRecommendations(user.id, 8);
    } catch (err) {
      console.warn(`Không tạo được gợi ý cho ${user.email}: ${err.message}`);
    }
  }

  const finalCounts = await client.query(`
    select
      (select count(*) from ai_predictions)::int as predictions,
      (select count(*) from ai_recommendations)::int as recommendations,
      (select count(*) from ai_model_versions)::int as model_versions
  `);
  console.log('AI:', JSON.stringify(finalCounts.rows[0]));

  console.log('\nTài khoản thử nghiệm (mật khẩu 12345678):');
  for (const test of TEST_USERS) console.log(`  - ${test.email} (${test.role})`);
  console.log('\nHoàn tất.\n');
}

main()
  .catch(async (err) => {
    console.error('\nSeed thất bại:', err);
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => {});
    await closePool().catch(() => {});
  });
