/**
 * Giới hạn tần suất đơn giản, lưu trong RAM.
 *
 * Phù hợp với Render free (một instance). Nếu chạy nhiều instance, cần thay
 * bằng Redis/Upstash để giới hạn được chia sẻ giữa các tiến trình.
 *
 * Cách dùng:
 *   router.post('/login', rateLimit({ name: 'login-ip', max: 60 }), handler)
 *   router.post('/login', rateLimit({ name: 'login-email', max: 20, key: (req) => req.body?.email }), handler)
 */

const buckets = new Map();

// Dọn bucket hết hạn mỗi phút để Map không phình mãi.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}, 60_000);
sweeper.unref?.();

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

/**
 * @param {object} options
 * @param {string} options.name Tên nhóm giới hạn (tránh trùng giữa các route).
 * @param {number} [options.windowMs=900000] Cửa sổ thời gian, mặc định 15 phút.
 * @param {number} options.max Số lần tối đa trong cửa sổ.
 * @param {(req: import('express').Request) => string} [options.key] Khóa phụ (mặc định IP).
 * @param {string} [options.message] Thông báo trả về khi vượt giới hạn.
 */
export function rateLimit({
  name,
  windowMs = 15 * 60 * 1000,
  max,
  key,
  message = 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau ít phút.',
}) {
  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const identity = normalizeKey(key ? key(req) : req.ip) || 'unknown';
    const bucketKey = `${name}:${identity}`;

    let entry = buckets.get(bucketKey);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(bucketKey, entry);
    }

    entry.count += 1;
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: message,
        retry_after: retryAfter,
      });
    }

    return next();
  };
}
