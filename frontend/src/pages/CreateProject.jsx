import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import { AIBox, PageHeader, ProjectCover, Spinner } from '../components/ui';
import { addDaysISO, todayISO, vnd } from '../lib/format';

const EMOJIS = ['🌱', '🌊', '🎒', '💧', '🏮', '📚', '🚑', '🧵', '🌾', '❤️', '🏫', '🐾'];

const CATEGORY_BONUS = { 'Giáo dục': 12, 'Y tế': 8, 'Môi trường': 6, 'Văn hoá': 4, 'Khởi nghiệp': -4 };

function estimateScore({ goal, categoryName, rewardsCount, description, start, end }) {
  let score = 55;
  score += CATEGORY_BONUS[categoryName] || 0;
  const goalNumber = Number(goal) || 0;
  if (goalNumber <= 150_000_000) score += 12;
  else if (goalNumber <= 300_000_000) score += 8;
  else if (goalNumber <= 500_000_000) score += 3;
  else if (goalNumber <= 800_000_000) score -= 6;
  else score -= 14;
  if (rewardsCount >= 3) score += 7;
  else if (rewardsCount === 2) score += 4;
  else if (rewardsCount === 0) score -= 5;
  if (description.length >= 220) score += 6;
  else if (description.length >= 120) score += 3;
  else if (description.length < 60) score -= 6;
  const duration = Math.max(1, Math.ceil((Date.parse(end) - Date.parse(start)) / 86_400_000));
  if (duration <= 60) score += 3;
  else if (duration > 120) score -= 6;
  return Math.max(5, Math.min(95, Math.round(score)));
}

const blankReward = () => ({ title: '', description: '', min_amount: '', quantity_available: 50 });

