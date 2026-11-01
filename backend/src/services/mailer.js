import nodemailer from 'nodemailer';

/**
 * Gửi email qua 2 kiểu:
 *  - HTTP API (Resend / Brevo / SendGrid): đi qua cổng 443, hoạt động trên Render free.
 *  - SMTP (Gmail, ...): chỉ dùng khi chạy local/VPS hoặc Render trả phí, vì Render free
 *    chặn outbound các cổng 25/465/587.
 *
 * Thứ tự ưu tiên khi không đặt MAIL_PROVIDER:
 *   BREVO_API_KEY > RESEND_API_KEY > SENDGRID_API_KEY > SMTP.
 * Có thể chọn cứng bằng MAIL_PROVIDER=brevo|resend|sendgrid|smtp|console.
 */

const HTTP_TIMEOUT_MS = Number(process.env.MAIL_HTTP_TIMEOUT_MS) || 15000;
const PROVIDERS = ['brevo', 'resend', 'sendgrid', 'smtp', 'console'];

let transporter = null;

function env(name) {
  return String(process.env[name] || '').trim();
}

/** Địa chỉ gửi hiển thị trong email. Hỗ trợ dạng `Tên <email@domain>`. */
export function mailFrom() {
  return env('MAIL_FROM') || env('EMAIL_FROM') || env('SMTP_FROM');
}

/** Nhà cung cấp email đang được cấu hình. */
export function mailProvider() {
  const explicit = env('MAIL_PROVIDER').toLowerCase();
  if (PROVIDERS.includes(explicit)) return explicit;

  if (env('BREVO_API_KEY')) return 'brevo';
  if (env('RESEND_API_KEY')) return 'resend';
  if (env('SENDGRID_API_KEY')) return 'sendgrid';
  if (env('SMTP_HOST') && mailFrom()) return 'smtp';
  return 'console';
}

/** Có đủ cấu hình để gửi email thật hay không. */
export function isMailConfigured() {
  const provider = mailProvider();
  if (provider === 'console' || !mailFrom()) return false;
  if (provider === 'brevo') return Boolean(env('BREVO_API_KEY'));
  if (provider === 'resend') return Boolean(env('RESEND_API_KEY'));
  if (provider === 'sendgrid') return Boolean(env('SENDGRID_API_KEY'));
  if (provider === 'smtp') return Boolean(env('SMTP_HOST'));
  return false;
}

/** Gợi ý khi cấu hình chưa phù hợp với môi trường deploy. */
export function mailConfigWarning() {
  const provider = mailProvider();
  const explicit = env('MAIL_PROVIDER').toLowerCase();

  if (explicit && !PROVIDERS.includes(explicit)) {
    return `MAIL_PROVIDER="${explicit}" không hợp lệ. Dùng brevo, resend, sendgrid, smtp hoặc console.`;
  }
  if (provider !== 'console' && !mailFrom()) {
    return 'Đã chọn dịch vụ email nhưng thiếu MAIL_FROM (hoặc SMTP_FROM) — địa chỉ gửi email.';
  }
  if (provider === 'brevo' && !env('BREVO_API_KEY')) {
    return 'MAIL_PROVIDER=brevo nhưng thiếu BREVO_API_KEY.';
  }
  if (provider === 'resend' && !env('RESEND_API_KEY')) {
    return 'MAIL_PROVIDER=resend nhưng thiếu RESEND_API_KEY.';
  }
  if (provider === 'sendgrid' && !env('SENDGRID_API_KEY')) {
    return 'MAIL_PROVIDER=sendgrid nhưng thiếu SENDGRID_API_KEY.';
  }
  if (provider === 'smtp' && !env('SMTP_HOST')) {
    return 'MAIL_PROVIDER=smtp nhưng thiếu SMTP_HOST.';
  }
  if (provider === 'smtp' && process.env.RENDER) {
    return 'Nếu Render service dùng gói free, cổng SMTP 25/465/587 bị chặn. Hãy dùng BREVO_API_KEY, RESEND_API_KEY hoặc SENDGRID_API_KEY.';
  }
  if (provider === 'console' && process.env.RENDER) {
    return 'Chưa cấu hình dịch vụ email. Thêm BREVO_API_KEY + MAIL_FROM (hoặc SENDGRID_API_KEY/RESEND_API_KEY) trong Render > Environment.';
  }
  return null;
}

function requireKey(name, provider) {
  const value = env(name);
  if (!value) throw new Error(`${provider}: thiếu ${name}.`);
  return value;
}

function getTransporter() {
  if (!env('SMTP_HOST') || !mailFrom()) return null;
  if (transporter) return transporter;

  const port = Number(env('SMTP_PORT') || 587);
  const secure =
    String(env('SMTP_SECURE') || '').toLowerCase() === 'true' || port === 465;

  transporter = nodemailer.createTransport({
    host: env('SMTP_HOST'),
    port,
    secure,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    auth: env('SMTP_USER')
      ? { user: env('SMTP_USER'), pass: env('SMTP_PASS') }
      : undefined,
  });
  return transporter;
}

/** Tách `GayQuy+ <no-reply@example.com>` thành { name, email }. */
function parseFrom(value) {
  let raw = String(value || '').trim();
  // Một số dashboard/env UI lưu cả cặp ngoặc kép bao quanh giá trị.
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    raw = raw.slice(1, -1).trim();
  }
  const match = raw.match(/^(.*?)<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].trim().replace(/^["']|["']$/g, '') || undefined,
      email: match[2].trim(),
    };
  }
  return { email: raw };
}

