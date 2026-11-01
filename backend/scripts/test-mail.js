import 'dotenv/config';
import {
  isMailConfigured,
  mailConfigWarning,
  mailFrom,
  mailProvider,
  sendMail,
} from '../src/services/mailer.js';

const to = process.argv[2] || process.env.MAIL_TEST_TO;
const provider = mailProvider();

console.log(`📧 Provider: ${provider}`);
console.log(`📧 From: ${mailFrom() || '(chưa đặt MAIL_FROM/SMTP_FROM)'}`);
const warning = mailConfigWarning();
if (warning) console.warn(`⚠️  ${warning}`);

if (!to) {
  console.error('\nCách dùng: npm run mail:test -- ban@example.com');
  process.exit(1);
}
if (!isMailConfigured()) {
  console.error('\n❌ Chưa cấu hình email. Thêm BREVO_API_KEY + MAIL_FROM vào backend/.env');
  process.exit(1);
}

try {
  const result = await sendMail({
    to,
    subject: '[GâyQuỹ+] Email kiểm tra cấu hình',
    text: `Nếu bạn nhận được email này, cấu hình ${provider} đã hoạt động.`,
    html: `<p>Nếu bạn nhận được email này, cấu hình <b>${provider}</b> đã hoạt động.</p>`,
  });
  console.log(`\n✅ Đã gửi tới ${to} qua ${result.transport}` + (result.messageId ? ` (${result.messageId})` : ''));
} catch (err) {
  console.error(`\n❌ Gửi email thất bại: ${err.message}`);
  process.exit(1);
}
