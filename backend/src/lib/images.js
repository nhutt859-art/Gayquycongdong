import crypto from 'node:crypto';
import { ApiError } from './errors.js';

const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/** Đọc data URL ảnh, xác minh MIME/magic bytes và giới hạn dung lượng. */
export function parseImageDataUrl(value, label = 'Ảnh', { maxBytes = 4 * 1024 * 1024 } = {}) {
  const raw = String(value || '').trim();
  const match = raw.match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    throw new ApiError(400, `${label} phải là ảnh JPEG hoặc PNG.`);
  }
  const mime = match[1];
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length) throw new ApiError(400, `${label} rỗng hoặc không đọc được.`);
  if (buffer.length > maxBytes) {
    throw new ApiError(400, `${label} vượt quá ${Math.round(maxBytes / 1024 / 1024)}MB. Vui lòng chọn ảnh nhỏ hơn.`);
  }

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if ((mime === 'image/jpeg' && !isJpeg) || (mime === 'image/png' && !isPng)) {
    throw new ApiError(400, `${label} không phải ảnh ${mime === 'image/jpeg' ? 'JPEG' : 'PNG'} hợp lệ.`);
  }

  return {
    buffer,
    mime,
    ext: MIME_EXT[mime],
    hash: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

function pngSize(buffer) {
  if (buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegSize(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = buffer[offset + 1];
    while (marker === 0xff) {
      offset += 1;
      marker = buffer[offset + 1];
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

export function imageDimensions(image) {
  const size = image.mime === 'image/png' ? pngSize(image.buffer) : jpegSize(image.buffer);
  return size && size.width > 0 && size.height > 0 ? size : null;
}

/**
 * Kiểm tra ảnh giấy tờ: đúng JPEG/PNG và đủ độ phân giải tối thiểu.
 * Chấp nhận cả ảnh dọc lẫn ảnh ngang vì người dùng thường chụp bằng điện thoại.
 * Chỉ kiểm tra tỷ lệ khung khi nơi gọi truyền tường minh `options.aspect`.
 */
export function validateDocumentImage(value, label, options = {}) {
  const image = parseImageDataUrl(value, label, options);
  const size = imageDimensions(image);
  if (!size) throw new ApiError(400, `Không đọc được kích thước ${label.toLowerCase()}. Vui lòng chọn ảnh khác.`);

  const minWidth = options.minWidth ?? 240;
  const minHeight = options.minHeight ?? 240;
  const minPixels = options.minPixels ?? 240_000;
  if (
    size.width < minWidth ||
    size.height < minHeight ||
    size.width * size.height < minPixels
  ) {
    throw new ApiError(
      400,
      `${label} quá nhỏ (${size.width}×${size.height}px). Vui lòng chọn ảnh rõ hơn, tối thiểu 600×400px (hoặc 400×600px với ảnh dọc).`,
    );
  }

  if (options.aspect) {
    const [minRatio, maxRatio] = options.aspect;
    const ratio = size.width / size.height;
    if (ratio < minRatio || ratio > maxRatio) {
      throw new ApiError(
        400,
        `${label} có tỷ lệ khung chưa phù hợp (${minRatio}–${maxRatio}). Vui lòng chụp lại giấy tờ trong khung hình.`,
      );
    }
  }

  return { ...image, ...size };
}

/** Ảnh bản tin có thể là URL http(s) hoặc data URL JPEG/PNG. */
export function normalizeContentImage(value, label = 'Ảnh bản tin') {
  const raw = String(value || '').trim();
  if (/^https?:\/\/\S+$/i.test(raw)) {
    if (raw.length > 500) throw new ApiError(400, `${label} có URL quá dài.`);
    return raw;
  }
  if (raw.startsWith('data:')) {
    const image = parseImageDataUrl(raw, label, { maxBytes: 2 * 1024 * 1024 });
    const size = imageDimensions(image);
    if (!size) throw new ApiError(400, `Không đọc được ${label.toLowerCase()}.`);
    return raw;
  }
  throw new ApiError(400, `${label} phải là URL http(s) hoặc ảnh JPEG/PNG.`);
}
