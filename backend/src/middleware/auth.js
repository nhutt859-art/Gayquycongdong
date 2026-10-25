import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { ApiError } from '../lib/errors.js';
import { USER_PUBLIC_COLUMNS, mapUser } from '../lib/mappers.js';

const JWT_SECRET = process.env.JWT_SECRET;

export function signToken(userId, tokenVersion = 0) {
  if (!JWT_SECRET) throw new Error('Thiếu JWT_SECRET trong .env');
  return jwt.sign({ sub: userId, ver: Number(tokenVersion) || 0 }, JWT_SECRET, { expiresIn: '7d' });
}

export async function findUserById(id) {
  const { rows } = await query(
    `select ${USER_PUBLIC_COLUMNS}, token_version from users where id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  const user = mapUser(row);
  // Không đưa token_version ra JSON, chỉ dùng nội bộ để vô hiệu hoá JWT cũ.
  Object.defineProperty(user, '_tokenVersion', {
    value: Number(row.token_version) || 0,
    enumerable: false,
  });
  return user;
}

function assertTokenVersion(payload, user) {
  const tokenVersion = Number(payload?.ver ?? 0);
  if (tokenVersion !== user._tokenVersion) {
    throw new ApiError(401, 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
  }
}

function readToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

export async function requireAuth(req, _res, next) {
  try {
    const token = readToken(req);
    if (!token) throw new ApiError(401, 'Bạn cần đăng nhập để thực hiện thao tác này.');

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      throw new ApiError(401, 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
    }

    const user = await findUserById(payload.sub);
    if (!user) throw new ApiError(401, 'Tài khoản không tồn tại.');
    if (user.status === 'locked') throw new ApiError(403, 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.');
    assertTokenVersion(payload, user);

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export async function optionalAuth(req, _res, next) {
  try {
    const token = readToken(req);
    if (!token) return next();
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await findUserById(payload.sub);
    if (user && user.status !== 'locked') {
      assertTokenVersion(payload, user);
      req.user = user;
    }
  } catch {
    // token lỗi thì coi như khách
  }
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(new ApiError(401, 'Bạn cần đăng nhập.'));
  if (req.user.role !== 'admin') return next(new ApiError(403, 'Chỉ quản trị viên được phép truy cập.'));
  next();
}

export function requireKyc(req, _res, next) {
  if (!req.user) return next(new ApiError(401, 'Bạn cần đăng nhập.'));
  if (req.user.kyc_status !== 'verified') {
    return next(new ApiError(403, 'Bạn cần xác thực danh tính (KYC) trước khi tạo dự án.'));
  }
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'Bạn cần đăng nhập.'));
    if (!roles.includes(req.user.role)) return next(new ApiError(403, 'Vai trò của bạn không có quyền thực hiện thao tác này.'));
    next();
  };
}
