import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import {
  EmptyState,
  ErrorState,
  Loading,
  Modal,
  PageHeader,
  Spinner,
  StatCard,
  StatusBadge,
} from '../components/ui';
import {
  formatDate,
  kycVi,
  pledgeStatusVi,
  roleVi,
  transactionStatusText,
  transactionTypeVi,
  vnd,
} from '../lib/format';
import { isValidVietnamesePhone, PHONE_HINT } from '../lib/phone';
import { readDocumentImage } from '../lib/images';
import {
  KYC_DOCUMENT_TYPES,
  KYC_SCAN_FIELD_LABELS,
  KYC_SCAN_FIELDS,
  kycErrorMessage,
  maxBirthDate,
  minBirthDate,
  preferScannedName,
  shouldFillScannedField,
  validateKycDraft,
} from '../lib/kyc';

const EMPTY_PROJECTS = { owned: [], collaborating: [], invitations: [] };

const KYC_NOTE_CLASS = {
  info: 'border-sky-200 bg-sky-50 text-sky-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-700',
};

function emptyKycForm(user) {
  return {
    full_name: user?.full_name || '',
    dob: '',
    phone: user?.phone || '',
    email: user?.email || '',
    address: '',
    document_type: 'cccd',
    document_number: '',
    front_image: '',
    back_image: '',
  };
}

