import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { Spinner } from '../components/ui';
import { clearPendingRegistration } from '../lib/pendingRegistration';

function AuthCard({ children }) {
  return <div className="mx-auto max-w-md space-y-4">{children}</div>;
}

// Quên mật khẩu — hỗ trợ nhận mã OTP qua email và nhập trực tiếp trên web
export function ForgotPassword() {
  const { forgotPassword, resetPassword } = useApp();
  const [step, setStep] = useState('request'); // 'request' | 'verify' | 'done'
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [devOtp, setDevOtp] = useState('');

  // Bước 1: Gửi mã OTP tới email
  const handleSendOtp = async (e) => {
    e?.preventDefault();
    setError('');
    setInfo('');
    if (!email.trim()) {
      setError('Vui lòng nhập địa chỉ email.');
      return;
    }
    setBusy(true);
    try {
      const res = await forgotPassword(email);
      setInfo(res.message || 'Mã xác nhận (OTP) đã được gửi đến email của bạn.');
      if (res.dev_otp) setDevOtp(res.dev_otp);
      setStep('verify');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Bước 2: Nhập mã OTP và mật khẩu mới
  const handleResetWithOtp = async (e) => {
    e?.preventDefault();
    setError('');
    if (!otp.trim()) {
      setError('Vui lòng nhập mã xác nhận (OTP).');
      return;
    }
    if (password.length < 6) {
      setError('Mật khẩu mới tối thiểu 6 ký tự.');
      return;
    }
    if (password !== confirm) {
      setError('Mật khẩu nhập lại không khớp.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword({ email, token: otp, password });
      setStep('done');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard>
      <div className="card space-y-4 p-6">
        {step === 'request' && (
          <form className="space-y-4" onSubmit={handleSendOtp}>
            <div>
              <h1 className="text-xl font-bold">Quên mật khẩu</h1>
              <p className="mt-1 text-sm text-slate-600">
                Nhập email của bạn. Chúng tôi sẽ gửi <b>mã xác nhận (OTP 6 số)</b> để bạn nhập trên trang web và đặt mật khẩu mới.
              </p>
            </div>
            <div>
              <label className="text-sm font-semibold">Email tài khoản</label>
              <input
                className="input mt-1"
                type="email"
                placeholder="ban@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            <button className="btn-primary w-full disabled:opacity-60" type="submit" disabled={busy}>
              {busy ? <><Spinner className="mr-1 h-3 w-3" /> Đang gửi mã OTP…</> : 'Gửi mã xác nhận qua email'}
            </button>
          </form>
        )}

        {step === 'verify' && (
          <form className="space-y-4" onSubmit={handleResetWithOtp}>
            <div>
              <h1 className="text-xl font-bold">Nhập mã xác nhận (OTP)</h1>
              <p className="mt-1 text-sm text-slate-600">
                Mã OTP 6 số đã được gửi tới <b>{email}</b>. Hãy kiểm tra hộp thư (cả mục Spam) và nhập vào ô bên dưới.
              </p>
            </div>

            {info && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                {info}
              </div>
            )}

            {devOtp && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <b>Chế độ dev:</b> Mã OTP của bạn là: <code className="font-bold text-amber-900">{devOtp}</code>
              </div>
            )}

            <div>
              <label className="text-sm font-semibold">Mã xác nhận (OTP)</label>
              <input
                className="input mt-1 text-center font-mono text-lg font-bold tracking-widest"
                type="text"
                placeholder="6 chữ số (ví dụ: 123456)"
                value={otp}
                onChange={(e) => setOtp(e.target.value.trim())}
                maxLength={10}
                required
                autoFocus
              />
            </div>

            <div>
              <label className="text-sm font-semibold">Mật khẩu mới</label>
              <input
                className="input mt-1"
                type="password"
                placeholder="Tối thiểu 6 ký tự"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            <div>
              <label className="text-sm font-semibold">Xác nhận mật khẩu mới</label>
              <input
                className="input mt-1"
                type="password"
                placeholder="Nhập lại mật khẩu mới"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

            <button className="btn-primary w-full disabled:opacity-60" type="submit" disabled={busy}>
              {busy ? <><Spinner className="mr-1 h-3 w-3" /> Đang lưu mật khẩu…</> : 'Xác nhận & Đặt lại mật khẩu'}
            </button>

            <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
              <button
                type="button"
                className="link"
                onClick={handleSendOtp}
                disabled={busy}
              >
                Chưa nhận được? Gửi lại mã
              </button>
              <button
                type="button"
                className="link"
                onClick={() => {
                  setStep('request');
                  setOtp('');
                  setPassword('');
                  setConfirm('');
                  setError('');
                }}
              >
                Đổi email khác
              </button>
            </div>
          </form>
        )}

        {step === 'done' && (
          <div className="space-y-3 text-center">
            <div className="text-4xl">🎉</div>
            <h1 className="text-xl font-bold">Đặt lại mật khẩu thành công!</h1>
            <p className="text-sm text-slate-600">
              Mật khẩu của tài khoản <b>{email}</b> đã được cập nhật. Bạn có thể đăng nhập ngay với mật khẩu mới.
            </p>
            <Link to="/dang-nhap" className="btn-primary block text-center text-sm">
              Đăng nhập ngay
            </Link>
          </div>
        )}

        {step !== 'done' && (
          <Link to="/dang-nhap" className="link block text-center text-sm">
            ← Quay lại đăng nhập
          </Link>
        )}
      </div>
    </AuthCard>
  );
}

// Đặt lại mật khẩu — hỗ trợ mở từ link email hoặc nhập mã trực tiếp
export function ResetPassword() {
  const { resetPassword } = useApp();
  const [params] = useSearchParams();
  const tokenParam = params.get('token') || '';
  const emailParam = params.get('email') || '';

  const [email, setEmail] = useState(emailParam);
  const [token, setToken] = useState(tokenParam);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (tokenParam) setToken(tokenParam);
    if (emailParam) setEmail(emailParam);
  }, [tokenParam, emailParam]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!token.trim()) {
      setError('Vui lòng nhập mã xác nhận (OTP).');
      return;
    }
    if (password.length < 6) {
      setError('Mật khẩu tối thiểu 6 ký tự.');
      return;
    }
    if (password !== confirm) {
      setError('Mật khẩu nhập lại không khớp.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword({ email, token, password });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard>
      <div className="card space-y-4 p-6">
        <h1 className="text-xl font-bold">Đặt lại mật khẩu</h1>
        {done ? (
          <div className="space-y-3 text-center">
            <div className="text-4xl">🎉</div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              Đặt lại mật khẩu thành công. Các phiên đăng nhập cũ đã được đăng xuất an toàn.
            </div>
            <Link to="/dang-nhap" className="btn-primary block text-center text-sm">
              Đăng nhập bằng mật khẩu mới
            </Link>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={submit}>
            <p className="text-sm text-slate-600">Nhập mã xác nhận (OTP) và chọn mật khẩu mới.</p>

            <div>
              <label className="text-sm font-semibold">Email tài khoản</label>
              <input
                className="input mt-1"
                type="email"
                placeholder="ban@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div>
              <label className="text-sm font-semibold">Mã xác nhận (OTP)</label>
              <input
                className="input mt-1 text-center font-mono text-lg font-bold tracking-widest"
                type="text"
                placeholder="6 chữ số (ví dụ: 123456)"
                value={token}
                onChange={(e) => setToken(e.target.value.trim())}
                required
              />
            </div>

            <div>
              <label className="text-sm font-semibold">Mật khẩu mới</label>
              <input
                className="input mt-1"
                type="password"
                placeholder="Tối thiểu 6 ký tự"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            <div>
              <label className="text-sm font-semibold">Nhập lại mật khẩu</label>
              <input
                className="input mt-1"
                type="password"
                placeholder="Nhập lại mật khẩu mới"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

            <button className="btn-primary w-full disabled:opacity-60" type="submit" disabled={busy}>
              {busy ? <><Spinner className="mr-1 h-3 w-3" /> Đang lưu…</> : 'Đặt lại mật khẩu'}
            </button>

            <div className="text-center pt-1">
              <Link to="/quen-mat-khau" className="link text-xs">
                Chưa có mã xác nhận? Yêu cầu gửi mã OTP
              </Link>
            </div>
          </form>
        )}
        <Link to="/dang-nhap" className="link block text-center text-sm">
          ← Về trang đăng nhập
        </Link>
      </div>
    </AuthCard>
  );
}

// Xác thực email bằng token trong email
export function VerifyEmail() {
  const { verifyEmail } = useApp();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState({ status: 'loading', message: '', user: null });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      setState({ status: 'error', message: 'Thiếu mã xác thực trong liên kết.', user: null });
      return;
    }
    verifyEmail(token)
      .then((data) => {
        clearPendingRegistration();
        setState({ status: 'success', message: data.message, user: data.user });
      })
      .catch((err) => setState({ status: 'error', message: err.message, user: null }));
  }, [token, verifyEmail]);

  return (
    <AuthCard>
      <div className="card space-y-3 p-6">
        {state.status === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Spinner className="h-4 w-4" /> Đang xác thực email…
          </div>
        )}
        {state.status === 'success' && (
          <>
            <div className="text-3xl">✅</div>
            <h1 className="text-xl font-bold">Email đã được xác thực</h1>
            <p className="text-sm text-slate-600">
              {state.user?.email ? <>Tài khoản <b>{state.user.email}</b> đã kích hoạt. </> : null}
              {state.message}
            </p>
            <Link to="/dang-nhap" className="btn-primary block text-center text-sm">Đăng nhập ngay</Link>
          </>
        )}
        {state.status === 'error' && (
          <>
            <div className="text-3xl">⚠️</div>
            <h1 className="text-xl font-bold">Không xác thực được</h1>
            <p className="text-sm text-slate-600">{state.message}</p>
            <Link to="/dang-nhap" className="btn-primary block text-center text-sm">Về trang đăng nhập</Link>
            <Link to="/quen-mat-khau" className="link block text-center text-sm">Cần đặt lại mật khẩu?</Link>
          </>
        )}
      </div>
    </AuthCard>
  );
}
