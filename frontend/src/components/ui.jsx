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

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function asArray(value) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

const METRIC_LABELS = {
  auc: 'AUC',
  accuracy: 'Accuracy',
  precision: 'Precision',
  recall: 'Recall',
  f1: 'F1',
  brier: 'Brier',
  baseline_accuracy: 'Baseline',
};

function predictionLabel(score) {
  if (score >= 65) return 'Có khả năng thành công';
  if (score <= 35) return 'Rủi ro không đạt mục tiêu';
  return 'Kết quả chưa rõ ràng';
}

/**
 * Hiển thị dự báo thành công kèm đóng góp của từng tín hiệu.
 * Nhận được cả payload đầy đủ từ /api/ai/estimate và bản ghi ai_predictions.
 */
export function PredictionExplain({ prediction, fallbackScore = null, compact = false }) {
  if (!prediction && fallbackScore === null) return null;

  const rawScore = prediction?.score ?? prediction?.success_probability ?? fallbackScore;
  const score = Math.round(Number(rawScore ?? 0));
  const label = prediction?.label_text || predictionLabel(score);
  const confidence = Number(prediction?.confidence ?? 0);
  const modelVersion = prediction?.model?.version || prediction?.model_version || null;
  const metrics = parseJson(prediction?.model?.metrics ?? prediction?.model_metrics, {});
  const contributions = asArray(prediction?.contributions);
  const sorted = [...contributions].sort(
    (a, b) => Math.abs(Number(b.effect_pp || 0)) - Math.abs(Number(a.effect_pp || 0)),
  );
  const top = sorted.slice(0, compact ? 3 : 5);
  const maxAbs = Math.max(1, ...top.map((item) => Math.abs(Number(item.effect_pp || 0))));
  const variant = score >= 65 ? 'success' : score <= 35 ? 'warn' : 'info';

  const summary =
    prediction?.summary ||
    (score >= 65
      ? 'Mô hình nghiêng về khả năng thành công dựa trên các tín hiệu có sẵn trước khi chiến dịch chạy.'
      : score <= 35
        ? 'Mô hình đánh giá hồ sơ có rủi ro không đạt mục tiêu. Nên cải thiện các tín hiệu yếu trước khi công khai.'
        : 'Các tín hiệu đang trái chiều, mô hình chưa đủ chắc chắn về kết quả.');

  return (
    <AIBox variant={variant} title="MÔ HÌNH DỰ ĐOÁN THÀNH CÔNG">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <span className="text-2xl font-bold text-slate-800">{score}%</span>
        <span className="font-semibold">{label}</span>
        {confidence > 0 && <span className="text-xs text-slate-500">Độ tin cậy {confidence}%</span>}
        {modelVersion && <span className="badge bg-slate-100 text-slate-600">{modelVersion}</span>}
      </div>
      <p className="mt-1">{summary}</p>

      {top.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-semibold text-slate-600">Tín hiệu đóng góp chính</div>
          {top.map((item) => {
            const effect = Number(item.effect_pp || 0);
            const positive = effect >= 0;
            return (
              <div key={item.key} className="rounded-xl bg-white/70 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <b>{item.label}</b>
                  <span className={positive ? 'font-semibold text-emerald-700' : 'font-semibold text-red-600'}>
                    {positive ? '+' : ''}{effect.toFixed(1)} điểm
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${positive ? 'bg-emerald-500' : 'bg-red-400'}`}
                    style={{ width: `${Math.max(4, (Math.abs(effect) / maxAbs) * 100)}%` }}
                  />
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  {item.explanation || `Tín hiệu này ${positive ? 'làm tăng' : 'làm giảm'} ${Math.abs(effect).toFixed(1)} điểm.`}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <details className="mt-3 text-xs text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-700">Cách mô hình được huấn luyện và kiểm định</summary>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(METRIC_LABELS).map(([key, labelText]) =>
            metrics[key] !== undefined && metrics[key] !== null ? (
              <div key={key} className="rounded-lg bg-white/70 p-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">{labelText}</div>
                <b className="text-sm text-slate-700">{metrics[key]}</b>
              </div>
            ) : null,
          )}
        </div>
        <p className="mt-2">
          Logistic regression có kiểm định chéo 5 fold trên các dự án đã kết thúc. Mô hình chỉ dùng tín hiệu
          có trước khi chiến dịch chạy; điểm tín nhiệm chủ dự án đã bao gồm KYC và lịch sử hoạt động.
          {metrics.n ? ` Cỡ mẫu kiểm định: ${metrics.n} dự án.` : ''}
          {metrics.baseline_accuracy !== undefined ? ` Baseline đoán theo đa số: ${Math.round(Number(metrics.baseline_accuracy) * 100)}%.` : ''}
        </p>
      </details>
    </AIBox>
  );
}

export function ModelCard({ model, title = 'Mô hình dự đoán thành công' }) {
  if (!model) return null;
  const metrics = model.metrics || {};
  const features = model.features || [];
  const maxAbs = Math.max(0.001, ...features.map((f) => Math.abs(Number(f.coefficient || 0))));

  return (
    <div className="card space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">{title}</h2>
          <p className="text-xs text-slate-500">{model.algorithm}</p>
        </div>
        <span className="badge bg-indigo-100 text-indigo-700">{model.version}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Object.entries(METRIC_LABELS).map(([key, labelText]) =>
          metrics[key] !== undefined && metrics[key] !== null ? (
            <div key={key} className="rounded-xl bg-slate-50 p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">{labelText}</div>
              <b className="text-sm">{metrics[key]}</b>
            </div>
          ) : null,
        )}
      </div>

      <div className="text-xs text-slate-500">
        Huấn luyện trên <b>{model.sample_size}</b> dự án đã kết thúc
        {model.positive_rate !== null && model.positive_rate !== undefined ? ` · ${model.positive_rate}% thành công` : ''}
        {metrics.folds ? ` · kiểm định chéo ${metrics.folds} fold` : ''}.
      </div>

      {features.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-600">Hệ số tín hiệu (đã chuẩn hoá)</div>
          {features.map((feature) => {
            const coefficient = Number(feature.coefficient || 0);
            const positive = coefficient >= 0;
            return (
              <div key={feature.key} title={feature.description}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span>{feature.label}</span>
                  <b className={positive ? 'text-emerald-700' : 'text-red-600'}>
                    {positive ? '+' : ''}{coefficient.toFixed(4)}
                  </b>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${positive ? 'bg-emerald-500' : 'bg-red-400'}`}
                    style={{ width: `${Math.max(3, (Math.abs(coefficient) / maxAbs) * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {model.note && <p className="text-xs text-slate-500">{model.note}</p>}
    </div>
  );
}

const SEVERITY_STYLES = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-slate-100 text-slate-600',
};

export function FraudSignals({ evidence, modelVersion = null }) {
  const data = parseJson(evidence, {});
  const signals = Array.isArray(data?.signals) ? data.signals : [];
  if (!signals.length) return null;
  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <b>Bằng chứng ({signals.length} tín hiệu độc lập)</b>
        <span className="text-slate-400">{modelVersion || data?.model_version || ''}</span>
      </div>
      <div className="mt-2 space-y-1.5">
        {signals.map((signal) => (
          <div key={`${signal.code}-${signal.points}`} className="rounded-lg bg-white p-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`badge ${SEVERITY_STYLES[signal.severity] || SEVERITY_STYLES.low}`}>
                {signal.severity || 'low'}
              </span>
              <b>{signal.label}</b>
              <span className="ml-auto font-semibold text-slate-600">
                {signal.points > 0 ? '+' : ''}{signal.points} điểm
              </span>
            </div>
            <div className="mt-1 text-slate-600">{signal.evidence}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FraudEvidenceCard({ flags = [], riskScore = null, modelInfo = null, title = 'Kiểm chứng gian lận' }) {
  const list = asArray(flags);
  const score = riskScore !== null && riskScore !== undefined
    ? Math.round(Number(riskScore))
    : list.length
      ? Math.round(Number(list[0].risk_score || 0))
      : 0;
  const threshold = modelInfo?.threshold || 60;
  const level = score >= 80 ? 'critical' : score >= threshold ? 'high' : score >= 35 ? 'medium' : 'low';

  return (
    <div className="card space-y-2 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">{title}</h2>
        <span className={`badge ${SEVERITY_STYLES[level]}`}>Rủi ro {score}%</span>
      </div>
      <p className="text-xs text-slate-500">
        Mô hình {modelInfo?.project_model || 'fraud-project-v2.0'} chấm điểm từ các tín hiệu độc lập;
        cảnh báo được tạo khi điểm đạt ngưỡng {threshold}%.
      </p>

      {list.length === 0 && (
        <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
          Chưa có cảnh báo vượt ngưỡng. Điểm rủi ro hiện tại {score}% — vẫn được theo dõi khi có giao dịch mới.
        </div>
      )}

      {list.map((flag) => {
        const evidence = parseJson(flag.evidence, {});
        return (
          <div key={flag.id || `${flag.entity_id}-${flag.flagged_at}`} className="rounded-xl border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`badge ${SEVERITY_STYLES[evidence.level || level] || SEVERITY_STYLES.low}`}>
                {evidence.level || level}
              </span>
              <b>Rủi ro {Math.round(Number(flag.risk_score ?? score))}%</b>
              {flag.review_status && (
                <span className="badge bg-slate-100 text-slate-600">
                  {flag.review_status === 'pending' ? 'Chờ xử lý' : flag.review_status === 'confirmed' ? 'Đã xác nhận' : 'Báo nhầm'}
                </span>
              )}
            </div>
            <div className="mt-1 text-sm text-slate-700">{flag.reason || evidence.summary}</div>
            <FraudSignals evidence={flag.evidence} modelVersion={flag.model_version} />
          </div>
        );
      })}
    </div>
  );
}

export function RecommendationBreakdown({ item, compact = false }) {
  if (!item) return null;
  const components = Array.isArray(item.score_breakdown?.components) ? item.score_breakdown.components : [];
  const available = components
    .filter((c) => c.available && Number(c.contribution) > 0)
    .sort((a, b) => Number(b.contribution) - Number(a.contribution));
  const top = available.slice(0, compact ? 2 : 3);

  return (
    <div className="mt-1 space-y-1">
      {item.reason && <div className="text-xs text-slate-600">{item.reason}</div>}
      <div className="flex flex-wrap gap-1">
        {top.map((c) => (
          <span key={c.key} className="badge bg-white/80 text-[11px] text-slate-600">
            {c.label} +{Math.round(Number(c.contribution) * 100)}%
          </span>
        ))}
      </div>
      {!compact && components.length > 0 && (
        <details className="text-[11px] text-slate-500">
          <summary className="cursor-pointer font-medium">Xem cách tính điểm gợi ý</summary>
          <div className="mt-1 space-y-1">
            {components.map((c) => (
              <div key={c.key} className="flex justify-between gap-2">
                <span>{c.label}{c.available ? '' : ' (chưa đủ dữ liệu)'}</span>
                <b>{Math.round(Number(c.contribution) * 100)}%</b>
              </div>
            ))}
            <div className="pt-1 text-slate-400">
              Điểm tổng = tổng đóng góp của các tín hiệu có dữ liệu / tổng trọng số khả dụng.
            </div>
          </div>
        </details>
      )}
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
          <span className="badge border border-emerald-200 bg-emerald-50 text-emerald-700">✓ Không có tín hiệu bất thường</span>
        )}
      </div>
      <Progress project={project} />
      <div className="text-xs text-slate-500">
        Mô hình dự đoán thành công: <b className="text-amber-600">{Math.round(project.ai_success_score)}%</b>
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
