import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

const MAX_UPDATE_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 3.6 * 1024 * 1024;

function base64Bytes(base64) {
  return Math.floor((base64.length * 3) / 4);
}

async function ensurePermission(kind) {
  const permission =
    kind === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      kind === 'camera'
        ? 'Cần quyền truy cập máy ảnh để chụp giấy tờ. Hãy cấp quyền trong cài đặt ứng dụng.'
        : 'Cần quyền truy cập thư viện ảnh để chọn ảnh. Hãy cấp quyền trong cài đặt ứng dụng.',
    );
  }
}

async function toJpegWithinBytes(
  asset,
  { maxBytes, maxWidth = 1800, maxHeight = 1400, compresses = [0.82, 0.7, 0.58, 0.45] } = {},
) {
  const sourceWidth = Number(asset.width) || maxWidth;
  const sourceHeight = Number(asset.height) || maxHeight;

  for (let attempt = 0; attempt < compresses.length; attempt += 1) {
    const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight) * (1 - attempt * 0.12);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const result = await manipulateAsync(
      asset.uri,
      [{ resize: { width, height } }],
      { compress: compresses[attempt], format: SaveFormat.JPEG, base64: true },
    );
    if (!result.base64) throw new Error('Không đọc được ảnh đã chọn. Vui lòng chọn ảnh khác.');
    const bytes = base64Bytes(result.base64);
    if (bytes <= maxBytes) {
      return {
        dataUrl: `data:image/jpeg;base64,${result.base64}`,
        width: result.width,
        height: result.height,
        bytes,
      };
    }
  }

  throw new Error(`Ảnh quá lớn. Vui lòng chọn ảnh nhỏ hơn ${Math.round(maxBytes / 1024 / 1024)}MB.`);
}

async function launch(kind, options) {
  await ensurePermission(kind);
  const result =
    kind === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return [];
  return result.assets;
}

function askImageSource(title, onCamera, onLibrary, onCancel) {
  if (Platform.OS === 'web') {
    onLibrary();
    return;
  }
  Alert.alert(
    title,
    'Chọn nguồn ảnh',
    [
      { text: 'Chụp ảnh', onPress: onCamera },
      { text: 'Chọn từ thư viện', onPress: onLibrary },
      { text: 'Hủy', style: 'cancel', onPress: onCancel },
    ],
    { cancelable: true, onDismiss: onCancel },
  );
}

/**
 * Ảnh giấy tờ KYC: ưu tiên chụp ngang, đủ lớn và đúng tỷ lệ như backend kiểm tra.
 * Trả về data URL JPEG hoặc null nếu người dùng hủy.
 */
export function pickDocumentImage(label) {
  return new Promise((resolve, reject) => {
    const run = async (kind) => {
      try {
        const assets = await launch(kind, {
          mediaTypes: ['images'],
          allowsEditing: false,
          exif: false,
          quality: 1,
        });
        if (!assets.length) {
          resolve(null);
          return;
        }
        const asset = assets[0];
        const image = await toJpegWithinBytes(asset, {
          maxBytes: MAX_DOCUMENT_BYTES,
          maxWidth: 1800,
          maxHeight: 1400,
        });
        if (image.width < 400 || image.height < 240) {
          throw new Error(
            `${label} quá nhỏ (${image.width}×${image.height}px). Vui lòng chụp rõ hơn, tối thiểu 400×240px.`,
          );
        }
        const ratio = image.width / image.height;
        if (ratio < 1.15 || ratio > 2.6) {
          throw new Error(`${label} phải là ảnh chụp ngang của giấy tờ. Vui lòng xoay ngang và chụp lại.`);
        }
        resolve(image.dataUrl);
      } catch (err) {
        reject(err);
      }
    };

    askImageSource(
      label,
      () => run('camera'),
      () => run('library'),
      () => resolve(null),
    );
  });
}

/** Chọn tối đa `remaining` ảnh bản tin, trả về danh sách data URL JPEG ≤ 2MB. */
export async function pickContentImages(remaining = 6) {
  const assets = await launch('library', {
    mediaTypes: ['images'],
    allowsMultipleSelection: remaining > 1,
    selectionLimit: remaining,
    allowsEditing: false,
    exif: false,
    quality: 1,
  });

  const images = [];
  for (const asset of assets.slice(0, remaining)) {
    const image = await toJpegWithinBytes(asset, {
      maxBytes: MAX_UPDATE_BYTES,
      maxWidth: 1600,
      maxHeight: 1600,
    });
    images.push(image.dataUrl);
  }
  return images;
}
