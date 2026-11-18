const IMAGE_EXT_RE = /\.(jpe?g|png|webp|heic|heif|bmp|gif|avif|tiff?)$/i;

function isImageFile(file) {
  const type = String(file?.type || '').toLowerCase();
  if (!type || type === 'application/octet-stream') return true;
  if (type.startsWith('image/')) return true;
  return IMAGE_EXT_RE.test(String(file?.name || ''));
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(
        new Error(
          'Không đọc được ảnh này. Nếu ảnh là HEIC hoặc định dạng đặc biệt, hãy chuyển sang JPG/PNG rồi chọn lại.',
        ),
      );
    image.src = dataUrl;
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không đọc được tệp ảnh đã chọn.'));
    reader.readAsDataURL(file);
  });
}

function dataUrlBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((base64.length * 3) / 4);
}

/**
 * Đọc ảnh từ input file, thu nhỏ và nén về JPEG để vừa giới hạn backend.
 * Trả về data URL JPEG.
 */
export async function readImageFile(file, { maxBytes = 2 * 1024 * 1024, maxWidth = 1600, maxHeight = 1600 } = {}) {
  if (!file) throw new Error('Vui lòng chọn ảnh.');
  if (!isImageFile(file)) throw new Error('Chỉ chấp nhận tệp ảnh (JPG, PNG, HEIC, WEBP…).');

  const original = await readAsDataUrl(file);
  const image = await loadImage(original);
  const qualities = [0.88, 0.8, 0.72, 0.62, 0.5];
  let width = image.naturalWidth || image.width;
  let height = image.naturalHeight || image.height;
  let result = '';

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of qualities) {
      result = canvas.toDataURL('image/jpeg', quality);
      if (dataUrlBytes(result) <= maxBytes) {
        return { dataUrl: result, width: canvas.width, height: canvas.height };
      }
    }

    width = Math.round(width * 0.8);
    height = Math.round(height * 0.8);
  }

  throw new Error(`Ảnh quá lớn. Vui lòng chọn ảnh nhỏ hơn ${Math.round(maxBytes / 1024 / 1024)}MB.`);
}

/**
 * Ảnh giấy tờ KYC: chấp nhận ảnh dọc lẫn ảnh ngang, chỉ cần đủ độ phân giải để OCR.
 */
export async function readDocumentImage(file, label) {
  const result = await readImageFile(file, {
    maxBytes: 3.6 * 1024 * 1024,
    maxWidth: 2000,
    maxHeight: 2000,
  });
  if (result.width < 240 || result.height < 240 || result.width * result.height < 240_000) {
    throw new Error(
      `${label} quá nhỏ (${result.width}×${result.height}px). Vui lòng chọn ảnh rõ hơn, tối thiểu 600×400px (hoặc 400×600px với ảnh dọc).`,
    );
  }
  return result.dataUrl;
}

export function parseImageList(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string' && item) : [];
  } catch {
    return [];
  }
}
