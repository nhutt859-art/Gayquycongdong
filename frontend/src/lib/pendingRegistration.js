const PENDING_KEY = 'gq_pending_registration';
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

function normalize(data) {
  const email = data?.email || data?.user?.email || '';
  if (!email) return null;
  return {
    user: {
      email,
      full_name: data?.full_name || data?.user?.full_name || '',
    },
    delivery: data?.delivery || '',
    verification_sent: data?.verification_sent,
    dev_verification_url: data?.dev_verification_url || '',
  };
}

/** Khôi phục trạng thái "chờ xác thực email" sau khi tải lại trang. */
export function loadPendingRegistration() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const savedAt = Number(saved?.saved_at) || 0;
    if (!savedAt || Date.now() - savedAt > PENDING_TTL_MS) {
      localStorage.removeItem(PENDING_KEY);
      return null;
    }
    return normalize(saved);
  } catch {
    return null;
  }
}

/** Lưu tối thiểu thông tin cần thiết; mật khẩu không bao giờ được lưu ở client. */
export function savePendingRegistration(data) {
  const pending = normalize(data);
  if (!pending) return null;
  try {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({
        email: pending.user.email,
        full_name: pending.user.full_name,
        delivery: pending.delivery,
        verification_sent: pending.verification_sent,
        dev_verification_url: pending.dev_verification_url,
        saved_at: Date.now(),
      }),
    );
  } catch {
    // localStorage có thể bị chặn ở chế độ riêng tư; tài khoản vẫn đã lưu trong DB.
  }
  return pending;
}

export function clearPendingRegistration() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // bỏ qua
  }
}
