import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { Spinner } from '../components/ui';
import { kycVi, roleVi } from '../lib/format';
import {
  clearPendingRegistration,
  loadPendingRegistration,
  savePendingRegistration,
} from '../lib/pendingRegistration';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function targetAfterLogin(user, from) {
  if (user.role === 'admin') return '/admin';
  if (from && from !== '/' && !from.startsWith('/dang-nhap')) return from;
  return user.role === 'owner' ? '/du-an-cua-toi' : '/';
}

function getFieldErrors(mode, { fullName, email, password }) {
  const trimmedEmail = email.trim();
  return {
    fullName:
      mode === 'register' && fullName.trim().length < 2
        ? 'Họ tên tối thiểu 2 ký tự.'
        : '',
    email: !trimmedEmail
      ? 'Vui lòng nhập email.'
      : !EMAIL_RE.test(trimmedEmail)
        ? 'Email không hợp lệ.'
        : '',
    password: !password
      ? 'Vui lòng nhập mật khẩu.'
      : mode === 'register' && password.length < 6
        ? 'Mật khẩu tối thiểu 6 ký tự.'
        : '',
  };
}

// UC01 đăng ký + UC02 đăng nhập/đăng xuất
export function Auth() {
  const { login, register, currentUser, logout, toast, resendVerification } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const from = loc.state?.from;
  const [mode, setMode] = useState('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState({ fullName: false, email: false, password: false });
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(() => loadPendingRegistration());
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMsg, setResendMsg] = useState('');
  const [resendDevUrl, setResendDevUrl] = useState('');

  const errors = getFieldErrors(mode, { fullName, email, password });
  const formValid = !errors.fullName && !errors.email && !errors.password;
  const showError = (field) => (submitted || touched[field]) && errors[field];
  const touch = (field) => setTouched((state) => (state[field] ? state : { ...state, [field]: true }));

  const resend = async (targetEmail) => {
    setResendBusy(true);
    setResendMsg('');
    setResendDevUrl('');
    try {
      const data = await resendVerification(targetEmail);
      setResendMsg(data.message);
      if (data.dev_verification_url) {
        setResendDevUrl(data.dev_verification_url);
        if (pending) {
          const next = { ...pending, dev_verification_url: data.dev_verification_url };
          setPending(next);
          savePendingRegistration(next);
        }
      }
    } catch (err) {
      setResendMsg(err.message);
    } finally {
      setResendBusy(false);
    }
  };

  const submit = async (e) => {
    e?.preventDefault();
    setSubmitted(true);
    setError('');
    setUnverifiedEmail('');
    if (!formValid) return;
    setBusy(true);
    try {
      if (mode === 'login') {
        const user = await login(email, password);
        clearPendingRegistration();
        setPending(null);
        toast(`Chào mừng ${user.full_name}!`, 'success');
        nav(targetAfterLogin(user, from), { replace: true });
      } else {
        const result = await register({ full_name: fullName, email, password });
        setPending(savePendingRegistration(result));
        setPassword('');
        setSubmitted(false);
        setTouched({ fullName: false, email: false, password: false });
        setResendMsg('');
        setResendDevUrl('');
      }
    } catch (err) {
      setError(err.message);
      if (err.status === 403 && err.details?.code === 'EMAIL_NOT_VERIFIED') {
        setUnverifiedEmail(err.details.email || email);
      }
    } finally {
      setBusy(false);
    }
  };

  if (currentUser) {
    return (
      <div className="mx-auto max-w-md space-y-3">
        <div className="card p-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-xl font-bold text-emerald-700">
            {currentUser.full_name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <h1 className="mt-3 text-xl font-bold">Xin chào, {currentUser.full_name}</h1>
          <p className="text-sm text-slate-600">{currentUser.email}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            <span className="badge bg-slate-100">{roleVi[currentUser.role] || currentUser.role}</span>
            <span className={`badge ${currentUser.kyc_status === 'verified' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {kycVi[currentUser.kyc_status]}
            </span>
          </div>
          <div className="mt-4 grid gap-2">
            {currentUser.role === 'admin' ? (
              <Link to="/admin" className="btn-primary text-sm">Vào trang quản trị</Link>
            ) : (
              <>
                <Link to="/du-an-cua-toi" className="btn-primary text-sm">Dự án của tôi</Link>
                <Link to="/tao-du-an" className="btn-ghost text-sm">Tạo dự án mới</Link>
              </>
            )}
            <Link to="/ca-nhan" className="btn-ghost text-sm">Hồ sơ cá nhân</Link>
          </div>
          <button className="link mt-3 text-sm" onClick={async () => { await logout(); nav('/'); }}>
            Đăng xuất
          </button>
        </div>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <div className="card space-y-3 p-6">
          <div className="text-3xl">📬</div>
          <h1 className="text-xl font-bold">Kiểm tra email để kích hoạt</h1>
          <p className="text-sm text-slate-600">
            Tài khoản <b>{pending.user?.email}</b> đã được lưu trong cơ sở dữ liệu. Bấm liên kết xác thực trong email để kích hoạt, sau đó đăng nhập.
          </p>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            Bạn có thể tải lại trang — thông tin đăng ký vẫn được giữ lại.
          </div>
          {pending.delivery === 'console' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <b>Chế độ dev:</b> backend chưa cấu hình SMTP nên liên kết xác thực được in ở console backend.
            </div>
          )}
          {pending.delivery === 'smtp' && pending.verification_sent === false && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              Không gửi được email xác thực. Kiểm tra cấu hình SMTP trong <code>backend/.env</code> rồi bấm gửi lại.
            </div>
          )}
          {pending.dev_verification_url && (
            <a href={pending.dev_verification_url} className="btn-primary block text-center text-sm">
              Xác thực email ngay
            </a>
          )}
          <button
            type="button"
            className="btn-ghost w-full text-sm disabled:opacity-60"
            onClick={() => resend(pending.user.email)}
            disabled={resendBusy}
          >
            {resendBusy ? <><Spinner className="mr-1 h-3 w-3" /> Đang gửi…</> : 'Gửi lại email xác thực'}
          </button>
          {resendMsg && <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{resendMsg}</div>}
          {resendDevUrl && (
            <a href={resendDevUrl} className="link block text-center text-xs">Mở liên kết xác thực mới →</a>
          )}
          <button
            type="button"
            className="btn-ghost w-full text-sm"
            onClick={() => {
              clearPendingRegistration();
              setPending(null);
              setMode('login');
              setPassword('');
              setError('');
            }}
          >
            Đã xác thực? Đăng nhập
          </button>
        </div>
        <p className="text-center text-xs text-slate-500">
          Không nhận được email? Kiểm tra mục Spam hoặc bấm gửi lại ở trên.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <form className="card space-y-4 p-6" onSubmit={submit} noValidate>
        <div>
          <h1 className="text-xl font-bold">{mode === 'login' ? 'Đăng nhập' : 'Đăng ký tài khoản'}</h1>
          <p className="mt-1 text-xs text-slate-500">
            {mode === 'login'
              ? 'Dùng email và mật khẩu đã đăng ký.'
              : 'Tạo tài khoản mới, sau đó xác thực qua email.'}
          </p>
        </div>

        {mode === 'register' && (
          <div>
            <label className="text-sm font-semibold" htmlFor="full-name">Họ và tên</label>
            <input
              id="full-name"
              className={`input mt-1 ${showError('fullName') ? 'input-error' : ''}`}
              placeholder="Nguyễn Văn A"
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                touch('fullName');
              }}
              onBlur={() => touch('fullName')}
              autoComplete="name"
              aria-invalid={!!showError('fullName')}
            />
            {showError('fullName') && <p className="mt-1 text-xs text-red-600">{errors.fullName}</p>}
          </div>
        )}

        <div>
          <label className="text-sm font-semibold" htmlFor="email">Email</label>
          <input
            id="email"
            className={`input mt-1 ${showError('email') ? 'input-error' : ''}`}
            type="email"
            inputMode="email"
            placeholder="ban@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              touch('email');
            }}
            onBlur={() => touch('email')}
            autoComplete="email"
            aria-invalid={!!showError('email')}
          />
          {showError('email') && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold" htmlFor="password">Mật khẩu</label>
            {mode === 'login' && (
              <Link to="/quen-mat-khau" className="link text-xs">Quên mật khẩu?</Link>
            )}
          </div>
          <input
            id="password"
            className={`input mt-1 ${showError('password') ? 'input-error' : ''}`}
            type="password"
            placeholder={mode === 'register' ? 'Tối thiểu 6 ký tự' : 'Nhập mật khẩu'}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              touch('password');
            }}
            onBlur={() => touch('password')}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            aria-invalid={!!showError('password')}
          />
          {showError('password') && <p className="mt-1 text-xs text-red-600">{errors.password}</p>}
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {unverifiedEmail && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <p>Chưa nhận được email? Kiểm tra Spam hoặc gửi lại liên kết xác thực.</p>
            <button
              type="button"
              className="btn-ghost mt-2 w-full text-xs disabled:opacity-60"
              onClick={() => resend(unverifiedEmail)}
              disabled={resendBusy}
            >
              {resendBusy ? <><Spinner className="mr-1 h-3 w-3" /> Đang gửi…</> : 'Gửi lại email xác thực'}
            </button>
            {resendMsg && <p className="mt-2 text-slate-600">{resendMsg}</p>}
            {resendDevUrl && <a href={resendDevUrl} className="link mt-1 inline-block">Mở liên kết xác thực →</a>}
          </div>
        )}

        <button
          className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
          type="submit"
          disabled={busy || !formValid}
        >
          {busy ? <><Spinner className="mr-1 h-3 w-3" /> Đang xử lý…</> : mode === 'login' ? 'Đăng nhập' : 'Đăng ký'}
        </button>
        {!formValid && (submitted || touched.fullName || touched.email || touched.password) && (
          <p className="text-center text-xs text-slate-500">Vui lòng sửa các ô báo đỏ để tiếp tục.</p>
        )}

        <button
          type="button"
          className="link text-sm"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setFullName('');
            setPassword('');
            setError('');
            setUnverifiedEmail('');
            setResendMsg('');
            setResendDevUrl('');
            setTouched({ fullName: false, email: false, password: false });
            setSubmitted(false);
          }}
        >
          {mode === 'login' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
        </button>
      </form>
    </div>
  );
}

// UC03 chọn chủ đề quan tâm để AI gợi ý
export function Onboarding() {
  const nav = useNavigate();
  const loc = useLocation();
  const { categories, interests, saveInterests, toast } = useApp();
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSelected(interests.map((i) => i.category_id));
    // Chỉ đồng bộ lần đầu / khi interests từ server thay đổi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interests.length]);

  const toggle = (id) => {
    setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await saveInterests(selected);
      toast(`Đã lưu ${selected.length} chủ đề quan tâm. AI sẽ gợi ý dự án phù hợp.`, 'success');
      nav(loc.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="card space-y-4 p-6">
        <div>
          <h1 className="text-xl font-bold">Chọn chủ đề bạn quan tâm</h1>
          <p className="mt-1 text-sm text-slate-600">
            AI dùng lựa chọn này (kết hợp lịch sử tài trợ) để gợi ý dự án phù hợp. Có thể đổi lại ở trang Cá nhân.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className={`badge border px-3 py-2 transition ${selected.includes(c.id) ? 'border-emerald-600 bg-emerald-600 text-white' : 'bg-white hover:border-emerald-400'}`}
            >
              {c.name}
              <span className={`ml-1 ${selected.includes(c.id) ? 'text-emerald-100' : 'text-slate-400'}`}>
                {c.active_project_count ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
          Đã chọn <b>{selected.length}</b> chủ đề. Bạn có thể bỏ qua và cập nhật sau.
        </div>
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <button className="btn-primary w-full disabled:opacity-60" onClick={save} disabled={busy}>
          {busy ? <><Spinner className="mr-1 h-3 w-3" /> Đang lưu…</> : 'Hoàn tất'}
        </button>
        <Link to={loc.state?.from || '/'} className="link block text-center text-sm">Bỏ qua</Link>
      </div>
    </div>
  );
}
