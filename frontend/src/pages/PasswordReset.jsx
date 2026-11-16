import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { Spinner } from '../components/ui';
import { clearPendingRegistration } from '../lib/pendingRegistration';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function AuthCard({ children }) {
  return <div className="mx-auto max-w-md space-y-4">{children}</div>;
}

function PasswordInput({ label, value, onChange, placeholder, autoComplete = 'new-password', autoFocus = false }) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label className="text-sm font-semibold">{label}</label>
      <div className="relative mt-1">
        <input
          className="input pr-16"
          type={visible ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          required
          autoFocus={autoFocus}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-2 text-xs font-semibold text-emerald-700 hover:underline"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        >
          {visible ? 'Ẩn' : 'Hiện'}
        </button>
      </div>
    </div>
  );
}

// Quên mật khẩu — gửi mã OTP, xác nhận mã rồi mới chuyển sang giao diện đổi mật khẩu
export function ForgotPassword() {
  const { forgotPassword, verifyResetCode, resetPassword } = useApp();
  const [step, setStep] = useState('request'); // 'request' | 'verify' | 'password' | 'done'
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const emailError = email.trim() && !EMAIL_RE.test(email.trim()) ? 'Email không hợp lệ.' : '';

  // Bước 1: Gửi mã OTP tới email
  const handleSendOtp = async (e) => {
    e?.preventDefault();
    setError('');
    setInfo('');
    setDevOtp('');
    if (!email.trim()) {
      setError('Vui lòng nhập địa chỉ email.');
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError('Email không hợp lệ.');
      return;
    }
    setBusy(true);
    try {
      const res = await forgotPassword(email);

      // Chưa cấu hình dịch vụ email trên server (thường gặp khi deploy Render free).
      if (res.mail_ready === false && !res.dev_otp) {
        setError(
          res.message ||
            'Máy chủ chưa cấu hình dịch vụ gửi email. Vui lòng liên hệ quản trị viên.',
        );
        return;
      }

      setInfo(
        res.message ||
          'Nếu email tồn tại trong hệ thống, mã xác nhận (OTP) đã được gửi. Không nhận được sau 1–2 phút? Hãy kiểm tra mục Spam hoặc bấm “Gửi lại mã”.',
      );
      if (res.dev_otp) setDevOtp(res.dev_otp);
      setOtp('');
      setPassword('');
      setConfirm('');
      setStep('verify');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Bước 2: Kiểm tra mã OTP, sau đó chuyển sang giao diện đặt mật khẩu mới
  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    setError('');
    if (!otp.trim()) {
      setError('Vui lòng nhập mã xác nhận (OTP).');
      return;
    }
    setBusy(true);
    try {
      await verifyResetCode({ email, token: otp });
      setStep('password');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Bước 3: Đặt mật khẩu mới sau khi mã đã được xác nhận
  const handleResetPassword = async (e) => {
    e?.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Mật khẩu mới tối thiểu 8 ký tự.');
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
          <form className="space-y-4" onSubmit={handleSendOtp} noValidate>
            <div>
              <h1 className="text-xl font-bold">Quên mật khẩu</h1>
              <p className="mt-1 text-sm text-slate-600">
                Nhập email của bạn. Chúng tôi sẽ gửi <b>mã xác nhận (OTP 6 số)</b> để bạn nhập trên trang web và đặt mật khẩu mới.
              </p>
            </div>
            <div>
              <label className="text-sm font-semibold">Email tài khoản</label>
              <input
                className={`input mt-1 ${emailError ? 'input-error' : ''}`}
                type="email"
                placeholder="Nhập email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                aria-invalid={!!emailError}
                required
              />
              {emailError && <p className="mt-1 text-xs text-red-600">{emailError}</p>}
            </div>
            {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            <button className="btn-primary w-full disabled:opacity-60" type="submit" disabled={busy}>
              {busy ? <><Spinner className="mr-1 h-3 w-3" /> Đang gửi mã OTP…</> : 'Gửi mã xác nhận qua email'}
            </button>
          </form>
        )}

        {step === 'verify' && (
          <form className="space-y-4" onSubmit={handleVerifyOtp}>
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

            {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

            <button className="btn-primary w-full disabled:opacity-60" type="submit" disabled={busy}>
              {busy ? <><Spinner className="mr-1 h-3 w-3" /> Đang kiểm tra mã…</> : 'Xác nhận mã'}
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
                  setError('');
                }}
              >
                Đổi email khác
              </button>
            </div>
          </form>
        )}

        {step === 'password' && (
          <form className="space-y-4" onSubmit={handleResetPassword}>
            <div>
              <h1 className="text-xl font-bold">Đặt mật khẩu mới</h1>
              <p className="mt-1 text-sm text-slate-600">
                Mã xác nhận đã đúng cho <b>{email}</b>. Hãy chọn mật khẩu mới cho tài khoản của bạn.
              </p>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
              Xác nhận mã OTP thành công. Bạn có thể đặt mật khẩu mới ngay bây giờ.
            </div>

            <PasswordInput
              label="Mật khẩu mới"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Tối thiểu 8 ký tự"
              autoFocus
            />

            <PasswordInput
              label="Xác nhận mật khẩu mới"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Nhập lại mật khẩu mới"
            />

            {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

            <button className="btn-primary w-full disabled:opacity-60" type="submit" disabled={busy}>
              {busy ? <><Spinner className="mr-1 h-3 w-3" /> Đang lưu mật khẩu…</> : 'Đặt lại mật khẩu'}
            </button>

            <div className="text-center pt-1">
              <button
                type="button"
                className="link text-xs"
                onClick={() => {
                  setStep('verify');
                  setError('');
                }}
              >
                ← Nhập lại mã xác nhận
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
  const emailError = email.trim() && !EMAIL_RE.test(email.trim()) ? 'Email không hợp lệ.' : '';

  useEffect(() => {
    if (tokenParam) setToken(tokenParam);
    if (emailParam) setEmail(emailParam);
  }, [tokenParam, emailParam]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !EMAIL_RE.test(email.trim())) {
      setError('Email không hợp lệ.');
      return;
    }
    if (!token.trim()) {
      setError('Vui lòng nhập mã xác nhận (OTP).');
      return;
    }
    if (password.length < 8) {
      setError('Mật khẩu tối thiểu 8 ký tự.');
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
          <form className="space-y-3" onSubmit={submit} noValidate>
            <p className="text-sm text-slate-600">Nhập mã xác nhận (OTP) và chọn mật khẩu mới.</p>

            <div>
              <label className="text-sm font-semibold">Email tài khoản</label>
              <input
                className={`input mt-1 ${emailError ? 'input-error' : ''}`}
                type="email"
                placeholder="Nhập email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                aria-invalid={!!emailError}
              />
              {emailError && <p className="mt-1 text-xs text-red-600">{emailError}</p>}
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

            <PasswordInput
              label="Mật khẩu mới"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Tối thiểu 8 ký tự"
            />

            <PasswordInput
              label="Nhập lại mật khẩu"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Nhập lại mật khẩu mới"
            />

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
