import crypto from 'node:crypto';

const PAY_URL = String(process.env.VNPAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html').trim();
const TMN_CODE = String(process.env.VNPAY_TMN_CODE || '').trim();
const HASH_SECRET = String(process.env.VNPAY_HASH_SECRET || '').trim();
const RETURN_URL = String(process.env.VNPAY_RETURN_URL || '').trim();
const FORCE_MOCK = String(process.env.VNPAY_MOCK || '').toLowerCase() === 'true';
const MOCK_SECRET = String(process.env.VNPAY_MOCK_SECRET || process.env.JWT_SECRET || 'gayquy-mock-secret').trim();

const hasCredentials = () => Boolean(TMN_CODE && HASH_SECRET && RETURN_URL);

/** Đã có đủ TmnCode/HashSecret/ReturnUrl để chạy cổng VNPay thật chưa. */
export function isVnpayConfigured() {
  return hasCredentials() && !FORCE_MOCK;
}

/**
 * Chế độ mô phỏng: dùng khi chưa có thông tin sandbox hoặc khi đặt VNPAY_MOCK=true.
 * Trang mô phỏng được ký token nên không thể tự ý xác nhận giao dịch của người khác.
 */
export function isVnpayMock() {
  return FORCE_MOCK || !hasCredentials();
}

/** yyyyMMddHHmmss theo GMT+7 (VNPay không dùng UTC). */
export function vnpayDate(date = new Date()) {
  return new Date(date.getTime() + 7 * 3600_000)
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14);
}

/** Chuẩn hoá IP người dùng; VNPay yêu cầu IPv4. */
export function normalizeIp(value) {
  let ip = String(value || '').split(',')[0].trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1' || !ip) ip = '127.0.0.1';
  return ip;
}

function sortedParams(params) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && String(params[key]) !== '')
    .sort()
    .map((key) => [key, String(params[key])]);
}

/** Chuỗi dùng để ký: key=value&... chưa URL-encode, đã sắp xếp A→Z. */
function signData(params) {
  return sortedParams(params)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

/** Chuỗi query gửi lên VNPay: đã URL-encode từng giá trị. */
function encodeQuery(params) {
  return sortedParams(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}

function sign(params) {
  return crypto.createHmac('sha512', HASH_SECRET).update(signData(params), 'utf8').digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Tạo URL thanh toán VNPay (hoặc URL mô phỏng nếu chưa có credentials).
 * `baseUrl` là origin của API/website đang nhận request, dùng cho trang mô phỏng.
 */
export function buildPaymentUrl({ amount, txnRef, ipAddr, orderInfo, baseUrl }) {
  if (isVnpayMock()) {
    return buildMockPaymentUrl({ amount, txnRef, baseUrl });
  }
  if (!isVnpayConfigured()) {
    throw new Error('VNPay chưa được cấu hình.');
  }

  const now = new Date();
  const ttlMinutes = Math.max(5, Number(process.env.VNPAY_PAYMENT_TTL_MINUTES || 15));
  const params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: TMN_CODE,
    vnp_Amount: String(Math.round(Number(amount)) * 100),
    vnp_CurrCode: 'VND',
    vnp_TxnRef: txnRef,
    vnp_OrderInfo: orderInfo,
    vnp_OrderType: 'other',
    vnp_Locale: 'vn',
    vnp_ReturnUrl: RETURN_URL,
    vnp_IpAddr: normalizeIp(ipAddr),
    vnp_CreateDate: vnpayDate(now),
    vnp_ExpireDate: vnpayDate(new Date(now.getTime() + ttlMinutes * 60_000)),
  };

  params.vnp_SecureHash = sign(params);
  return `${PAY_URL}?${encodeQuery(params)}`;
}

/**
 * Kiểm tra chữ ký của Return URL / IPN.
 * Bỏ vnp_SecureHash và vnp_SecureHashType, sắp xếp key rồi ký lại.
 */
export function verifyVnpayQuery(input) {
  if (!HASH_SECRET) return false;

  const received = String(input?.vnp_SecureHash || '');
  if (!received) return false;

  const params = {};
  for (const [key, raw] of Object.entries(input || {})) {
    if (key === 'vnp_SecureHash' || key === 'vnp_SecureHashType') continue;
    if (raw === undefined || raw === null || raw === '') continue;
    params[key] = Array.isArray(raw) ? String(raw[0]) : String(raw);
  }

  if (params.vnp_TmnCode && TMN_CODE && params.vnp_TmnCode !== TMN_CODE) return false;

  return safeEqual(sign(params), received.toLowerCase());
}

function mockPayload(txnRef, amount, ttlMinutes = 30) {
  const expiresAt = Date.now() + ttlMinutes * 60_000;
  return `${txnRef}.${Math.round(Number(amount))}.${expiresAt}`;
}

export function createMockToken(txnRef, amount, ttlMinutes = 30) {
  const payload = mockPayload(txnRef, amount, ttlMinutes);
  const signature = crypto.createHmac('sha256', MOCK_SECRET).update(payload).digest('base64url');
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${signature}`;
}

export function verifyMockToken(token) {
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) return null;

  let payload;
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expected = crypto.createHmac('sha256', MOCK_SECRET).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return null;

  const [txnRef, amount, expiresAt] = payload.split('.');
  if (!txnRef || !amount || !expiresAt) return null;
  if (Number(expiresAt) < Date.now()) return null;

  return { txnRef, amount: Number(amount) };
}

export function buildMockPaymentUrl({ amount, txnRef, baseUrl }) {
  const root = String(baseUrl || process.env.API_PUBLIC_URL || 'http://localhost:4000').replace(/\/+$/, '');
  const url = new URL(`${root}/api/payments/vnpay/mock`);
  url.searchParams.set('token', createMockToken(txnRef, amount));
  return url.toString();
}
