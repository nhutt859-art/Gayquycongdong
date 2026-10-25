import { Link } from 'react-router-dom';

export default function Forbidden() {
  return (
    <div className="max-w-md mx-auto card p-8 text-center space-y-3">
      <div className="text-5xl">⛔</div>
      <h1 className="text-xl font-bold">403 — Không có quyền</h1>
      <p className="text-sm text-slate-600">
        Vai trò hiện tại của bạn không được phép truy cập trang này.
        Backer không vào được khu vực Owner/Admin và ngược lại.
      </p>
      <div className="flex gap-2 justify-center">
        <Link to="/" className="btn-ghost text-sm">Về trang chủ</Link>
        <Link to="/dang-nhap" className="btn-primary text-sm">Đổi tài khoản</Link>
      </div>
    </div>
  );
}
