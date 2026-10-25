import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { daysLeft, percent, statusVi, vnd } from '../lib/format';

export function statusColor(status) {
  return (
    {
      active: 'bg-emerald-100 text-emerald-700',
      successful: 'bg-blue-100 text-blue-700',
      failed: 'bg-red-100 text-red-700',
      pending_review: 'bg-amber-100 text-amber-700',
      draft: 'bg-slate-200 text-slate-600',
      canceled: 'bg-slate-200 text-slate-600',
    }[status] || 'bg-slate-100 text-slate-600'
  );
}

export function StatusBadge({ status }) {
  return <span className={`badge ${statusColor(status)}`}>{statusVi[status] || status}</span>;
}

export function ProjectCover({ project, className = '', emojiClass = 'text-5xl' }) {
  const [broken, setBroken] = useState(false);
  const showImage = project?.cover_image_url && !broken;

  return (
    <div className={`relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-100 via-teal-50 to-amber-50 ${className}`}>
      {showImage ? (
        <img
          src={project.cover_image_url}
          alt={project.title || 'Ảnh dự án'}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className={`flex h-full min-h-24 w-full items-center justify-center ${emojiClass}`}>
          {project?.cover_emoji || '🌱'}
        </div>
      )}
      {project?.cover_emoji && showImage && (
        <span className="absolute bottom-2 left-2 rounded-lg bg-white/90 px-2 py-0.5 text-xl shadow-sm">
          {project.cover_emoji}
        </span>
      )}
    </div>
  );
}

export function Progress({ project, compact = false }) {
  const pct = percent(project);
  return (
    <div>
      <div className={`overflow-hidden rounded-full bg-slate-200 ${compact ? 'h-1.5' : 'h-2.5'}`}>
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className={`mt-1 flex flex-wrap items-center justify-between gap-1 font-semibold text-emerald-700 ${compact ? 'text-xs' : 'text-sm'}`}>
        <span>{pct}%</span>
        <span className="font-normal text-slate-500">
          {vnd(project?.current_amount)} / {vnd(project?.goal_amount)}
        </span>
      </div>
    </div>
  );
}

const AI_STYLES = {
  info: 'border-l-amber-400 bg-amber-50/60',
  warn: 'border-l-red-400 bg-red-50/70',
  success: 'border-l-emerald-400 bg-emerald-50/70',
};

export function AIBox({ children, variant = 'info', title = '✨ AI HỖ TRỢ' }) {
  const cls = AI_STYLES[variant] || AI_STYLES.info;
  const labelColor = variant === 'warn' ? 'text-red-700' : variant === 'success' ? 'text-emerald-700' : 'text-amber-700';
  return (
    <div className={`card border-l-4 p-4 ${cls}`}>
      <div className={`mb-1 text-xs font-bold ${labelColor}`}>{title}</div>
      <div className="text-sm text-slate-700">{children}</div>
    </div>
  );
}

