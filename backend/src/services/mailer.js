import nodemailer from 'nodemailer';

let transporter = null;

/** Có đủ cấu hình SMTP để gửi email thật hay không. */
export function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function getTransporter() {
  if (!isMailConfigured()) return null;
  if (transporter) return transporter;

  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

/**
 * Gửi email. Nếu chưa cấu hình SMTP thì in nội dung ra console (chế độ dev)
 * để vẫn có thể bấm liên kết xác thực / đặt lại mật khẩu.
 */
export async function sendMail({ to, subject, text, html }) {
  const tx = getTransporter();

  if (!tx) {
    console.log('\n📧 [mail:console] SMTP chưa cấu hình — nội dung email:');
    console.log(`   To: ${to}`);
    console.log(`   Subject: ${subject}`);
    console.log(
      String(text || '')
        .split('\n')
        .map((line) => `   ${line}`)
        .join('\n'),
    );
    console.log('   → Điền SMTP_HOST / SMTP_USER / SMTP_PASS / SMTP_FROM trong backend/.env để gửi thật.\n');
    return { delivered: false, transport: 'console' };
  }

  const info = await tx.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text,
    html,
  });
  console.log(`📧 Đã gửi email tới ${to} (${info.messageId})`);
  return { delivered: true, transport: 'smtp', messageId: info.messageId };
}