function DocumentUpload({ label, hint, value, busy, onChange, onClear }) {
  return (
    <div>
      <div className="text-xs font-semibold">{label}</div>
      <label className="mt-1 block cursor-pointer overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 text-center transition hover:border-emerald-400">
        {value ? (
          <img src={value} alt={label} className="h-40 w-full bg-slate-100 object-contain" />
        ) : (
          <div className="flex h-40 flex-col items-center justify-center gap-1 p-3 text-xs text-slate-500">
            <span className="text-2xl">📷</span>
            <span className="font-semibold text-emerald-700">Chọn ảnh giấy tờ</span>
            <span>{hint}</span>
          </div>
        )}
        <input type="file" accept="image/*" className="hidden" onChange={onChange} disabled={busy} />
      </label>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>{busy ? <><Spinner className="mr-1 h-3 w-3" /> Đang xử lý ảnh…</> : 'JPG/PNG/HEIC/WEBP · ảnh dọc hoặc ngang đều được'}</span>
        {value && !busy && (
          <button type="button" className="shrink-0 text-red-500 hover:underline" onClick={onClear}>
            Xóa ảnh
          </button>
        )}
      </div>
    </div>
  );
}

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
  const [projectData, setProjectData] = useState(EMPTY_PROJECTS);
  const [projectView, setProjectView] = useState('');
  const [kycSummary, setKycSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState('');
  const [emailDevUrl, setEmailDevUrl] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [form, setForm] = useState({ full_name: '', phone: '', avatar_url: '' });

  const [kycOpen, setKycOpen] = useState(false);
  const [kycForm, setKycForm] = useState(() => emptyKycForm(currentUser));
  const [kycError, setKycError] = useState('');
  const [kycFieldErrors, setKycFieldErrors] = useState({});
  const [kycBusy, setKycBusy] = useState(false);
  const [kycImageBusy, setKycImageBusy] = useState('');
  const [kycScanBusy, setKycScanBusy] = useState(false);
  const [kycScanNote, setKycScanNote] = useState(null);
  const kycScanSeq = useRef(0);
  const kycImageSeq = useRef({ front: 0, back: 0 });
  const [kycMsg, setKycMsg] = useState('');
  const [kycDevUrl, setKycDevUrl] = useState('');
  const [kycResendBusy, setKycResendBusy] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    setForm({
      full_name: currentUser.full_name || '',
      phone: currentUser.phone || '',
      avatar_url: currentUser.avatar_url || '',
    });
  }, [currentUser]);

  const loadKycSummary = useCallback(async () => {
    try {
      const data = await api.get('/me');
      setKycSummary(data?.kyc || null);
      return data?.kyc || null;
    } catch {
      return null;
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [pledgeData, txData, projectRes, meData] = await Promise.all([
        api.get('/me/pledges'),
        api.get('/me/transactions'),
        api.get('/me/projects'),
        api.get('/me'),
      ]);
      setPledges(pledgeData?.items || []);
      setTransactions(txData?.items || []);
      setProjectData({
        owned: projectRes?.owned || [],
        collaborating: projectRes?.collaborating || [],
        invitations: projectRes?.invitations || [],
      });
      setKycSummary(meData?.kyc || null);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const profilePhoneError =
    form.phone.trim() && !isValidVietnamesePhone(form.phone)
      ? `Số điện thoại chưa hợp lệ. ${PHONE_HINT}`
      : '';
  const profilePhoneValid = form.phone.trim() && isValidVietnamesePhone(form.phone);

  const submitNeedKyc = () => {
    setProjectView('owned');
    openKyc();
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
    if (form.phone.trim() && !isValidVietnamesePhone(form.phone)) {
      setProfileError(`Số điện thoại chưa hợp lệ. ${PHONE_HINT}`);
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

  const openKyc = () => {
    const source = kycSummary || {};
    setKycForm({
      ...emptyKycForm(currentUser),
      full_name: source.full_name || currentUser?.full_name || '',
      dob: source.dob ? String(source.dob).slice(0, 10) : '',
      phone: source.phone || currentUser?.phone || '',
      email: source.email || currentUser?.email || '',
      address: source.address || '',
      document_type: source.document_type || 'cccd',
    });
    setKycError('');
    setKycFieldErrors({});
    setKycScanNote(null);
    setKycScanBusy(false);
    kycScanSeq.current += 1;
    kycImageSeq.current.front += 1;
    kycImageSeq.current.back += 1;
    setKycOpen(true);
  };

  const applyScannedFields = (fields) => {
    if (!fields) return [];
    const filled = KYC_SCAN_FIELDS.filter((key) => fields[key]);
    if (!filled.length) return [];

    setKycForm((value) => {
      const next = { ...value };
      for (const key of filled) {
        next[key] =
          key === 'full_name'
            ? preferScannedName(value.full_name, fields[key])
            : shouldFillScannedField(key, value[key], value.document_type)
              ? fields[key]
              : value[key];
      }
      return next;
    });
    setKycFieldErrors((errors) => {
      const next = { ...errors };
      for (const key of filled) next[key] = '';
      return next;
    });
    return filled;
  };

  const pickKycImage = (side) => async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const imageSeq = kycImageSeq.current[side] + 1;
    kycImageSeq.current[side] = imageSeq;
    const scanSeq = side === 'front' ? kycScanSeq.current + 1 : kycScanSeq.current;
    if (side === 'front') kycScanSeq.current = scanSeq;

    setKycImageBusy(side);
    setKycError('');
    setKycScanNote(null);

    let dataUrl;
    try {
      const label = side === 'front' ? 'Ảnh mặt trước' : 'Ảnh mặt sau';
      dataUrl = await readDocumentImage(file, label);
    } catch (err) {
      if (imageSeq === kycImageSeq.current[side]) {
        setKycError(err.message);
        setKycImageBusy((current) => (current === side ? '' : current));
      }
      return;
    }
    if (imageSeq !== kycImageSeq.current[side]) return;

    setKycImageBusy((current) => (current === side ? '' : current));
    const field = side === 'front' ? 'front_image' : 'back_image';
    setKycForm((value) => ({ ...value, [field]: dataUrl }));
    setKycFieldErrors((errors) => ({ ...errors, [field]: '' }));

    if (side !== 'front' || scanSeq !== kycScanSeq.current) return;

    setKycScanBusy(true);
    setKycScanNote({ tone: 'info', text: 'Đang đọc thông tin trên ảnh…' });
    try {
      const scan = await api.post('/me/kyc/scan', {
        document_type: kycForm.document_type,
        image: dataUrl,
      });
      if (scanSeq !== kycScanSeq.current) return;

      const filled = applyScannedFields(scan?.fields || {});
      if (filled.length) {
        const labels = filled.map((key) => KYC_SCAN_FIELD_LABELS[key]).filter(Boolean);
        const missing = (scan?.missing || []).map((key) => KYC_SCAN_FIELD_LABELS[key]).filter(Boolean);
        setKycScanNote({
          tone: 'success',
          text: `Đã đọc được ${labels.join(', ')} từ ảnh. Vui lòng kiểm tra lại.${missing.length ? ` Chưa đọc được: ${missing.join(', ')}.` : ''}`,
        });
      } else {
        setKycScanNote({
          tone: 'warn',
          text: scan?.message || 'Ảnh đã được tải lên nhưng chưa đọc được thông tin. Vui lòng nhập tay hoặc chọn ảnh rõ hơn.',
        });
      }
    } catch (err) {
      if (scanSeq !== kycScanSeq.current) return;
      setKycScanNote({
        tone: 'warn',
        text: `${err.message} Ảnh vẫn được giữ — bạn có thể nhập tay hoặc chọn ảnh khác.`,
      });
    } finally {
      if (scanSeq === kycScanSeq.current) setKycScanBusy(false);
    }
  };

  const clearKycImage = (side) => {
    kycImageSeq.current[side] += 1;
    setKycImageBusy((current) => (current === side ? '' : current));
    if (side === 'front') {
      kycScanSeq.current += 1;
      setKycScanBusy(false);
      setKycScanNote(null);
    }
    const field = side === 'front' ? 'front_image' : 'back_image';
    setKycForm((value) => ({ ...value, [field]: '' }));
    setKycFieldErrors((errors) => ({ ...errors, [field]: '' }));
  };

  const submitKyc = async (e) => {
    e.preventDefault();
    setKycError('');
    const errors = validateKycDraft(kycForm);
    setKycFieldErrors(errors);
    if (Object.keys(errors).length) {
      setKycError('Vui lòng kiểm tra lại các thông tin được đánh dấu.');
      return;
    }

    setKycBusy(true);
    try {
      const payload = {
        ...kycForm,
        full_name: kycForm.full_name.trim().replace(/\s+/g, ' '),
        phone: kycForm.phone.trim(),
        email: kycForm.email.trim(),
        address: kycForm.address.trim().replace(/\s+/g, ' '),
        document_number: kycForm.document_number.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
        back_image: kycForm.back_image || null,
      };
      const data = await api.post('/me/kyc', payload);
      setKycMsg(data?.message || 'Hồ sơ KYC đã được tiếp nhận.');
      setKycDevUrl(data?.dev_verification_url || '');
      setKycOpen(false);
      await Promise.all([refreshSession(), refreshNotifications(), loadKycSummary()]);
      toast('Đã gửi hồ sơ xác thực danh tính.', 'success');
    } catch (err) {
      setKycError(kycErrorMessage(err));
    } finally {
      setKycBusy(false);
    }
  };

  const resendKycEmail = async () => {
    setKycResendBusy(true);
    setKycMsg('');
    setKycDevUrl('');
    try {
      const data = await api.post('/me/kyc/resend');
      setKycMsg(data?.message || 'Đã gửi lại email xác thực KYC.');
      setKycDevUrl(data?.dev_verification_url || '');
      await refreshSession();
    } catch (err) {
      setKycMsg(kycErrorMessage(err));
    } finally {
      setKycResendBusy(false);
    }
  };

  if (!currentUser) return null;

  const verified = currentUser.kyc_status === 'verified';
  const pending = currentUser.kyc_status === 'pending';
  const documentType = KYC_DOCUMENT_TYPES[kycForm.document_type] || KYC_DOCUMENT_TYPES.cccd;
  const kycPhoneValid = kycForm.phone && isValidVietnamesePhone(kycForm.phone);
  const toggleProjectView = (view) => setProjectView((current) => (current === view ? '' : view));
  const activeProjects = projectView === 'owned' ? projectData.owned : projectData.collaborating;
  const activeProjectLabel = projectView === 'owned' ? 'Dự án của tôi' : 'Dự án cộng tác';
  const maxDob = maxBirthDate();
  const minDob = minBirthDate();

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
        <StatCard
          label="Dự án của tôi"
          value={stats.owned_projects}
          hint={projectView === 'owned' ? 'Đang hiển thị danh sách bên dưới' : 'Bấm để xem tên dự án'}
          onClick={() => toggleProjectView('owned')}
          active={projectView === 'owned'}
        />
        <StatCard
          label="Dự án cộng tác"
          value={stats.collaborating_projects}
          hint={projectView === 'collaborating' ? 'Đang hiển thị danh sách bên dưới' : 'Bấm để xem tên dự án'}
          onClick={() => toggleProjectView('collaborating')}
          active={projectView === 'collaborating'}
        />
        <StatCard label="Thông báo chưa đọc" value={stats.unread_notifications} tone={stats.unread_notifications ? 'amber' : 'default'} />
      </div>

      {needKyc && !verified && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          ⛔ Bạn cần xác thực danh tính (KYC) trước khi tạo dự án. Hãy bấm{' '}
          <button className="link font-semibold" onClick={submitNeedKyc}>xác thực danh tính</button> để gửi hồ sơ.
        </div>
      )}

      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold">Danh sách dự án</h2>
            <p className="text-xs text-slate-500">Bấm “Dự án của tôi” hoặc “Dự án cộng tác” để mở danh sách, sau đó bấm tên dự án để truy cập.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={`rounded-xl px-3 py-1.5 text-sm font-medium ${projectView === 'owned' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              onClick={() => toggleProjectView('owned')}
            >
              Dự án của tôi ({projectData.owned.length})
            </button>
            <button
              className={`rounded-xl px-3 py-1.5 text-sm font-medium ${projectView === 'collaborating' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              onClick={() => toggleProjectView('collaborating')}
            >
              Dự án cộng tác ({projectData.collaborating.length})
            </button>
          </div>
        </div>

        {!projectView && (
          <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-500">
            {projectData.invitations.length > 0
              ? `Bạn có ${projectData.invitations.length} lời mời cộng tác đang chờ. Mở “Dự án của tôi” để xử lý lời mời.`
              : 'Chọn một danh sách để xem tên các dự án bạn sở hữu hoặc đang cộng tác.'}
          </p>
        )}

        {projectView && (
          <div className="mt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{activeProjectLabel} ({activeProjects.length})</h3>
              <Link to="/du-an-cua-toi" className="link text-xs">Mở trang quản lý dự án →</Link>
            </div>
            {activeProjects.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                {projectView === 'owned' ? 'Bạn chưa sở hữu dự án nào.' : 'Bạn chưa cộng tác dự án nào.'}
              </p>
            ) : (
              <div className="mt-2 divide-y">
                {activeProjects.map((project) => (
                  <div key={project.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <Link to={`/du-an/${project.id}`} className="min-w-0 flex-1 font-semibold link">
                      {project.cover_emoji || '📁'} {project.title}
                    </Link>
                    <StatusBadge status={project.status} />
                    {project.collab_role && (
                      <span className="badge bg-indigo-100 text-indigo-700">
                        {project.collab_role === 'moderator' ? 'Quản trị nội dung' : 'Biên tập viên'}
                      </span>
                    )}
                    <Link to={`/quan-ly/${project.id}`} className="link text-xs">Quản lý</Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

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
              <span className={`badge ${verified ? 'bg-emerald-100 text-emerald-700' : pending ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
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
                  : pending
                    ? 'Hồ sơ CCCD/hộ chiếu đã được tiếp nhận. Hệ thống đã đối chiếu OCR và đang chờ bạn xác thực email để hoàn tất.'
                    : 'Xác thực bằng CCCD hoặc hộ chiếu: ảnh giấy tờ được đối chiếu OCR, kiểm tra trùng số giấy tờ và gửi email xác thực tới bạn.'}
              </p>
              {verified && kycSummary?.verified_at && (
                <p className="mt-1 text-xs text-emerald-700">Đã xác thực ngày {formatDate(kycSummary.verified_at)}.</p>
              )}
              {pending && kycSummary?.submitted_at && (
                <p className="mt-1 text-xs text-blue-700">Gửi hồ sơ ngày {formatDate(kycSummary.submitted_at)}.</p>
              )}
              {!verified && (
                <button className="btn-primary mt-2 w-full text-sm" onClick={openKyc}>
                  {pending ? 'Cập nhật hồ sơ KYC' : 'Xác thực danh tính'}
                </button>
              )}
              {pending && (
                <button
                  className="btn-ghost mt-2 w-full text-xs disabled:opacity-60"
                  onClick={resendKycEmail}
                  disabled={kycResendBusy}
                >
                  {kycResendBusy ? <><Spinner className="mr-1 h-3 w-3" /> Đang gửi…</> : 'Gửi lại email xác thực KYC'}
                </button>
              )}
              {kycMsg && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">{kycMsg}</p>}
              {kycDevUrl && (
                <a href={kycDevUrl} className="link mt-1 inline-block text-xs">Mở liên kết xác thực KYC →</a>
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

            <button className="link mt-4 text-sm" onClick={() => setLogoutOpen(true)}>
              Đăng xuất
            </button>
          </div>

          <form className="card space-y-3 p-5" onSubmit={saveProfile} noValidate>
            <h2 className="font-bold">Chỉnh sửa hồ sơ</h2>
            <div>
              <label className="text-xs font-semibold">Họ và tên</label>
              <input className="input mt-1" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-semibold">Số điện thoại</label>
              <input
                className={`input mt-1 ${profilePhoneError ? 'input-error' : ''}`}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="09xx…"
                inputMode="tel"
                aria-invalid={!!profilePhoneError}
              />
              {profilePhoneError && <p className="mt-1 text-xs text-red-600">{profilePhoneError}</p>}
              {profilePhoneValid && <p className="mt-1 text-xs text-emerald-700">✓ Số điện thoại hợp lệ.</p>}
            </div>
            <div>
              <label className="text-xs font-semibold">Ảnh đại diện (URL)</label>
              <input className="input mt-1" value={form.avatar_url} onChange={(e) => setForm({ ...form, avatar_url: e.target.value })} placeholder="https://…" />
            </div>
            {profileError && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{profileError}</div>}
            <button
              className="btn-primary w-full text-sm disabled:opacity-60"
              type="submit"
              disabled={profileBusy || !!profilePhoneError}
            >
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
                          Giao dịch: {transactionStatusText({ status: p.transaction_status })}
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
                          {transactionStatusText(t)}
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

      <Modal
        open={kycOpen}
        title="Xác thực danh tính (KYC)"
        onClose={() => !kycBusy && setKycOpen(false)}
        wide
        footer={
          <>
            <button className="btn-ghost text-sm" onClick={() => setKycOpen(false)} disabled={kycBusy}>
              Hủy
            </button>
            <button
              className="btn-primary text-sm disabled:opacity-60"
              type="submit"
              form="kyc-form"
              disabled={kycBusy || !!kycImageBusy || kycScanBusy}
            >
              {kycBusy ? (
                <><Spinner className="mr-1 h-3 w-3" /> Đang đối chiếu OCR…</>
              ) : kycScanBusy ? (
                <><Spinner className="mr-1 h-3 w-3" /> Đang đọc thông tin trên ảnh…</>
              ) : (
                'Gửi hồ sơ xác thực'
              )}
            </button>
          </>
        }
      >
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          Hệ thống tự động đọc thông tin trên ảnh CCCD/hộ chiếu để điền vào biểu mẫu, kiểm tra số giấy tờ trùng lặp,
          sau đó gửi liên kết xác thực tới email liên hệ để hoàn tất KYC.
        </div>

        {kycError && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{kycError}</div>}

        <form id="kyc-form" className="space-y-3" onSubmit={submitKyc} noValidate>
          <div>
            <label className="text-xs font-semibold">Loại giấy tờ</label>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {Object.entries(KYC_DOCUMENT_TYPES).map(([key, meta]) => (
                <button
                  key={key}
                  type="button"
                  className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
                    kycForm.document_type === key
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                      : 'border-slate-300 bg-white hover:border-emerald-300'
                  }`}
                  onClick={() => {
                    kycScanSeq.current += 1;
                    setKycScanBusy(false);
                    setKycScanNote(null);
                    setKycForm((value) => ({ ...value, document_type: key }));
                    setKycFieldErrors((errors) => ({ ...errors, document_number: '', back_image: '' }));
                  }}
                >
                  {meta.label}
                  <span className="mt-0.5 block text-xs font-normal text-slate-500">
                    {meta.backRequired ? 'Cần ảnh mặt trước và mặt sau' : 'Chỉ cần ảnh trang thông tin'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold">Họ và tên trên giấy tờ</label>
              <input
                className={`input mt-1 ${kycFieldErrors.full_name ? 'input-error' : ''}`}
                value={kycForm.full_name}
                onChange={(e) => setKycForm({ ...kycForm, full_name: e.target.value })}
                placeholder="Nguyễn Văn A"
                autoComplete="name"
              />
              {kycFieldErrors.full_name && <p className="mt-1 text-xs text-red-600">{kycFieldErrors.full_name}</p>}
            </div>
            <div>
              <label className="text-xs font-semibold">Ngày sinh</label>
              <input
                type="date"
                className={`input mt-1 ${kycFieldErrors.dob ? 'input-error' : ''}`}
                value={kycForm.dob}
                min={minDob}
                max={maxDob}
                onChange={(e) => setKycForm({ ...kycForm, dob: e.target.value })}
              />
              {kycFieldErrors.dob && <p className="mt-1 text-xs text-red-600">{kycFieldErrors.dob}</p>}
            </div>
            <div>
              <label className="text-xs font-semibold">Số điện thoại</label>
              <input
                className={`input mt-1 ${kycFieldErrors.phone || (kycForm.phone && !kycPhoneValid) ? 'input-error' : ''}`}
                value={kycForm.phone}
                onChange={(e) => {
                  setKycForm({ ...kycForm, phone: e.target.value });
                  setKycFieldErrors((errors) => ({ ...errors, phone: '' }));
                }}
                placeholder="09xx…"
                inputMode="tel"
              />
              {kycForm.phone && !kycPhoneValid ? (
                <p className="mt-1 text-xs text-red-600">Số điện thoại chưa hợp lệ. {PHONE_HINT}</p>
              ) : kycFieldErrors.phone ? (
                <p className="mt-1 text-xs text-red-600">{kycFieldErrors.phone}</p>
              ) : kycPhoneValid ? (
                <p className="mt-1 text-xs text-emerald-700">✓ Số điện thoại hợp lệ.</p>
              ) : null}
            </div>
            <div>
              <label className="text-xs font-semibold">Email liên hệ</label>
              <input
                type="email"
                className={`input mt-1 ${kycFieldErrors.email ? 'input-error' : ''}`}
                value={kycForm.email}
                onChange={(e) => setKycForm({ ...kycForm, email: e.target.value })}
                placeholder="email@example.com"
                autoComplete="email"
              />
              {kycFieldErrors.email && <p className="mt-1 text-xs text-red-600">{kycFieldErrors.email}</p>}
              <p className="mt-1 text-[11px] text-slate-500">Liên kết xác thực hồ sơ sẽ được gửi tới email này.</p>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold">Địa chỉ thường trú</label>
            <textarea
              className={`input mt-1 ${kycFieldErrors.address ? 'input-error' : ''}`}
              rows="2"
              value={kycForm.address}
              onChange={(e) => setKycForm({ ...kycForm, address: e.target.value })}
              placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành phố"
            />
            {kycFieldErrors.address && <p className="mt-1 text-xs text-red-600">{kycFieldErrors.address}</p>}
          </div>

          <div>
            <label className="text-xs font-semibold">{documentType.numberLabel}</label>
            <input
              className={`input mt-1 ${kycFieldErrors.document_number ? 'input-error' : ''}`}
              value={kycForm.document_number}
              onChange={(e) => setKycForm({ ...kycForm, document_number: e.target.value })}
              placeholder={documentType.numberPlaceholder}
              autoComplete="off"
            />
            <p className="mt-1 text-[11px] text-slate-500">{documentType.numberHint} Số giấy tờ phải khớp với ảnh tải lên.</p>
            {kycFieldErrors.document_number && <p className="mt-1 text-xs text-red-600">{kycFieldErrors.document_number}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <DocumentUpload
                label={`Ảnh mặt trước ${documentType.short}`}
                hint="Ảnh dọc hoặc ngang, đủ sáng, thấy rõ số và họ tên"
                value={kycForm.front_image}
                busy={kycImageBusy === 'front'}
                onChange={pickKycImage('front')}
                onClear={() => clearKycImage('front')}
              />
              {kycFieldErrors.front_image && <p className="mt-1 text-xs text-red-600">{kycFieldErrors.front_image}</p>}
            </div>
            <div>
              <DocumentUpload
                label={documentType.backRequired ? `Ảnh mặt sau ${documentType.short}` : 'Ảnh mặt sau (không bắt buộc)'}
                hint={documentType.backRequired ? 'Cần thấy rõ mã MRZ hoặc thông tin mặt sau' : 'Có thể bổ sung nếu giấy tờ có mặt sau'}
                value={kycForm.back_image}
                busy={kycImageBusy === 'back'}
                onChange={pickKycImage('back')}
                onClear={() => clearKycImage('back')}
              />
              {kycFieldErrors.back_image && <p className="mt-1 text-xs text-red-600">{kycFieldErrors.back_image}</p>}
            </div>
          </div>

          {kycScanNote && (
            <div className={`rounded-xl border p-3 text-xs ${KYC_NOTE_CLASS[kycScanNote.tone] || KYC_NOTE_CLASS.info}`}>
              {kycScanNote.tone === 'info' && <Spinner className="mr-1 inline h-3 w-3" />}
              {kycScanNote.text}
            </div>
          )}
        </form>
      </Modal>

      <Modal
        open={logoutOpen}
        title="Xác nhận đăng xuất"
        onClose={() => setLogoutOpen(false)}
        footer={
          <>
            <button className="btn-ghost text-sm" onClick={() => setLogoutOpen(false)}>Hủy</button>
            <button
              className="btn-primary text-sm disabled:opacity-60"
              disabled={logoutBusy}
              onClick={async () => {
                setLogoutBusy(true);
                try {
                  await logout();
                  setLogoutOpen(false);
                  nav('/');
                } finally {
                  setLogoutBusy(false);
                }
              }}
            >
              {logoutBusy ? <><Spinner className="mr-1 h-3 w-3" /> Đang đăng xuất…</> : 'Xác nhận'}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">Bạn có chắc chắn muốn đăng xuất?</p>
      </Modal>
    </div>
  );
}
