import { isValidVietnamesePhone, PHONE_HINT } from './phone';

export const KYC_DOCUMENT_TYPES = {
  cccd: {
    label: 'Căn cước công dân',
    short: 'CCCD',
    numberLabel: 'Số CCCD',
    numberHint: '12 chữ số in trên thẻ CCCD.',
    numberPlaceholder: '001203012345',
    numberPattern: /^\d{12}$/,
    numberError: 'Số CCCD phải gồm đúng 12 chữ số.',
    backRequired: true,
  },
  passport: {
    label: 'Hộ chiếu',
    short: 'Hộ chiếu',
    numberLabel: 'Số hộ chiếu',
    numberHint: '8–9 ký tự, ví dụ B1234567.',
    numberPlaceholder: 'B1234567',
    numberPattern: /^(?:[A-Z][0-9]{7,8}|[0-9]{8,9})$/i,
    numberError: 'Số hộ chiếu gồm 8–9 ký tự (ví dụ B1234567).',
    backRequired: false,
  },
};

export function maxBirthDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 14);
  return date.toISOString().slice(0, 10);
}

export function minBirthDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 120);
  return date.toISOString().slice(0, 10);
}

export const KYC_SCAN_FIELDS = ['full_name', 'dob', 'document_number', 'address'];

export const KYC_SCAN_FIELD_LABELS = {
  full_name: 'họ tên',
  dob: 'ngày sinh',
  document_number: 'số giấy tờ',
  address: 'địa chỉ',
};

function normalizedName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * OCR thường trả tên không dấu. Nếu tên đã nhập chỉ khác dấu, giữ nguyên bản có dấu.
 */
export function preferScannedName(current, scanned) {
  if (!current) return scanned;
  if (!scanned) return current;
  return normalizedName(current) === normalizedName(scanned) ? current : scanned;
}

/**
 * Chỉ điền giá trị OCR vào ô đang trống hoặc đang sai định dạng.
 * Tránh ghi đè thông tin người dùng đã nhập đúng bằng kết quả OCR có thể sai.
 */
export function shouldFillScannedField(key, current, documentType) {
  const value = String(current || '').trim();
  if (!value) return true;
  if (key === 'dob') return !/^\d{4}-\d{2}-\d{2}$/.test(value);
  if (key === 'document_number') {
    const meta = KYC_DOCUMENT_TYPES[documentType] || KYC_DOCUMENT_TYPES.cccd;
    return !meta.numberPattern.test(value.replace(/[^A-Za-z0-9]/g, ''));
  }
  if (key === 'address') return value.length < 5;
  return false;
}

export function validateKycDraft(form) {
  const errors = {};
  const meta = KYC_DOCUMENT_TYPES[form.document_type] || KYC_DOCUMENT_TYPES.cccd;

  if (String(form.full_name || '').trim().split(/\s+/).filter(Boolean).length < 2) {
    errors.full_name = 'Vui lòng nhập đầy đủ họ và tên.';
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dob || '')) {
    errors.dob = 'Vui lòng nhập ngày sinh dạng YYYY-MM-DD.';
  } else if (form.dob > maxBirthDate()) {
    errors.dob = 'Người gửi hồ sơ phải từ 14 tuổi trở lên.';
  } else if (form.dob < minBirthDate()) {
    errors.dob = 'Ngày sinh không hợp lệ.';
  }

  if (!isValidVietnamesePhone(form.phone)) {
    errors.phone = `Số điện thoại chưa hợp lệ. ${PHONE_HINT}`;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(form.email || '').trim())) {
    errors.email = 'Email liên hệ không hợp lệ.';
  }

  if (String(form.address || '').trim().length < 5) {
    errors.address = 'Vui lòng nhập địa chỉ thường trú chi tiết.';
  }

  const number = String(form.document_number || '').replace(/[^A-Za-z0-9]/g, '');
  if (!meta.numberPattern.test(number)) {
    errors.document_number = meta.numberError;
  }

  if (!form.front_image) errors.front_image = 'Vui lòng tải ảnh mặt trước giấy tờ.';
  if (meta.backRequired && !form.back_image) errors.back_image = 'Vui lòng tải ảnh mặt sau của CCCD.';

  return errors;
}

export function kycErrorMessage(err) {
  const code = err?.details?.code;
  if (code === 'KYC_DOCUMENT_USED') {
    return `${err.message} Nếu giấy tờ đã từng được xác thực, hãy liên hệ quản trị viên để được hỗ trợ.`;
  }
  if (code === 'KYC_OCR_FAILED' || code === 'KYC_OCR_UNREADABLE' || code === 'KYC_OCR_TIMEOUT') {
    return `${err.message} Ảnh cần rõ nét, đủ sáng, không lóa và thấy rõ số giấy tờ cùng họ tên.`;
  }
  return err?.message || 'Không gửi được hồ sơ KYC.';
}
