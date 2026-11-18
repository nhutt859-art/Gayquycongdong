import os from 'node:os';
import path from 'node:path';
import { createWorker } from 'tesseract.js';
import { pool, query } from '../db.js';
import { ApiError } from '../lib/errors.js';
import { validateDocumentImage } from '../lib/images.js';
import { canonicalVietnamesePhone } from '../lib/phone.js';
import { USER_PUBLIC_COLUMNS, mapUser } from '../lib/mappers.js';
import { expiryFromNow, hashToken, newToken } from '../lib/tokens.js';
import { appUrl, deliveryMode, devLinkEnabled, emailLayout, escapeHtml } from './email.js';
import { sendMail } from './mailer.js';
import { notify } from './notifications.js';

const KYC_TTL_MINUTES = Number(process.env.KYC_VERIFICATION_TTL_MINUTES || 2880);
const OCR_TIMEOUT_MS = Number(process.env.KYC_OCR_TIMEOUT_MS || 60000);

export const KYC_DOCUMENT_TYPES = {
  cccd: {
    label: 'Căn cước công dân',
    short: 'CCCD',
    keywords: [
      'CAN CUOC CONG DAN',
      'CAN CUOC',
      'CONG DAN',
      'SO DINH DANH CA NHAN',
      'SO DINH DANH',
      'CITIZEN IDENTITY CARD',
      'IDENTITY CARD',
      'CCCD',
    ],
    numberPattern: /^\d{12}$/,
    numberHint: 'Số CCCD phải gồm đúng 12 chữ số.',
    backRequired: true,
  },
  passport: {
    label: 'Hộ chiếu',
    short: 'Hộ chiếu',
    keywords: ['PASSPORT', 'HO CHIEU', 'SO THONG HANH'],
    numberPattern: /^(?:[A-Z][0-9]{7,8}|[0-9]{8,9})$/,
    numberHint: 'Số hộ chiếu gồm 8–9 ký tự (ví dụ B1234567).',
    backRequired: false,
  },
};

