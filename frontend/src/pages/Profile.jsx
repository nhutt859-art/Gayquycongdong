import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import { EmptyState, ErrorState, Loading, PageHeader, Spinner, StatCard } from '../components/ui';
import {
  formatDate,
  kycVi,
  pledgeStatusVi,
  roleVi,
  transactionStatusVi,
  transactionTypeVi,
  vnd,
} from '../lib/format';

export default function Profile() {
  const {
    currentUser,
    stats,
    interests,
    refreshSession,
    refreshNotifications,
    updateCurrentUser,
    toast,
    logout,
    resendVerification,
  } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const needKyc = loc.state?.needKyc;
  const [tab, setTab] = useState('contributions');
  const [pledges, setPledges] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [kycBusy, setKycBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState('');
  const [emailDevUrl, setEmailDevUrl] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [form, setForm] = useState({ full_name: '', phone: '', avatar_url: '' });

  useEffect(() => {
    if (!currentUser) return;
    setForm({
      full_name: currentUser.full_name || '',
      phone: currentUser.phone || '',
      avatar_url: currentUser.avatar_url || '',
    });
  }, [currentUser]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [pledgeData, txData] = await Promise.all([api.get('/me/pledges'), api.get('/me/transactions')]);
      setPledges(pledgeData?.items || []);
      setTransactions(txData?.items || []);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const startKyc = async () => {
    setKycBusy(true);
    try {
      await api.post('/me/kyc');
      await Promise.all([refreshSession(), refreshNotifications()]);
      toast('Xác thực danh tính thành công. Bạn đã có thể tạo dự án.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setKycBusy(false);
    }
  };

  const resendEmailVerification = async () => {
    setEmailBusy(true);
    setEmailMsg('');
    setEmailDevUrl('');
    try {
      const data = await resendVerification(currentUser.email);
      setEmailMsg(data.message);
      if (data.dev_verification_url) setEmailDevUrl(data.dev_verification_url);
    } catch (err) {
      setEmailMsg(err.message);
    } finally {
      setEmailBusy(false);
    }
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    setProfileError('');
    if (form.full_name.trim().length < 2) {
      setProfileError('Họ tên tối thiểu 2 ký tự.');
      return;
    }
    setProfileBusy(true);
    try {
      const data = await api.patch('/me', {
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        avatar_url: form.avatar_url.trim() || null,
      });
      updateCurrentUser(data.user);
      toast('Đã cập nhật hồ sơ.', 'success');
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setProfileBusy(false);
    }
  };

  if (!currentUser) return null;

  const verified = currentUser.kyc_status === 'verified';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Hồ sơ cá nhân"
        subtitle="Quản lý thông tin, xác thực danh tính và lịch sử giao dịch"
        action={
          currentUser.role !== 'admin' ? (
            <Link to="/tao-du-an" className="btn-primary text-sm">+ Tạo dự án</Link>
          ) : (
            <Link to="/admin" className="btn-primary text-sm">Trang quản trị</Link>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Tổng đã tài trợ" value={vnd(stats.total_pledged)} tone="emerald" />
        <StatCard label="Dự án sở hữu" value={stats.owned_projects} hint="Vai trò chủ dự án" />
        <StatCard label="Dự án cộng tác" value={stats.collaborating_projects} />
        <StatCard label="Thông báo chưa đọc" value={stats.unread_notifications} tone={stats.unread_notifications ? 'amber' : 'default'} />
      </div>

      {needKyc && !verified && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          ⛔ Bạn cần xác thực danh tính (KYC) trước khi tạo dự án. Hãy bấm “Xác thực danh tính” bên dưới.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-4">
          <div className="card p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-lg font-bold text-emerald-700">
                {currentUser.full_name?.charAt(0)?.toUpperCase() || '?'}
              </span>
              <div className="min-w-0">
                <div className="truncate font-bold">{currentUser.full_name}</div>
                <div className="truncate text-xs text-slate-500">{currentUser.email}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="badge bg-slate-100">{roleVi[currentUser.role] || currentUser.role}</span>
              <span className={`badge ${verified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {kycVi[currentUser.kyc_status]}
              </span>
              <span className={`badge ${currentUser.email_verified ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {currentUser.email_verified ? 'Email đã xác thực' : 'Email chưa xác thực'}
              </span>
              <span className="badge bg-slate-100">Tin cậy {Math.round(Number(currentUser.trust_score))}/100</span>
            </div>
            <div className="mt-3 text-xs text-slate-500">Thành viên từ {formatDate(currentUser.created_at)}</div>

            <div className="mt-4 border-t pt-3">
              <div className="text-sm font-semibold">Xác thực danh tính</div>
              <p className="mt-1 text-xs text-slate-500">
                {verified
                  ? 'Tài khoản đã xác thực, đủ điều kiện tạo dự án gây quỹ.'
                  : 'Xác thực KYC là bắt buộc trước khi tạo dự án. Bản demo duyệt tự động ngay lập tức.'}
              </p>
              {!verified && (
                <button className="btn-primary mt-2 w-full text-sm disabled:opacity-60" onClick={startKyc} disabled={kycBusy}>
                  {kycBusy ? <><Spinner className="mr-1 h-3 w-3" /> Đang xác thực…</> : 'Xác thực danh tính ngay'}
                </button>
              )}
              {verified && currentUser.role !== 'admin' && (
                <Link to="/tao-du-an" className="btn-ghost mt-2 block w-full text-center text-sm">Tạo dự án</Link>
              )}
            </div>

            <div className="mt-4 border-t pt-3">
              <div className="text-sm font-semibold">Email</div>
              <p className="mt-1 break-all text-xs text-slate-500">{currentUser.email}</p>
              {currentUser.email_verified ? (
                <p className="mt-1 text-xs text-emerald-700">Đã xác thực email.</p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-amber-700">Chưa xác thực — hãy xác thực để bảo vệ tài khoản.</p>
                  <button
                    className="btn-ghost mt-2 w-full text-xs disabled:opacity-60"
                    onClick={resendEmailVerification}
                    disabled={emailBusy}
                  >
                    {emailBusy ? <><Spinner className="mr-1 h-3 w-3" /> Đang gửi…</> : 'Gửi lại email xác thực'}
                  </button>
                  {emailMsg && <p className="mt-2 text-xs text-slate-600">{emailMsg}</p>}
                  {emailDevUrl && (
                    <a href={emailDevUrl} className="link mt-1 inline-block text-xs">Mở liên kết xác thực →</a>
                  )}
                </>
              )}
              <Link to="/quen-mat-khau" className="link mt-2 inline-block text-xs">Đổi mật khẩu bằng email →</Link>
            </div>

            <div className="mt-4 border-t pt-3">
              <div className="text-sm font-semibold">Chủ đề quan tâm</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {interests.map((i) => (
                  <span key={i.category_id} className="badge bg-emerald-50 text-emerald-700">{i.name}</span>
                ))}
                {interests.length === 0 && <span className="text-xs text-slate-500">Chưa chọn chủ đề.</span>}
              </div>
              <Link to="/chon-so-thich" className="link mt-2 inline-block text-xs">Cập nhật chủ đề →</Link>
            </div>

            <button
              className="link mt-4 text-sm"
              onClick={async () => {
                await logout();
                nav('/');
              }}
            >
              Đăng xuất
            </button>
          </div>

          <form className="card space-y-3 p-5" onSubmit={saveProfile}>
            <h2 className="font-bold">Chỉnh sửa hồ sơ</h2>
            <div>
              <label className="text-xs font-semibold">Họ và tên</label>
              <input className="input mt-1" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-semibold">Số điện thoại</label>
              <input className="input mt-1" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="09xx…" />
            </div>
            <div>
              <label className="text-xs font-semibold">Ảnh đại diện (URL)</label>
              <input className="input mt-1" value={form.avatar_url} onChange={(e) => setForm({ ...form, avatar_url: e.target.value })} placeholder="https://…" />
            </div>
            {profileError && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{profileError}</div>}
            <button className="btn-primary w-full text-sm disabled:opacity-60" type="submit" disabled={profileBusy}>
              {profileBusy ? <><Spinner className="mr-1 h-3 w-3" /> Đang lưu…</> : 'Lưu hồ sơ'}
            </button>
          </form>
        </div>

        <div className="space-y-3 md:col-span-2">
          <div className="flex flex-wrap gap-2">
            {[
              ['contributions', `Lịch sử đóng góp (${pledges.length})`],
              ['transactions', `Giao dịch (${transactions.length})`],
            ].map(([key, label]) => (
              <button
                key={key}
                className={`rounded-xl px-3 py-1.5 text-sm font-medium ${tab === key ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {loading && <Loading text="Đang tải lịch sử…" />}
          {!loading && loadError && <ErrorState message={loadError} onRetry={loadHistory} />}

          {!loading && !loadError && tab === 'contributions' && (
            <div className="card p-5">
              <h2 className="font-bold">Lịch sử đóng góp</h2>
              {pledges.length === 0 && (
                <EmptyState
                  icon="💝"
                  title="Chưa có đóng góp nào"
                  action={<Link to="/kham-pha" className="btn-primary text-sm">Khám phá dự án</Link>}
                >
                  Hãy ủng hộ một dự án bạn yêu thích.
                </EmptyState>
              )}
              <div className="mt-2 divide-y">
                {pledges.map((p) => (
                  <div key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                    <div className="min-w-0">
                      <Link to={`/du-an/${p.project_id}`} className="font-semibold link">
                        {p.cover_emoji} {p.project_title}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {formatDate(p.created_at)} · {p.reward_title || 'Tài trợ tự do'} · {p.method || '—'}
                      </div>
                      {p.transaction_status && (
                        <div className="text-[11px] text-slate-400">
                          Giao dịch: {transactionStatusVi[p.transaction_status] || p.transaction_status}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <b>{vnd(p.amount)}</b>
                      <div>
                        <span
                          className={`badge ${
                            p.status === 'paid'
                              ? 'bg-emerald-100 text-emerald-700'
                              : p.status === 'refunded'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {pledgeStatusVi[p.status] || p.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && !loadError && tab === 'transactions' && (
            <div className="card p-5">
              <h2 className="font-bold">Giao dịch chi tiết</h2>
              {transactions.length === 0 && <p className="mt-2 text-sm text-slate-500">Chưa có giao dịch nào.</p>}
              <div className="mt-2 divide-y">
                {transactions.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                    <div className="min-w-0">
                      <b>{transactionTypeVi[t.type] || t.type}</b>
                      <span className="text-slate-500"> · {t.project_title}</span>
                      <div className="text-xs text-slate-500">
                        {formatDate(t.created_at)} · {t.method || '—'} · {t.gateway_ref || '—'}
                      </div>
                    </div>
                    <div className="text-right">
                      <b>{vnd(t.amount)}</b>
                      <div>
                        <span
                          className={`badge ${
                            t.status === 'success'
                              ? 'bg-emerald-100 text-emerald-700'
                              : t.status === 'pending'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {transactionStatusVi[t.status] || t.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