async function getJson(url, headers, provider) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json', ...headers },
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err?.name === 'AbortError' ? `quá ${HTTP_TIMEOUT_MS}ms` : err.message;
    throw new Error(`${provider}: không kết nối được API (${reason}).`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${provider}: HTTP ${res.status} — ${text.slice(0, 500) || res.statusText}`);
  }

  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function postJson(url, headers, payload, provider) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    const reason = err?.name === 'AbortError' ? `quá ${HTTP_TIMEOUT_MS}ms` : err.message;
    throw new Error(`${provider}: không kết nối được API (${reason}).`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${provider}: HTTP ${res.status} — ${text.slice(0, 500) || res.statusText}`);
  }

  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { data, headers: res.headers };
}

async function sendViaResend({ to, subject, text, html }) {
  const { data } = await postJson(
    'https://api.resend.com/emails',
    { Authorization: `Bearer ${requireKey('RESEND_API_KEY', 'Resend')}` },
    {
      from: mailFrom(),
      to: [to],
      subject,
      text,
      html,
    },
    'Resend',
  );
  return { delivered: true, transport: 'resend', messageId: data.id };
}

async function sendViaBrevo({ to, subject, text, html }) {
  const from = parseFrom(mailFrom());
  const { data } = await postJson(
    'https://api.brevo.com/v3/smtp/email',
    {
      'api-key': requireKey('BREVO_API_KEY', 'Brevo'),
      accept: 'application/json',
    },
    {
      sender: { email: from.email, name: from.name || 'GayQuy+' },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    },
    'Brevo',
  );
  return { delivered: true, transport: 'brevo', messageId: data.messageId };
}

async function sendViaSendgrid({ to, subject, text, html }) {
  const from = parseFrom(mailFrom());
  const { headers } = await postJson(
    'https://api.sendgrid.com/v3/mail/send',
    { Authorization: `Bearer ${requireKey('SENDGRID_API_KEY', 'SendGrid')}` },
    {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from.email, name: from.name || 'GayQuy+' },
      subject,
      content: [
        ...(text ? [{ type: 'text/plain', value: text }] : []),
        ...(html ? [{ type: 'text/html', value: html }] : []),
      ],
    },
    'SendGrid',
  );
  return {
    delivered: true,
    transport: 'sendgrid',
    messageId: headers.get('x-message-id') || undefined,
  };
}

/**
 * Kiểm tra nhanh cấu hình dịch vụ email. Hiện hỗ trợ Brevo:
 * xác minh API key và địa chỉ MAIL_FROM có nằm trong danh sách sender đã kích hoạt không.
 * Không trả về API key hay toàn bộ danh sách sender.
 */
export async function verifyMailConfig() {
  const provider = mailProvider();
  if (provider === 'console') {
    return { provider, configured: false, error: 'Chưa cấu hình dịch vụ email.' };
  }
  if (!mailFrom()) {
    return { provider, configured: false, error: 'Thiếu MAIL_FROM (hoặc SMTP_FROM).' };
  }
  if (provider !== 'brevo') {
    return {
      provider,
      configured: isMailConfigured(),
      note: 'Chỉ kiểm tra tự động được sender của Brevo.',
    };
  }

  const key = env('BREVO_API_KEY');
  if (!key) {
    return { provider, configured: false, error: 'Thiếu BREVO_API_KEY.' };
  }

  try {
    const data = await getJson(
      'https://api.brevo.com/v3/senders',
      { 'api-key': key },
      'Brevo',
    );
    const list = Array.isArray(data?.senders) ? data.senders : [];
    const from = parseFrom(mailFrom()).email.toLowerCase();
    const sender = list.find((s) => String(s.email || '').toLowerCase() === from);

    return {
      provider,
      configured: true,
      from,
      sender_found: Boolean(sender),
      sender_verified: Boolean(sender && sender.active === true),
      sender_count: list.length,
    };
  } catch (err) {
    return {
      provider,
      configured: true,
      from: parseFrom(mailFrom()).email,
      sender_verified: false,
      error: err.message,
    };
  }
}

/**
 * Gửi email. Nếu chưa cấu hình dịch vụ nào thì in nội dung ra console (chế độ dev)
 * để vẫn có thể test luồng xác thực / đặt lại mật khẩu.
 */
export async function sendMail({ to, subject, text, html }) {
  const provider = mailProvider();

  if (provider === 'console') {
    console.log('\n📧 [mail:console] Chưa cấu hình dịch vụ email — nội dung email:');
    console.log(`   To: ${to}`);
    console.log(`   Subject: ${subject}`);
    console.log(
      String(text || '')
        .split('\n')
        .map((line) => `   ${line}`)
        .join('\n'),
    );
    console.log(
      '   → Thêm BREVO_API_KEY + MAIL_FROM (hoặc RESEND_API_KEY/SENDGRID_API_KEY) để gửi thật.\n',
    );
    return { delivered: false, transport: 'console' };
  }

  let result;
  if (!mailFrom()) {
    throw new Error('Thiếu MAIL_FROM (hoặc SMTP_FROM) — địa chỉ gửi email.');
  }
  if (provider === 'resend') {
    result = await sendViaResend({ to, subject, text, html });
  } else if (provider === 'brevo') {
    result = await sendViaBrevo({ to, subject, text, html });
  } else if (provider === 'sendgrid') {
    result = await sendViaSendgrid({ to, subject, text, html });
  } else {
    const tx = getTransporter();
    if (!tx) throw new Error('SMTP: thiếu SMTP_HOST hoặc địa chỉ gửi (MAIL_FROM/SMTP_FROM).');
    const info = await tx.sendMail({
      from: mailFrom(),
      to,
      subject,
      text,
      html,
    });
    result = { delivered: true, transport: 'smtp', messageId: info.messageId };
  }

  console.log(
    `📧 Đã gửi email tới ${to} qua ${result.transport}` +
      (result.messageId ? ` (${result.messageId})` : ''),
  );
  return result;
}
