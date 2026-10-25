import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, query } from '../db.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { USER_PUBLIC_COLUMNS, mapUser } from '../lib/mappers.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { notify } from '../services/notifications.js';
import { isMailConfigured, sendMail } from '../services/mailer.js';
import { expiryFromNow, hashToken, newToken, newOtp } from '../lib/tokens.js';

const router = Router();

const VERIFICATION_TTL_MINUTES = Number(process.env.EMAIL_VERIFICATION_TTL_MINUTES || 1440);
const RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES || 60);

const registerSchema = z.object({
  full_name: z.string().trim().min(2, 'Họ tên tối thiểu 2 ký tự.').max(120, 'Họ tên tối đa 120 ký tự.'),
  email: z.string().trim().email('Email không hợp lệ.').max(160),
  password: z.string().min(6, 'Mật khẩu tối thiểu 6 ký tự.').max(72),
});

const loginSchema = z.object({
  email: z.string().trim().email('Email không hợp lệ.'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu.'),
});

const emailSchema = z.object({
  email: z.string().trim().email('Email không hợp lệ.').max(160),
});

const tokenSchema = z.object({
  token: z.string().trim().min(4, 'Mã xác nhận tối thiểu 4 ký tự.').max(500),
});

const resetPasswordSchema = z.object({
  email: z.string().trim().email('Email không hợp lệ.').optional(),
  token: z.string().trim().min(4, 'Mã xác nhận tối thiểu 4 ký tự.').max(500),
  password: z.string().min(6, 'Mật khẩu tối thiểu 6 ký tự.').max(72),
});

/** Chế độ dev: chưa có SMTP thì trả liên kết trực tiếp để test. */
function devLinkEnabled() {
  return !isMailConfigured() && process.env.NODE_ENV !== 'production';
}

function deliveryMode() {
  return isMailConfigured() ? 'smtp' : 'console';
}

function appUrl() {
  const fallback = process.env.NODE_ENV === 'production' ? 'https://dacntt-web.vercel.app' : 'http://localhost:5173';
  const raw = process.env.APP_URL || process.env.CORS_ORIGIN || fallback;
  return String(raw).split(',')[0].trim().replace(/\/+$/, '');
}

function verificationUrl(token) {
  return `${appUrl()}/xac-thuc-email?token=${encodeURIComponent(token)}`;
}

function resetUrl(token, email) {
  const emailParam = email ? `&email=${encodeURIComponent(email)}` : '';
  return `${appUrl()}/dat-lai-mat-khau?token=${encodeURIComponent(token)}${emailParam}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function emailLayout({ title, intro, buttonText, url, footer, otpCode }) {
  return `<!doctype html>
<html lang="vi"><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px">
    <div style="font-size:20px;font-weight:700;color:#047857">GâyQuỹ+</div>
    <h1 style="font-size:20px;margin:16px 0 8px">${title}</h1>
    <p style="font-size:14px;line-height:1.6;color:#334155">${intro}</p>
    ${
      otpCode
        ? `
    <div style="margin:24px 0;background:#f8fafc;border:2px dashed #047857;border-radius:12px;padding:20px;text-align:center">
      <div style="font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Mã xác nhận (OTP)</div>
      <div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#047857;font-family:monospace">${otpCode}</div>
      <div style="font-size:12px;color:#64748b;margin-top:8px">Nhập 6 số này vào màn hình xác nhận trên trang web</div>
    </div>`
        : ''
    }
    ${
      url && buttonText
        ? `
    <p style="margin:24px 0">
      <a href="${url}" style="display:inline-block;background:#047857;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;font-size:14px">${buttonText}</a>
    </p>
    <p style="font-size:12px;line-height:1.6;color:#64748b">Nếu nút không hoạt động, mở liên kết sau:<br><a href="${url}" style="color:#047857;word-break:break-all">${url}</a></p>
    `
        : ''
    }
    <p style="font-size:12px;line-height:1.6;color:#64748b">${footer}</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
    <p style="font-size:11px;color:#94a3b8">Email tự động từ GâyQuỹ+ — vui lòng không trả lời email này.</p>
  </div>
</body></html>`;
}

async function sendVerificationEmail(user) {
  const token = newToken();
  const expiresAt = expiryFromNow(VERIFICATION_TTL_MINUTES);

  await query(
    `update users
        set verification_token_hash = $1,
            verification_token_expires_at = $2,
            updated_at = now()
      where id = $3`,
    [hashToken(token), expiresAt, user.id],
  );

  const url = verificationUrl(token);
  const text = [
    `Xin chào ${user.full_name},`,
    '',
    'Cảm ơn bạn đã đăng ký GâyQuỹ+. Bấm liên kết sau để xác thực email:',
    url,
    '',
    `Liên kết hết hạn sau ${Math.round(VERIFICATION_TTL_MINUTES / 60)} giờ.`,
    'Nếu bạn không đăng ký tài khoản này, hãy bỏ qua email.',
  ].join('\n');

  const html = emailLayout({
    title: 'Xác thực email của bạn',
    intro: `Xin chào <b>${escapeHtml(user.full_name)}</b>, cảm ơn bạn đã đăng ký GâyQuỹ+. Bấm nút bên dưới để xác thực email và kích hoạt tài khoản.`,
    buttonText: 'Xác thực email',
    url,
    footer: `Liên kết hết hạn sau ${Math.round(VERIFICATION_TTL_MINUTES / 60)} giờ. Nếu bạn không đăng ký tài khoản này, hãy bỏ qua email.`,
  });

  let delivered = false;
  try {
    const result = await sendMail({
      to: user.email,
      subject: '[GâyQuỹ+] Xác thực email của bạn',
      text,
      html,
    });
    delivered = result.delivered;
  } catch (err) {
    console.error('[mail] Không gửi được email xác thực:', err.message);
  }

  return { delivered, url };
}

async function sendResetEmail(user) {
  const otp = newOtp();
  const expiresAt = expiryFromNow(RESET_TTL_MINUTES);

  await query(
    `update users
        set reset_token_hash = $1,
            reset_token_expires_at = $2,
            updated_at = now()
      where id = $3`,
    [hashToken(otp), expiresAt, user.id],
  );

  const text = [
    `Xin chào ${user.full_name},`,
    '',
    'Bạn vừa gửi yêu cầu đặt lại mật khẩu cho tài khoản GâyQuỹ+.',
    '',
    `MÃ XÁC NHẬN (OTP) CỦA BẠN LÀ: ${otp}`,
    '',
    `Mã xác nhận gồm 6 chữ số và có hiệu lực trong ${RESET_TTL_MINUTES} phút.`,
    'Hãy quay lại màn hình trên trang web và nhập mã này để hoàn tất đặt mật khẩu mới.',
    '',
    'Nếu không phải bạn yêu cầu, hãy bỏ qua email này — mật khẩu hiện tại vẫn giữ nguyên an toàn.',
  ].join('\n');

  const html = emailLayout({
    title: 'Mã xác nhận đặt lại mật khẩu',
    intro: `Xin chào <b>${escapeHtml(user.full_name)}</b>, chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản GâyQuỹ+. Bạn hãy dùng mã xác nhận (OTP) 6 chữ số dưới đây để nhập trên trang web:`,
    otpCode: otp,
    footer: `Mã có hiệu lực trong ${RESET_TTL_MINUTES} phút. Nếu không phải bạn yêu cầu, hãy bỏ qua email này để bảo vệ tài khoản.`,
  });

  let delivered = false;
  try {
    const result = await sendMail({
      to: user.email,
      subject: `[GâyQuỹ+] Mã xác nhận đặt lại mật khẩu của bạn là: ${otp}`,
      text,
      html,
    });
    delivered = result.delivered;
  } catch (err) {
    console.error('[mail] Không gửi được email đặt lại mật khẩu:', err.message);
  }

  return { delivered, otp };
}

async function buildSession(user) {
  const interests = await query(
    `select ui.category_id, c.name, ui.weight
       from user_interests ui
       join categories c on c.id = ui.category_id
      where ui.user_id = $1
      order by ui.weight desc`,
    [user.id],
  );
  const stats = await query(
    `select
       (select count(*) from projects where owner_id = $1)::int as owned_projects,
       (select count(*) from project_collaborators where user_id = $1 and accepted_at is not null)::int as collaborating_projects,
       (select count(*) from notifications where user_id = $1 and not is_read)::int as unread_notifications,
       (select coalesce(sum(amount), 0) from pledges where backer_id = $1 and status = 'paid')::numeric as total_pledged`,
    [user.id],
  );
  return {
    user: mapUser(user),
    interests: interests.rows.map((r) => ({ ...r, weight: Number(r.weight) })),
    stats: stats.rows[0],
  };
}

// POST /api/auth/register — tạo tài khoản, gửi email xác thực
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = parse(registerSchema, req.body);
    const email = body.email.toLowerCase();

    const existed = await query('select 1 from users where lower(email) = $1', [email]);
    if (existed.rowCount) throw new ApiError(409, 'Email đã tồn tại, hãy đăng nhập.');

    const passwordHash = await bcrypt.hash(body.password, 10);
    const { rows } = await query(
      `insert into users (full_name, email, password_hash)
       values ($1, $2, $3)
       returning ${USER_PUBLIC_COLUMNS}`,
      [body.full_name, email, passwordHash],
    );
    const user = rows[0];

    const mail = await sendVerificationEmail(user);

    res.status(201).json({
      user: mapUser(user),
      email_verified: false,
      verification_sent: mail.delivered,
      delivery: deliveryMode(),
      message: mail.delivered
        ? `Đã gửi liên kết xác thực tới ${user.email}. Vui lòng kiểm tra hộp thư (cả mục Spam).`
        : 'Chưa cấu hình SMTP nên liên kết xác thực được in ở console backend.',
      dev_verification_url: devLinkEnabled() ? mail.url : undefined,
    });
  }),
);

// POST /api/auth/login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = parse(loginSchema, req.body);
    const { rows } = await query(
      `select ${USER_PUBLIC_COLUMNS}, password_hash, token_version
         from users where lower(email) = $1`,
      [body.email.toLowerCase()],
    );
    const user = rows[0];
    if (!user) throw new ApiError(401, 'Email hoặc mật khẩu không đúng.');

    const ok = await bcrypt.compare(body.password, user.password_hash);
    if (!ok) throw new ApiError(401, 'Email hoặc mật khẩu không đúng.');
    if (user.status === 'locked') throw new ApiError(403, 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.');
    if (!user.email_verified_at) {
      throw new ApiError(403, 'Email chưa được xác thực. Hãy mở liên kết trong email đăng ký.', {
        code: 'EMAIL_NOT_VERIFIED',
        email: user.email,
      });
    }

    res.json({ token: signToken(user.id, user.token_version), user: mapUser(user) });
  }),
);

// POST /api/auth/verify-email — xác thực bằng token trong email
router.post(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const body = parse(tokenSchema, req.body);
    const { rows } = await query(
      `update users
          set email_verified_at = coalesce(email_verified_at, now()),
              verification_token_hash = null,
              verification_token_expires_at = null,
              updated_at = now()
        where verification_token_hash = $1
          and verification_token_expires_at > now()
        returning ${USER_PUBLIC_COLUMNS}`,
      [hashToken(body.token)],
    );

    const user = rows[0];
    if (!user) throw new ApiError(400, 'Liên kết xác thực không hợp lệ hoặc đã hết hạn. Hãy yêu cầu gửi lại.');

    await notify(pool, user.id, {
      type: 'success',
      content: 'Email đã được xác thực. Chào mừng bạn đến với GâyQuỹ+! Hãy chọn chủ đề quan tâm để AI gợi ý dự án phù hợp.',
      link: '/chon-so-thich',
    });

    res.json({
      ok: true,
      user: mapUser(user),
      message: 'Xác thực email thành công. Bạn có thể đăng nhập ngay.',
    });
  }),
);

// POST /api/auth/resend-verification — gửi lại email xác thực
router.post(
  '/resend-verification',
  asyncHandler(async (req, res) => {
    const body = parse(emailSchema, req.body);
    const { rows } = await query(
      `select ${USER_PUBLIC_COLUMNS} from users where lower(email) = $1`,
      [body.email.toLowerCase()],
    );
    const user = rows[0];

    let url;
    let delivered = false;
    if (user && !user.email_verified_at && user.status !== 'locked') {
      const mail = await sendVerificationEmail(user);
      url = mail.url;
      delivered = mail.delivered;
    }

    res.json({
      ok: true,
      verification_sent: delivered,
      delivery: deliveryMode(),
      message: 'Nếu email tồn tại và chưa xác thực, chúng tôi đã gửi lại liên kết xác thực.',
      dev_verification_url: devLinkEnabled() ? url : undefined,
    });
  }),
);

// POST /api/auth/forgot-password — gửi email mã OTP đặt lại mật khẩu
router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const body = parse(emailSchema, req.body);
    const { rows } = await query(
      `select ${USER_PUBLIC_COLUMNS} from users where lower(email) = $1`,
      [body.email.toLowerCase()],
    );
    const user = rows[0];

    let delivered = false;
    let otp;
    if (user && user.status !== 'locked') {
      const mail = await sendResetEmail(user);
      delivered = mail.delivered;
      otp = mail.otp;
    }

    res.json({
      ok: true,
      reset_sent: delivered,
      delivery: deliveryMode(),
      message: 'Mã xác nhận (OTP) 6 chữ số đã được gửi tới email của bạn. Vui lòng kiểm tra hộp thư (cả mục Spam).',
      dev_otp: devLinkEnabled() ? otp : undefined,
    });
  }),
);

// POST /api/auth/reset-password — đặt mật khẩu mới bằng mã OTP hoặc token
router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const body = parse(resetPasswordSchema, req.body);
    const passwordHash = await bcrypt.hash(body.password, 10);
    const tokenHash = hashToken(body.token);

    let updateResult;
    if (body.email) {
      updateResult = await query(
        `update users
            set password_hash = $1,
                reset_token_hash = null,
                reset_token_expires_at = null,
                email_verified_at = coalesce(email_verified_at, now()),
                token_version = token_version + 1,
                updated_at = now()
          where lower(email) = $2
            and reset_token_hash = $3
            and reset_token_expires_at > now()
          returning id, email`,
        [passwordHash, body.email.toLowerCase(), tokenHash],
      );
    } else {
      updateResult = await query(
        `update users
            set password_hash = $1,
                reset_token_hash = null,
                reset_token_expires_at = null,
                email_verified_at = coalesce(email_verified_at, now()),
                token_version = token_version + 1,
                updated_at = now()
          where reset_token_hash = $2
            and reset_token_expires_at > now()
          returning id, email`,
        [passwordHash, tokenHash],
      );
    }

    if (!updateResult.rows[0]) {
      throw new ApiError(400, 'Mã xác nhận không đúng hoặc đã hết hạn. Vui lòng kiểm tra lại email hoặc yêu cầu mã mới.');
    }

    res.json({
      ok: true,
      message: 'Đặt lại mật khẩu thành công. Hãy đăng nhập bằng mật khẩu mới.',
    });
  }),
);

// GET /api/auth/me
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await buildSession(req.user));
  }),
);

// POST /api/auth/logout (JWT stateless — client tự xoá token)
router.post('/logout', (_req, res) => res.status(204).end());

export default router;
