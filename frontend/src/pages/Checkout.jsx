import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import { AIBox, ErrorState, Loading, ProjectCover, Spinner, StatusBadge } from '../components/ui';
import { daysLeft, percent, vnd } from '../lib/format';

const MIN_AMOUNT = 10000;
const QUICK_AMOUNTS = [100000, 200000, 500000, 2000000];

export default function Checkout() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { currentUser, toast } = useApp();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [amount, setAmount] = useState(200000);
  const [anonymous, setAnonymous] = useState(false);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await api.get(`/projects/${id}`);
      setProject(data);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const preset = useMemo(() => {
    if (!project) return null;
    const rewardId = sp.get('reward');
    return project.rewards.find((r) => r.id === rewardId) || null;
  }, [project, sp]);

  useEffect(() => {
    if (preset) setAmount(Number(preset.min_amount));
  }, [preset]);

  const minAmount = preset ? Number(preset.min_amount) : MIN_AMOUNT;
  const amountNumber = Number(amount) || 0;
  const validAmount = amountNumber >= minAmount;

  if (loading) return <Loading text="Đang chuẩn bị trang thanh toán…" />;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!project) return null;

  const canDonate = project.can_pledge;
  const soldOut = preset && preset.remaining <= 0;

  const goToPayment = () => {
    setError('');
    if (soldOut) {
      setError('Gói tri ân đã hết suất, vui lòng chọn gói khác.');
      return;
    }
    if (!validAmount) {
      setError(`Số tiền tối thiểu là ${vnd(minAmount)}${preset ? ` cho gói “${preset.title}”` : ''}.`);
      return;
    }
    setStep(2);
  };

  const pay = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api.post(`/projects/${project.id}/pledges`, {
        amount: amountNumber,
        reward_id: preset?.id || null,
        is_anonymous: anonymous,
        method: 'VNPay',
      });
      if (!data?.payment_url) throw new Error('Không nhận được liên kết thanh toán VNPay.');
      toast(
        data.payment_mode === 'mock'
          ? 'Đang mở trang mô phỏng thanh toán (chưa cấu hình VNPay).'
          : 'Đang chuyển đến cổng thanh toán VNPay…',
        'info',
      );
      window.location.assign(data.payment_url);
    } catch (err) {
      setError(err.message);
      toast(err.message, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="card p-5">
        <div className="flex flex-wrap items-start gap-3">
          <ProjectCover project={project} className="h-20 w-28 shrink-0" emojiClass="text-3xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={project.status} />
              <span className="text-xs text-slate-500">{daysLeft(project.end_date)}</span>
            </div>
            <Link to={`/du-an/${project.id}`} className="mt-1 block font-bold link">{project.title}</Link>
            <div className="text-xs text-slate-500">{percent(project)}% · {vnd(project.current_amount)} / {vnd(project.goal_amount)}</div>
          </div>
        </div>
      </div>

      <div className="card space-y-4 p-5">
        <h1 className="text-xl font-bold">Tài trợ dự án</h1>
        <div className="flex gap-2 text-sm">
          {[[1, '1. Chọn mức'], [2, '2. Thanh toán'], [3, '3. Hoàn tất']].map(([n, label]) => (
            <span key={n} className={`flex-1 rounded-lg py-1 text-center font-medium ${step === n ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}`}>
              {label}
            </span>
          ))}
        </div>

        {!canDonate && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            ⛔ Bạn không thể tài trợ dự án này
            {currentUser?.role === 'admin'
              ? ' vì đang dùng tài khoản quản trị.'
              : project.owner_id === currentUser?.id
                ? ' vì đây là dự án của bạn.'
                : project.status !== 'active'
                  ? ' vì dự án không ở trạng thái đang gây quỹ.'
                  : ' vì chiến dịch đã kết thúc.'}
            <div className="mt-2">
              <Link to={`/du-an/${project.id}`} className="link font-semibold">← Về trang dự án</Link>
            </div>
          </div>
        )}

        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {step === 1 && (
          <>
            <div>
              <label className="text-sm font-semibold">Số tiền tài trợ (đ)</label>
              <div className="mt-1 text-xs text-slate-500">Tối thiểu {vnd(minAmount)}</div>
              <input
                type="number"
                min={minAmount}
                step="10000"
                className="input mt-2"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {QUICK_AMOUNTS.filter((m) => m >= minAmount).map((m) => (
                  <button key={m} className={`btn-ghost text-sm ${amountNumber === m ? '!border-emerald-500 !text-emerald-700' : ''}`} onClick={() => setAmount(m)}>
                    {vnd(m)}
                  </button>
                ))}
              </div>
            </div>

            {preset ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <b>Gói đã chọn: {preset.title}</b>
                <div className="text-xs text-slate-600">Tối thiểu {vnd(preset.min_amount)} · còn {preset.remaining} suất</div>
                {preset.description && <div className="mt-1 text-xs text-slate-600">{preset.description}</div>}
                <Link to={`/du-an/${project.id}?tab=goi`} className="link mt-1 inline-block text-xs">Đổi gói khác</Link>
              </div>
            ) : (
              <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Bạn đang tài trợ tự do, không kèm quà tri ân.</div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
              Tài trợ ẩn danh (tên không hiển thị với chủ dự án)
            </label>
            <button className="btn-primary w-full disabled:opacity-50" disabled={!canDonate} onClick={goToPayment}>
              Tiếp tục thanh toán
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <div className="flex justify-between gap-2"><span>Số tiền</span><b>{vnd(amountNumber)}</b></div>
              <div className="flex justify-between gap-2"><span>Dự án</span><b className="text-right">{project.title}</b></div>
              {preset && <div className="flex justify-between gap-2"><span>Gói tri ân</span><b>{preset.title}</b></div>}
              <div className="flex justify-between gap-2"><span>Ẩn danh</span><b>{anonymous ? 'Có' : 'Không'}</b></div>
            </div>

            <div>
              <label className="text-sm font-semibold">Phương thức thanh toán</label>
              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm">
                  <div>
                    <b>VNPay</b>
                    <div className="text-xs text-slate-600">Thẻ ATM, Internet Banking, QR, thẻ quốc tế</div>
                  </div>
                  <span className="badge bg-emerald-100 text-emerald-700">Đã chọn</span>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-400">
                  <span>Ví MoMo</span>
                  <span className="badge bg-slate-200 text-slate-500">Sắp hỗ trợ</span>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-400">
                  <span>Thẻ quốc tế (nhập trực tiếp)</span>
                  <span className="badge bg-slate-200 text-slate-500">Sắp hỗ trợ</span>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Bạn sẽ được chuyển đến cổng thanh toán VNPay. Khoản tài trợ chỉ được ghi nhận sau khi VNPay xác nhận thanh toán thành công.
              </p>
            </div>

            <AIBox variant={amountNumber >= 5000000 ? 'warn' : 'info'}>
              Giao dịch được kiểm tra rủi ro tự động trước khi chuyển sang VNPay.
              {amountNumber >= 5000000
                ? ' Khoản tài trợ lớn có thể được gắn cờ để quản trị viên xem xét.'
                : ' Sau khi thanh toán xong, hệ thống mới cập nhật tiến độ dự án.'}
            </AIBox>

            {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => { setStep(1); setError(''); }} disabled={busy}>
                Quay lại
              </button>
              <button className="btn-primary flex-1 disabled:opacity-60" onClick={pay} disabled={busy || !canDonate}>
                {busy ? <><Spinner className="mr-1 h-3 w-3" /> Đang chuyển đến VNPay…</> : `Thanh toán ${vnd(amountNumber)}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