export function Spinner({ className = 'h-4 w-4' }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent align-[-0.125em] ${className}`} />;
}

export function Loading({ text = 'Đang tải dữ liệu…', className = '' }) {
  return (
    <div className={`card flex items-center justify-center gap-2 p-8 text-sm text-slate-500 ${className}`}>
      <Spinner className="h-5 w-5 text-emerald-600" />
      {text}
    </div>
  );
}

export function EmptyState({ icon = '📭', title = 'Chưa có dữ liệu', children, action }) {
  return (
    <div className="card p-8 text-center">
      <div className="text-4xl">{icon}</div>
      <b className="mt-2 block">{title}</b>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ message = 'Có lỗi xảy ra.', onRetry }) {
  return (
    <div className="card border-red-200 p-6 text-center">
      <div className="text-3xl">⚠️</div>
      <b className="mt-2 block text-red-700">Không tải được dữ liệu</b>
      <p className="mt-1 text-sm text-slate-600">{message}</p>
      {onRetry && (
        <button className="btn-ghost mt-3 text-sm" onClick={onRetry}>
          Thử lại
        </button>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = 'default' }) {
  const tones = {
    default: 'text-slate-800',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    red: 'text-red-600',
    blue: 'text-blue-700',
  };
  return (
    <div className="card p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tones[tone] || tones.default}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`card max-h-[90vh] w-full overflow-y-auto p-5 ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="btn-ghost !px-2 !py-1 text-sm" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>
        <div className="space-y-3">{children}</div>
        {footer && <div className="mt-4 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

const TOAST_STYLES = {
  info: 'border-emerald-200 bg-white text-slate-700',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  error: 'border-red-300 bg-red-50 text-red-800',
  warning: 'border-amber-300 bg-amber-50 text-amber-800',
  ai: 'border-indigo-200 bg-indigo-50 text-indigo-800',
};

export function ToastStack() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[min(92vw,360px)] space-y-2">
      {toasts.map((t) => (
        <div key={t.id} className={`flex items-start gap-2 rounded-xl border p-3 text-sm shadow-lg ${TOAST_STYLES[t.type] || TOAST_STYLES.info}`}>
          <span className="flex-1">{t.message}</span>
          <button className="text-xs opacity-60 hover:opacity-100" onClick={() => dismissToast(t.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export function Layout({ children }) {
  const { currentUser, role, logout, unread } = useApp();
  const nav = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const linkCls = (to) =>
    `hover:text-emerald-700 ${location.pathname === to ? 'text-emerald-700' : ''}`;

  const handleLogout = async () => {
    await logout();
    nav('/');
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/" className="text-lg font-bold text-emerald-700">
            🤝 GâyQuỹ+
          </Link>
          <button className="btn-ghost ml-auto text-sm md:hidden" onClick={() => setOpen((o) => !o)} aria-label="Mở menu">
            ☰
          </button>
          <nav className={`${open ? 'flex' : 'hidden'} basis-full flex-col gap-2 text-sm font-medium md:flex md:basis-auto md:flex-row md:gap-4`}>
            <Link to="/" className={linkCls('/')}>Trang chủ</Link>
            <Link to="/kham-pha" className={linkCls('/kham-pha')}>Khám phá</Link>
            {currentUser && role !== 'admin' && (
              <Link to="/du-an-cua-toi" className={linkCls('/du-an-cua-toi')}>Dự án của tôi</Link>
            )}
            {role === 'admin' && <Link to="/admin" className={linkCls('/admin')}>Quản trị</Link>}
            {currentUser && <Link to="/ca-nhan" className={linkCls('/ca-nhan')}>Cá nhân</Link>}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {currentUser && (
              <button onClick={() => nav('/thong-bao')} className="btn-ghost relative text-sm" title="Thông báo">
                🔔
                {unread > 0 && (
                  <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
            )}
            {currentUser && (
              <Link to="/ca-nhan" className="flex items-center gap-2" title={currentUser.email}>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                  {currentUser.full_name?.charAt(0)?.toUpperCase() || '?'}
                </span>
                <span className="hidden max-w-32 truncate text-sm text-slate-600 sm:inline">{currentUser.full_name}</span>
              </Link>
            )}
            {currentUser ? (
              <button onClick={handleLogout} className="btn-ghost text-sm">Đăng xuất</button>
            ) : (
              <button onClick={() => nav('/dang-nhap')} className="btn-primary text-sm">Đăng nhập</button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <footer className="py-8 text-center text-xs text-slate-500">
        GâyQuỹ+ — Nền tảng gây quỹ cộng đồng minh bạch + AI. Thanh toán trong đồ án là mô phỏng.
      </footer>
      <ToastStack />
    </div>
  );
}

export function ProjectCard({ project, onFollow, followBusy = false }) {
  return (
    <div className="card flex flex-col gap-2 p-4">
      <ProjectCover project={project} className="h-36" />
      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
        <span className="badge bg-slate-100">{project.category_name}</span>
        <span>{daysLeft(project.end_date)}</span>
      </div>
      <Link to={`/du-an/${project.id}`} className="font-bold leading-snug link">{project.title}</Link>
      <div className="flex flex-wrap gap-1.5">
        <StatusBadge status={project.status} />
        {Number(project.fraud_risk_score) < 30 && (
          <span className="badge border border-emerald-200 bg-emerald-50 text-emerald-700">✓ Đã kiểm chứng</span>
        )}
      </div>
      <Progress project={project} />
      <div className="text-xs text-slate-500">
        AI dự đoán thành công: <b className="text-amber-600">{Math.round(project.ai_success_score)}%</b>
      </div>
      <div className="mt-auto flex gap-2">
        <Link to={`/du-an/${project.id}`} className="btn-primary flex-1 text-center text-sm">Xem & tài trợ</Link>
        {onFollow && (
          <button
            className="btn-ghost text-sm disabled:opacity-60"
            disabled={followBusy}
            onClick={() => onFollow(project)}
            title={project.is_following ? 'Bỏ theo dõi' : 'Theo dõi dự án'}
          >
            {project.is_following ? '★' : '☆'}
          </button>
        )}
      </div>
    </div>
  );
}