export default function CreateProject() {
  const nav = useNavigate();
  const { categories, refreshSession, toast } = useApp();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category_id: '',
    goal_amount: '200000000',
    start_date: todayISO(),
    end_date: addDaysISO(45),
    cover_emoji: '🌱',
    cover_image_url: '',
  });
  const [rewards, setRewards] = useState([blankReward()]);

  const categoryId = form.category_id || categories[0]?.id || '';
  const categoryName = categories.find((c) => c.id === categoryId)?.name || '';

  const filledRewards = useMemo(
    () => rewards.filter((r) => r.title.trim() || r.min_amount),
    [rewards],
  );

  const score = estimateScore({
    goal: form.goal_amount,
    categoryName,
    rewardsCount: filledRewards.length,
    description: form.description,
    start: form.start_date,
    end: form.end_date,
  });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const updateReward = (index, key, value) => {
    setRewards((list) => list.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  };

  const validateStep1 = () => {
    if (form.title.trim().length < 10) return 'Tên chiến dịch tối thiểu 10 ký tự.';
    if (!categoryId) return 'Vui lòng chọn danh mục.';
    if (form.description.trim().length < 30) return 'Mô tả chiến dịch tối thiểu 30 ký tự.';
    return '';
  };

  const validateStep2 = () => {
    if (Number(form.goal_amount) < 100000) return 'Mục tiêu tối thiểu 100.000đ.';
    if (!form.start_date || !form.end_date) return 'Vui lòng chọn ngày bắt đầu và kết thúc.';
    if (form.end_date <= form.start_date) return 'Ngày kết thúc phải sau ngày bắt đầu.';
    if (form.end_date < todayISO()) return 'Ngày kết thúc phải ở tương lai.';
    for (const [index, reward] of filledRewards.entries()) {
      if (reward.title.trim().length < 3) return `Gói tri ân #${index + 1}: tên gói tối thiểu 3 ký tự.`;
      if (Number(reward.min_amount) <= 0) return `Gói tri ân #${index + 1}: mức tối thiểu phải lớn hơn 0.`;
      if (Number(reward.quantity_available) < 0) return `Gói tri ân #${index + 1}: số suất không hợp lệ.`;
    }
    return '';
  };

  const next = () => {
    const message = step === 1 ? validateStep1() : validateStep2();
    if (message) {
      setError(message);
      return;
    }
    setError('');
    setStep((s) => s + 1);
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api.post('/projects', {
        title: form.title.trim(),
        description: form.description.trim(),
        category_id: categoryId,
        goal_amount: Number(form.goal_amount),
        start_date: form.start_date,
        end_date: form.end_date,
        cover_emoji: form.cover_emoji,
        cover_image_url: form.cover_image_url.trim() || null,
        rewards: filledRewards.map((r) => ({
          title: r.title.trim(),
          description: r.description.trim() || null,
          min_amount: Number(r.min_amount),
          quantity_available: Number(r.quantity_available),
        })),
      });
      setCreated(data.project);
      await refreshSession();
      toast('Đã gửi dự án, đang chờ quản trị viên duyệt.', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <div className="card p-8 text-center">
          <div className="text-5xl">📨</div>
          <h1 className="mt-3 text-xl font-bold">Đã gửi dự án thành công</h1>
          <p className="mt-1 text-sm text-slate-600">
            “{created.title}” đang ở trạng thái <b>{created.status === 'pending_review' ? 'Chờ duyệt' : created.status}</b>.
            Quản trị viên sẽ xem xét trước khi công khai.
          </p>
          <div className="mt-3 rounded-xl bg-slate-50 p-3 text-left text-sm">
            <div className="flex justify-between gap-2"><span>Mục tiêu</span><b>{vnd(created.goal_amount)}</b></div>
            <div className="flex justify-between gap-2"><span>AI dự đoán thành công</span><b className="text-amber-600">{Math.round(created.ai_success_score)}%</b></div>
            <div className="flex justify-between gap-2"><span>Rủi ro gian lận</span><b>{Math.round(created.fraud_risk_score)}%</b></div>
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link to={`/quan-ly/${created.id}`} className="btn-primary text-sm">Quản lý dự án</Link>
            <Link to="/du-an-cua-toi" className="btn-ghost text-sm">Dự án của tôi</Link>
          </div>
        </div>
        <div className="card p-4 text-xs text-slate-500">
          Dự án chờ duyệt vẫn xem được trong trang quản lý nhưng chưa công khai trên trang khám phá.
        </div>
      </div>
    );
  }

  const preview = {
    title: form.title || 'Tên chiến dịch của bạn',
    cover_emoji: form.cover_emoji,
    cover_image_url: form.cover_image_url,
    category_name: categoryName || 'Danh mục',
    goal_amount: Number(form.goal_amount) || 0,
    current_amount: 0,
    status: 'pending_review',
    fraud_risk_score: 0,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Tạo dự án gây quỹ" subtitle={`Bước ${step}/3 · Dự án sẽ được gửi duyệt trước khi công khai`} />

      <div className="card p-5">
        <div className="flex gap-2 text-sm">
          {[[1, '1. Thông tin'], [2, '2. Mục tiêu & tri ân'], [3, '3. Xem lại']].map(([n, label]) => (
            <span key={n} className={`flex-1 rounded-lg py-1.5 text-center font-medium ${step === n ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}`}>
              {label}
            </span>
          ))}
        </div>
        {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {step === 1 && (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-sm font-semibold">Tên chiến dịch *</label>
                <input className="input mt-1" placeholder="VD: Hồi sinh sông quê — 10km không rác" value={form.title} onChange={set('title')} maxLength={200} />
                <div className="mt-1 text-xs text-slate-400">{form.title.length}/200 ký tự (tối thiểu 10)</div>
              </div>
              <div>
                <label className="text-sm font-semibold">Danh mục *</label>
                <select className="input mt-1" value={categoryId} onChange={set('category_id')}>
                  {categories.length === 0 && <option value="">Đang tải danh mục…</option>}
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-semibold">Biểu tượng dự án</label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className={`rounded-lg border px-2 py-1 text-lg ${form.cover_emoji === emoji ? 'border-emerald-500 bg-emerald-50' : 'bg-white'}`}
                      onClick={() => setForm((f) => ({ ...f, cover_emoji: emoji }))}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm font-semibold">Mô tả chiến dịch *</label>
                <textarea
                  className="input mt-1"
                  rows="6"
                  placeholder="Mục tiêu, đối tượng thụ hưởng, kế hoạch thực hiện, cách sử dụng kinh phí…"
                  value={form.description}
                  onChange={set('description')}
                  maxLength={5000}
                />
                <div className="mt-1 text-xs text-slate-400">{form.description.length}/5000 ký tự (tối thiểu 30)</div>
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm font-semibold">Ảnh bìa (URL, không bắt buộc)</label>
                <input className="input mt-1" placeholder="https://…" value={form.cover_image_url} onChange={set('cover_image_url')} />
              </div>
            </div>
            <div className="flex justify-end">
              <button className="btn-primary text-sm" onClick={next}>Tiếp tục →</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-semibold">Mục tiêu gây quỹ (đ) *</label>
                <input type="number" min="100000" step="100000" className="input mt-1" value={form.goal_amount} onChange={set('goal_amount')} />
                <div className="mt-1 text-xs text-slate-400">{vnd(form.goal_amount)}</div>
              </div>
              <div>
                <label className="text-sm font-semibold">Ngày bắt đầu</label>
                <input type="date" className="input mt-1" value={form.start_date} min={todayISO()} onChange={set('start_date')} />
              </div>
              <div>
                <label className="text-sm font-semibold">Ngày kết thúc *</label>
                <input type="date" className="input mt-1" value={form.end_date} min={form.start_date || todayISO()} onChange={set('end_date')} />
              </div>
            </div>

            <div className="border-t pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-bold">Gói tri ân</h2>
                  <p className="text-xs text-slate-500">Càng nhiều gói nhỏ, càng dễ thu hút nhà tài trợ. Có thể bỏ trống.</p>
                </div>
                <button className="btn-ghost text-sm" onClick={() => setRewards((list) => [...list, blankReward()])}>+ Thêm gói</button>
              </div>
              <div className="mt-2 space-y-2">
                {rewards.map((reward, index) => (
                  <div key={index} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <b className="text-sm">Gói #{index + 1}</b>
                      {rewards.length > 1 && (
                        <button className="text-xs text-red-500 hover:underline" onClick={() => setRewards((list) => list.filter((_, i) => i !== index))}>
                          Xóa
                        </button>
                      )}
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <input
                        className="input sm:col-span-2"
                        placeholder="Tên gói (VD: Thư cảm ơn + áo chiến dịch)"
                        value={reward.title}
                        onChange={(e) => updateReward(index, 'title', e.target.value)}
                      />
                      <input
                        className="input sm:col-span-2"
                        placeholder="Mô tả quà tặng (không bắt buộc)"
                        value={reward.description}
                        onChange={(e) => updateReward(index, 'description', e.target.value)}
                      />
                      <div>
                        <label className="text-xs text-slate-500">Mức tối thiểu (đ)</label>
                        <input
                          type="number"
                          min="1000"
                          step="1000"
                          className="input mt-1"
                          placeholder="100000"
                          value={reward.min_amount}
                          onChange={(e) => updateReward(index, 'min_amount', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">Số suất</label>
                        <input
                          type="number"
                          min="0"
                          className="input mt-1"
                          value={reward.quantity_available}
                          onChange={(e) => updateReward(index, 'quantity_available', e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <AIBox variant={score >= 70 ? 'success' : score >= 50 ? 'info' : 'warn'}>
              AI ước tính khả năng thành công <b>{score}%</b>.{' '}
              {score >= 70
                ? 'Hồ sơ có tín hiệu tốt. Hãy chuẩn bị bản tin cập nhật tuần đầu để giữ đà.'
                : score >= 50
                  ? 'Nên thêm gói tri ân nhỏ, viết mô tả chi tiết hơn và cân nhắc giảm mục tiêu.'
                  : 'Rủi ro cao: mục tiêu lớn hoặc mô tả còn ngắn. Hãy bổ sung gói tri ân và kế hoạch sử dụng kinh phí.'}
            </AIBox>

            <div className="flex justify-between gap-2">
              <button className="btn-ghost flex-1" onClick={() => { setStep(1); setError(''); }}>← Quay lại</button>
              <button className="btn-primary flex-1" onClick={next}>Xem lại →</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mt-4 space-y-4">
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <ProjectCover project={preview} className="h-44" emojiClass="text-6xl" />
              <div className="space-y-2 p-4">
                <span className="badge bg-amber-100 text-amber-700">Chờ duyệt sau khi gửi</span>
                <h2 className="text-lg font-bold">{form.title}</h2>
                <div className="text-sm text-slate-500">{categoryName} · Mục tiêu {vnd(form.goal_amount)}</div>
                <div className="text-xs text-slate-500">{form.start_date} → {form.end_date}</div>
                <p className="whitespace-pre-line text-sm text-slate-600">{form.description}</p>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <b>Gói tri ân ({filledRewards.length})</b>
              {filledRewards.length === 0 && <div className="text-xs text-slate-500">Không có gói tri ân, nhận tài trợ tự do.</div>}
              {filledRewards.map((r, i) => (
                <div key={i} className="mt-1 flex flex-wrap justify-between gap-2 border-b py-1 text-xs last:border-0">
                  <span>{r.title}</span>
                  <span>{vnd(r.min_amount)} · {r.quantity_available} suất</span>
                </div>
              ))}
            </div>

            <AIBox variant={score >= 70 ? 'success' : score >= 50 ? 'info' : 'warn'}>
              AI dự đoán <b>{score}%</b> khả năng thành công. Điểm chính thức sẽ được lưu vào cơ sở dữ liệu khi bạn gửi dự án.
            </AIBox>

            <div className="flex justify-between gap-2">
              <button className="btn-ghost flex-1" onClick={() => { setStep(2); setError(''); }}>← Quay lại</button>
              <button className="btn-primary flex-1 disabled:opacity-60" onClick={submit} disabled={busy}>
                {busy ? <><Spinner className="mr-1 h-3 w-3" /> Đang gửi…</> : 'Gửi duyệt'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="text-center">
        <button className="link text-sm" onClick={() => nav(-1)}>← Quay lại trang trước</button>
      </div>
    </div>
  );
}
