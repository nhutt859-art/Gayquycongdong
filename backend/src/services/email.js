import { isMailConfigured, mailProvider } from './mailer.js';

export function appUrl() {
  const fallback = process.env.NODE_ENV === 'production' ? 'https://dacntt-web.vercel.app' : 'http://localhost:5173';
  const raw = process.env.APP_URL || process.env.CORS_ORIGIN || fallback;
  return String(raw).split(',')[0].trim().replace(/\/+$/, '');
}

/** Chế độ dev: chưa có email thì trả OTP/liên kết trực tiếp để test. */
export function devLinkEnabled() {
  // Không bao giờ trả OTP/liên kết trên production hoặc Render, kể cả khi
  // vô tình đặt DEV_SHOW_OTP=true trong biến môi trường.
  if (process.env.RENDER || process.env.NODE_ENV === 'production') return false;
  if (String(process.env.DEV_SHOW_OTP || '').toLowerCase() === 'true') return true;
  return !isMailConfigured();
}

export function deliveryMode() {
  return mailProvider();
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

export function emailLayout({ title, intro, buttonText, url, footer, otpCode }) {
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
