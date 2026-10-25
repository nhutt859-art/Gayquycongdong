import { Navigate, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { Loading } from './ui';

// Chặn route theo vai trò + KYC. Dùng cho App.jsx.
export function RequireRole({ allow = [], needKyc = false, children }) {
  const { role, currentUser, booting } = useApp();
  const loc = useLocation();

  if (booting) return <Loading text="Đang khôi phục phiên đăng nhập…" />;
  if (!currentUser) return <Navigate to="/dang-nhap" state={{ from: loc.pathname + loc.search }} replace />;
  if (allow.length > 0 && !allow.includes(role)) return <Navigate to="/403" replace />;
  if (needKyc && currentUser.kyc_status !== 'verified') {
    return <Navigate to="/ca-nhan" state={{ needKyc: true, from: loc.pathname }} replace />;
  }
  return children;
}

export function RequireAdmin({ children }) {
  return <RequireRole allow={['admin']}>{children}</RequireRole>;
}
