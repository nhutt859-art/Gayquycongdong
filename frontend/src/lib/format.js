export const statusVi = {
  draft: 'Bản nháp',
  pending_review: 'Chờ duyệt',
  active: 'Đang gây quỹ',
  successful: 'Thành công',
  failed: 'Thất bại',
  canceled: 'Đã dừng',
};

export const pledgeStatusVi = {
  pending: 'Chờ thanh toán',
  paid: 'Đã thanh toán',
  refunded: 'Đã hoàn tiền',
  failed: 'Thất bại',
};

export const transactionTypeVi = {
  payment: 'Thanh toán',
  refund: 'Hoàn tiền',
  payout: 'Giải ngân',
};

export const transactionStatusVi = {
  pending: 'Chờ duyệt',
  success: 'Thành công',
  failed: 'Thất bại',
};

export const roleVi = {
  backer: 'Nhà tài trợ',
  owner: 'Chủ dự án',
  admin: 'Quản trị viên',
};

export const kycVi = {
  none: 'Chưa xác thực',
  pending: 'Đang chờ duyệt',
  verified: 'Đã xác thực',
};

export function vnd(value) {
  const n = Number(value || 0);
  return `${n.toLocaleString('vi-VN')}đ`;
}

export function compactMoney(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)} tỷ`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)} tr`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} nghìn`;
  return n.toLocaleString('vi-VN');
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function daysLeft(endDate) {
  const end = new Date(`${String(endDate).slice(0, 10)}T23:59:59`);
  if (Number.isNaN(end.getTime())) return '';
  const diff = Math.ceil((end - new Date()) / 86_400_000);
  if (diff < 0) return 'Đã kết thúc';
  if (diff === 0) return 'Kết thúc hôm nay';
  return `Còn ${diff} ngày`;
}

export function timeAgo(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'vừa xong';
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} ngày trước`;
  return formatDate(value);
}

export function percent(project) {
  if (!project) return 0;
  if (typeof project.progress === 'number') return project.progress;
  const goal = Number(project.goal_amount || 0);
  return goal > 0 ? Math.min(100, Math.round((Number(project.current_amount || 0) / goal) * 100)) : 0;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