/** Bỏ dấu tiếng Việt + chuyển về chữ hoa để so khớp OCR. */
export function normalizeOcrText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9\s/.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function compact(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/** OCR hay nhầm một số ký tự; quy đổi khi đối chiếu số giấy tờ dạng số. */
function ocrDigits(value) {
  return compact(value).replace(/[OQDG]/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function dobMatches(text, dob) {
  const wanted = String(dob || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wanted)) return false;
  return rawLines(text).some((line) => datesInLine(line).includes(wanted));
}

function nameMatches(text, fullName) {
  const tokens = normalizeOcrText(fullName)
    .split(' ')
    .filter((token) => token.length >= 2);
  if (!tokens.length) return false;
  const haystack = normalizeOcrText(text);
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  // Tên 1–2 từ phải khớp đủ; tên dài cho phép OCR đọc thiếu tối đa 40% số từ.
  if (tokens.length <= 2) return matched === tokens.length;
  return matched >= Math.ceil(tokens.length * 0.6);
}

function detectDocumentType(text) {
  const haystack = normalizeOcrText(text);
  const found = [];
  for (const [type, meta] of Object.entries(KYC_DOCUMENT_TYPES)) {
    if (meta.keywords.some((keyword) => haystack.includes(keyword))) found.push(type);
  }
  return found;
}

/**
 * Chỉ coi là sai loại giấy tờ khi OCR đọc rõ ràng một loại khác.
 * Nhiều ảnh CCCD thật bị lóa/nghiêng nên không đọc được dòng tiêu đề;
 * khi đó các bước đối chiếu số giấy tờ, họ tên, ngày sinh bên dưới mới quyết định.
 */
function isWrongDocumentType(detected, documentType) {
  return detected.length > 0 && !detected.includes(documentType);
}

function assertDocumentContent(text, data) {
  if (!text || normalizeOcrText(text).length < 12) {
    throw new ApiError(422, 'Không đọc được thông tin trên ảnh giấy tờ. Vui lòng chụp lại ảnh rõ nét, đủ sáng và không bị che khuất.', {
      code: 'KYC_OCR_UNREADABLE',
    });
  }

  const detected = detectDocumentType(text);
  const meta = KYC_DOCUMENT_TYPES[data.document_type];
  if (isWrongDocumentType(detected, data.document_type)) {
    const other = detected.map((type) => KYC_DOCUMENT_TYPES[type].label).join(', ');
    throw new ApiError(
      422,
      `Ảnh tải lên là ${other}, không phải ${meta.label}. Vui lòng chọn đúng loại giấy tờ.`,
      { code: 'KYC_DOCUMENT_TYPE_MISMATCH', detected },
    );
  }

  const number = compact(data.document_number);
  const haystack = data.document_type === 'cccd' ? ocrDigits(text) : compact(text);
  if (!haystack.includes(number)) {
    throw new ApiError(422, `Không đối chiếu được số giấy tờ trên ảnh với số bạn nhập (${data.document_number}). Vui lòng kiểm tra lại.`, {
      code: 'KYC_DOCUMENT_NUMBER_MISMATCH',
      field: 'document_number',
    });
  }

  if (!nameMatches(text, data.full_name)) {
    throw new ApiError(422, 'Họ tên trên ảnh giấy tờ không khớp với họ tên bạn nhập. Vui lòng kiểm tra lại.', {
      code: 'KYC_NAME_MISMATCH',
      field: 'full_name',
    });
  }

  if (!dobMatches(text, data.dob)) {
    throw new ApiError(422, 'Ngày sinh trên ảnh giấy tờ không khớp với ngày sinh bạn nhập (định dạng ngày/tháng/năm).', {
      code: 'KYC_DOB_MISMATCH',
      field: 'dob',
    });
  }
}

// ------------------------------------------------------------
// Tiện ích đọc ngày sinh từ văn bản OCR khi đối chiếu hồ sơ.
// ------------------------------------------------------------
function rawLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function dateFromParts(day, month, year) {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  const currentYear = new Date().getUTCFullYear();
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return null;
  if (y < 1900 || y > currentYear || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

const OCR_DATE_CHARS = '[0-9OQDGILSZB]';

function datesInLine(line) {
  const normalized = normalizeOcrText(line);
  const dates = [];
  const pattern = new RegExp(
    `(${OCR_DATE_CHARS}{1,4})[/.-](${OCR_DATE_CHARS}{1,2})[/.-](${OCR_DATE_CHARS}{2,4})`,
    'g',
  );
  for (const match of normalized.matchAll(pattern)) {
    const parts = [match[1], match[2], match[3]].map((part) => ocrDigits(part));
    // OCR hay nhầm O/Q/D -> 0, I/L -> 1, S -> 5, B -> 8, Z -> 2 trong ngày sinh.
    const date =
      parts[0].length === 4
        ? dateFromParts(parts[2], parts[1], parts[0])
        : parts[2].length === 4
          ? dateFromParts(parts[0], parts[1], parts[2])
          : null;
    if (date) dates.push(date);
  }
  return dates;
}

// ------------------------------------------------------------
// OCR: một worker dùng chung, xếp hàng tuần tự để không ngốn RAM.
// ------------------------------------------------------------
let workerPromise = null;
let queue = Promise.resolve();
const cachePath = path.join(os.tmpdir(), 'gayquy-ocr');

async function createKycWorker() {
  try {
    const worker = await createWorker('vie+eng', 1, {
      cachePath,
      logger: () => {},
    });
    // PSM 6 đọc giấy tờ dạng khối chữ tốt hơn chế độ tự động trên ảnh chụp card.
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
    });
    return worker;
  } catch (err) {
    console.error('[kyc] Không tải được gói tiếng Việt, dùng eng:', err.message);
    const worker = await createWorker('eng', 1, {
      cachePath,
      logger: () => {},
    });
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
    });
    return worker;
  }
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createKycWorker().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

async function resetWorker() {
  const current = workerPromise;
  workerPromise = null;
  if (current) {
    try {
      const worker = await current;
      await worker.terminate();
    } catch {
      // worker đã lỗi, bỏ qua
    }
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function recognizeText(buffer) {
  const run = queue.then(async () => {
    try {
      const worker = await getWorker();
      const result = await withTimeout(worker.recognize(buffer), OCR_TIMEOUT_MS, 'KYC_OCR_TIMEOUT');
      return result?.data?.text || '';
    } catch (err) {
      await resetWorker();
      if (err?.message === 'KYC_OCR_TIMEOUT') {
        throw new ApiError(422, 'Quá thời gian đọc ảnh giấy tờ. Vui lòng thử lại với ảnh nhỏ hơn hoặc rõ nét hơn.', {
          code: 'KYC_OCR_TIMEOUT',
        });
      }
      console.error('[kyc] OCR lỗi:', err.message);
      throw new ApiError(422, 'Không thể đọc ảnh giấy tờ. Vui lòng thử lại với ảnh JPEG/PNG rõ nét.', {
        code: 'KYC_OCR_FAILED',
      });
    }
  });
  queue = run.catch(() => {});
  return run;
}

// ------------------------------------------------------------
// Gửi email xác thực hồ sơ KYC
// ------------------------------------------------------------
function kycVerificationUrl(token) {
  return `${appUrl()}/xac-thuc-kyc?token=${encodeURIComponent(token)}`;
}

async function sendKycEmail(user, contactEmail) {
  const token = newToken();
  const expiresAt = expiryFromNow(KYC_TTL_MINUTES);
  await query(
    `update users
        set kyc_token_hash = $1,
            kyc_token_expires_at = $2,
            updated_at = now()
      where id = $3`,
    [hashToken(token), expiresAt, user.id],
  );

  const url = kycVerificationUrl(token);
  const hours = Math.max(1, Math.round(KYC_TTL_MINUTES / 60));
  const masked = user.kyc_document_number
    ? `••••${String(user.kyc_document_number).slice(-4)}`
    : '';

  const text = [
    `Xin chào ${user.full_name},`,
    '',
    'GâyQuỹ+ đã tiếp nhận hồ sơ xác thực danh tính (KYC) của bạn.',
    `Giấy tờ: ${KYC_DOCUMENT_TYPES[user.kyc_document_type]?.label || 'Giấy tờ tuỳ thân'} ${masked}`,
    '',
    'Bấm liên kết sau để xác thực địa chỉ email và hoàn tất KYC:',
    url,
    '',
    `Liên kết hết hạn sau ${hours} giờ.`,
    'Nếu bạn không gửi hồ sơ này, hãy liên hệ quản trị viên ngay.',
  ].join('\n');

  const html = emailLayout({
    title: 'Hoàn tất xác thực danh tính',
    intro: `Xin chào <b>${escapeHtml(user.full_name)}</b>, GâyQuỹ+ đã tiếp nhận hồ sơ KYC của bạn (<b>${escapeHtml(
      KYC_DOCUMENT_TYPES[user.kyc_document_type]?.label || 'giấy tờ tuỳ thân',
    )}</b> ${escapeHtml(masked)}). Bấm nút bên dưới để xác thực email và kích hoạt trạng thái đã xác thực danh tính.`,
    buttonText: 'Xác thực email KYC',
    url,
    footer: `Liên kết hết hạn sau ${hours} giờ. Nếu bạn không gửi hồ sơ này, hãy liên hệ quản trị viên để được hỗ trợ.`,
  });

  let delivered = false;
  try {
    const result = await sendMail({
      to: contactEmail,
      subject: '[GâyQuỹ+] Xác thực email cho hồ sơ KYC',
      text,
      html,
    });
    delivered = result.delivered;
  } catch (err) {
    console.error('[mail] Không gửi được email KYC:', err.message);
  }

  return { delivered, url };
}

// ------------------------------------------------------------
// API service
// ------------------------------------------------------------
async function loadKycUser(userId) {
  const { rows } = await query(
    `select ${USER_PUBLIC_COLUMNS}, kyc_document_type, kyc_document_number, kyc_contact_email,
            kyc_token_expires_at
       from users where id = $1`,
    [userId],
  );
  return rows[0] || null;
}

export async function submitKyc(userId, input) {
  const user = await loadKycUser(userId);
  if (!user) throw new ApiError(404, 'Không tìm thấy tài khoản.');
  if (user.status === 'locked') {
    throw new ApiError(403, 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.', { code: 'ACCOUNT_LOCKED' });
  }
  if (user.kyc_status === 'verified') {
    return {
      user: mapUser(user),
      already_verified: true,
      message: 'Tài khoản đã được xác thực danh tính trước đó.',
    };
  }

  const documentType = String(input.document_type || '').toLowerCase();
  const meta = KYC_DOCUMENT_TYPES[documentType];
  if (!meta) throw new ApiError(400, 'Loại giấy tờ không hợp lệ. Chỉ chấp nhận CCCD hoặc hộ chiếu.');

  const fullName = String(input.full_name || '').trim().replace(/\s+/g, ' ');
  if (fullName.split(' ').length < 2) throw new ApiError(400, 'Vui lòng nhập đầy đủ họ và tên.');

  const phone = canonicalVietnamesePhone(input.phone);
  if (!phone) {
    throw new ApiError(400, 'Số điện thoại không hợp lệ. Dùng số di động Việt Nam 10 số hoặc số cố định 11 số.', {
      code: 'INVALID_PHONE',
      field: 'phone',
    });
  }

  const email = String(input.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new ApiError(400, 'Email liên hệ không hợp lệ.', { code: 'INVALID_EMAIL', field: 'email' });
  }

  const dob = String(input.dob || '').trim();
  const dobDate = new Date(`${dob}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(dobDate.getTime())) {
    throw new ApiError(400, 'Ngày sinh không hợp lệ.', { code: 'INVALID_DOB', field: 'dob' });
  }
  const age = (Date.now() - dobDate.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (age < 14 || age > 120) {
    throw new ApiError(400, 'Ngày sinh không hợp lệ. Người gửi hồ sơ phải từ 14 tuổi trở lên.', {
      code: 'INVALID_DOB',
      field: 'dob',
    });
  }

  const address = String(input.address || '').trim().replace(/\s+/g, ' ');
  if (address.length < 5) throw new ApiError(400, 'Vui lòng nhập địa chỉ thường trú chi tiết.');

  const documentNumber = compact(input.document_number);
  if (!meta.numberPattern.test(documentNumber)) {
    throw new ApiError(400, meta.numberHint, { code: 'INVALID_DOCUMENT_NUMBER', field: 'document_number' });
  }

  const duplicate = await query(
    `select id
       from users
      where id <> $1
        and kyc_status in ('pending', 'verified')
        and kyc_document_type = $2
        and upper(kyc_document_number) = $3`,
    [userId, documentType, documentNumber],
  );
  if (duplicate.rowCount) {
    throw new ApiError(409, 'Số giấy tờ này đã được dùng để xác thực cho một tài khoản khác. Vui lòng liên hệ quản trị viên nếu bạn cho rằng đây là nhầm lẫn.', {
      code: 'KYC_DOCUMENT_USED',
    });
  }

  // Kiểm tra ảnh trước khi OCR để từ chối sớm ảnh sai định dạng/kích thước.
  const front = validateDocumentImage(input.front_image, 'Ảnh mặt trước giấy tờ');
  let back = null;
  if (input.back_image) {
    back = validateDocumentImage(input.back_image, 'Ảnh mặt sau giấy tờ');
  } else if (meta.backRequired) {
    throw new ApiError(400, 'Vui lòng tải ảnh mặt sau của CCCD.');
  }

  const ocrText = await recognizeText(front.buffer);
  assertDocumentContent(ocrText, {
    document_type: documentType,
    document_number: documentNumber,
    full_name: fullName,
    dob,
  });

  let updated;
  try {
    const result = await query(
      `update users
          set kyc_status = 'pending',
              kyc_document_type = $1,
              kyc_document_number = $2,
              kyc_full_name = $3,
              kyc_dob = $4::date,
              kyc_phone = $5,
              kyc_contact_email = $6,
              kyc_address = $7,
              kyc_document_front_url = $8,
              kyc_document_back_url = $9,
              kyc_submitted_at = now(),
              kyc_verified_at = null,
              kyc_reject_reason = null,
              updated_at = now()
        where id = $10
        returning ${USER_PUBLIC_COLUMNS}, kyc_document_type, kyc_document_number, kyc_contact_email`,
      [
        documentType,
        documentNumber,
        fullName,
        dob,
        phone,
        email,
        address,
        String(input.front_image).trim(),
        back ? String(input.back_image).trim() : null,
        userId,
      ],
    );
    updated = result.rows[0];
  } catch (err) {
    if (err?.code === '23505') {
      throw new ApiError(409, 'Số giấy tờ này đã được dùng để xác thực cho một tài khoản khác.', {
        code: 'KYC_DOCUMENT_USED',
      });
    }
    throw err;
  }

  const mail = await sendKycEmail(updated, email);
  await notify(pool, userId, {
    type: 'account',
    content: 'Hồ sơ xác thực danh tính đã được tiếp nhận. Vui lòng mở email để xác thực và hoàn tất KYC.',
    link: '/ca-nhan',
  });

  return {
    user: mapUser(updated),
    delivery: deliveryMode(),
    dev_verification_url: devLinkEnabled() ? mail.url : undefined,
    message: mail.delivered
      ? 'Đã gửi email xác thực KYC. Vui lòng mở email để hoàn tất xác thực danh tính.'
      : 'Hồ sơ đã được tiếp nhận. Hệ thống chưa cấu hình gửi email — hãy dùng liên kết xác thực hiển thị trên trang để hoàn tất.',
  };
}

export async function resendKycEmail(userId) {
  const user = await loadKycUser(userId);
  if (!user) throw new ApiError(404, 'Không tìm thấy tài khoản.');
  if (user.status === 'locked') {
    throw new ApiError(403, 'Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.', { code: 'ACCOUNT_LOCKED' });
  }
  if (user.kyc_status === 'verified') {
    return { user: mapUser(user), message: 'Tài khoản đã được xác thực danh tính.' };
  }
  if (user.kyc_status !== 'pending' || !user.kyc_document_type) {
    throw new ApiError(400, 'Bạn chưa gửi hồ sơ KYC. Vui lòng hoàn tất hồ sơ trước khi yêu cầu gửi lại email.');
  }

  const mail = await sendKycEmail(user, user.kyc_contact_email || user.email);
  return {
    user: mapUser(user),
    delivery: deliveryMode(),
    dev_verification_url: devLinkEnabled() ? mail.url : undefined,
    message: mail.delivered
      ? 'Đã gửi lại email xác thực KYC.'
      : 'Hệ thống chưa cấu hình gửi email — hãy dùng liên kết xác thực hiển thị trên trang.',
  };
}

export async function verifyKycToken(token) {
  const { rows } = await query(
    `update users
        set kyc_status = 'verified',
            kyc_verified_at = now(),
            kyc_token_hash = null,
            kyc_token_expires_at = null,
            trust_score = least(100, trust_score + 5),
            updated_at = now()
      where kyc_token_hash = $1
        and kyc_token_expires_at > now()
        and kyc_status = 'pending'
      returning ${USER_PUBLIC_COLUMNS}, kyc_verified_at`,
    [hashToken(token)],
  );
  const user = rows[0];
  if (!user) {
    throw new ApiError(400, 'Liên kết xác thực KYC không hợp lệ, đã được sử dụng hoặc đã hết hạn. Hãy yêu cầu gửi lại từ trang cá nhân.');
  }

  await notify(pool, user.id, {
    type: 'success',
    content: 'Xác thực danh tính thành công. Bạn đã có thể tạo dự án gây quỹ.',
    link: '/ca-nhan',
  });

  return mapUser(user);
}
