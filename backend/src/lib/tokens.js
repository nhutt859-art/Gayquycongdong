import crypto from 'node:crypto';

/** Token ngẫu nhiên 32 byte, dạng URL-safe. */
export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** Mã OTP 6 chữ số ngẫu nhiên. */
export function newOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

/** Chỉ lưu hash SHA-256 của token trong database. */
export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Thời điểm hết hạn tính từ bây giờ (phút). */
export function expiryFromNow(minutes) {
  return new Date(Date.now() + Number(minutes) * 60_000);
}
