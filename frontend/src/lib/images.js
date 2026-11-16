const IMAGE_TYPES = ['image/jpeg', 'image/png'];

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Không đọc được ảnh. Vui lòng chọn ảnh JPEG hoặc PNG khác.'));
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
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Chỉ chấp nhận ảnh JPEG hoặc PNG.');

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
 * Ảnh giấy tờ KYC: bắt buộc chụp ngang, đủ lớn và đúng tỷ lệ như backend kiểm tra.
 */
export async function readDocumentImage(file, label) {
  const result = await readImageFile(file, { maxBytes: 3.6 * 1024 * 1024, maxWidth: 1800, maxHeight: 1400 });
  if (result.width < 400 || result.height < 240) {
    throw new Error(`${label} quá nhỏ (${result.width}×${result.height}px). Vui lòng chụp rõ hơn, tối thiểu 400×240px.`);
  }
  const ratio = result.width / result.height;
  if (ratio < 1.15 || ratio > 2.6) {
    throw new Error(`${label} phải là ảnh chụp ngang của giấy tờ. Vui lòng xoay ảnh ngang và chụp lại.`);
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
