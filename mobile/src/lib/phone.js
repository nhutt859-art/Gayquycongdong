// Số điện thoại Việt Nam: di động 10 số (03/05/07/08/09) hoặc cố định 11 số (02x).
const NATIONAL = '(?:2\\d{9}|[35789]\\d{8})';
const PHONE_RE = new RegExp(`^(?:0${NATIONAL}|\\+84${NATIONAL}|84${NATIONAL})$`);

export function normalizePhone(value) {
  return String(value ?? '')
    .trim()
    .replace(/[\s.()-]/g, '');
}

export function isValidVietnamesePhone(value) {
  return PHONE_RE.test(normalizePhone(value));
}

/** Chuẩn hoá về dạng bắt đầu bằng 0 để lưu DB và hiển thị thống nhất. */
export function canonicalVietnamesePhone(value) {
  const phone = normalizePhone(value);
  if (!PHONE_RE.test(phone)) return null;
  if (phone.startsWith('+84')) return `0${phone.slice(3)}`;
  if (phone.startsWith('84')) return `0${phone.slice(2)}`;
  return phone;
}

export const PHONE_HINT = 'Số di động 10 số (03/05/07/08/09) hoặc số cố định 11 số (02x).';
