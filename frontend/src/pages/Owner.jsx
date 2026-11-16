import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import {
  EmptyState,
  ErrorState,
  FraudEvidenceCard,
  Loading,
  Modal,
  PageHeader,
  PredictionExplain,
  Progress,
  ProjectCover,
  Spinner,
  StatusBadge,
} from '../components/ui';
import {
  daysLeft,
  formatDate,
  formatDateTime,
  pledgeStatusVi,
  todayISO,
  transactionStatusVi,
  vnd,
} from '../lib/format';
import { parseImageList, readImageFile } from '../lib/images';

// UC06 mời collaborator + UC07 chấp nhận + UC08 sửa/cập nhật + UC12 đóng chiến dịch
// UC17 payout request + UC20 đăng bản tin
export function MyProjects() {
  const { currentUser, refreshSession, toast } = useApp();
  const [data, setData] = useState({ owned: [], collaborating: [], invitations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [reloadTick, setReloadTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/me/projects');
      setData({
        owned: res?.owned || [],
        collaborating: res?.collaborating || [],
        invitations: res?.invitations || [],
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadTick]);

  const handleInvitation = async (projectId, action) => {
    setBusy(projectId);
    try {
      await api.post(`/me/invitations/${projectId}/${action}`);
      toast(action === 'accept' ? 'Đã chấp nhận lời mời cộng tác.' : 'Đã từ chối lời mời.', 'success');
      await Promise.all([load(), refreshSession()]);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const totalProjects = data.owned.length + data.collaborating.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dự án của tôi"
        subtitle={currentUser ? `${currentUser.full_name} · ${totalProjects} dự án đang quản lý` : ''}
        action={
          currentUser?.role !== 'admin' ? (
            <Link to="/tao-du-an" className="btn-primary text-sm">+ Tạo dự án</Link>
          ) : null
        }
      />

      {loading && <Loading text="Đang tải dự án…" />}
      {!loading && error && <ErrorState message={error} onRetry={() => setReloadTick((t) => t + 1)} />}

      {!loading && !error && data.invitations.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold">Lời mời cộng tác ({data.invitations.length})</h2>
          {data.invitations.map((inv) => (
            <div key={inv.id} className="card flex flex-wrap items-center gap-3 border-amber-200 bg-amber-50/50 p-4">
              <span className="text-3xl">{inv.cover_emoji || '📁'}</span>
              <div className="min-w-0 flex-1">
                <b>{inv.title}</b>
                <div className="text-xs text-slate-500">
                  {inv.owner_name} mời bạn làm <b>{inv.collab_role === 'moderator' ? 'quản trị nội dung' : 'biên tập viên'}</b> · {formatDate(inv.invited_at)}
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn-primary text-sm disabled:opacity-60" disabled={busy === inv.id} onClick={() => handleInvitation(inv.id, 'accept')}>
                  {busy === inv.id ? <Spinner className="h-3 w-3" /> : 'Chấp nhận'}
                </button>
                <button className="btn-ghost text-sm disabled:opacity-60" disabled={busy === inv.id} onClick={() => handleInvitation(inv.id, 'decline')}>
                  Từ chối
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {!loading && !error && totalProjects === 0 && (
        <EmptyState
          icon="📁"
          title="Chưa có dự án nào"
          action={<Link to="/tao-du-an" className="btn-primary text-sm">Tạo chiến dịch đầu tiên</Link>}
        >
          Tạo dự án để bắt đầu gây quỹ. Bạn cần xác thực danh tính trước khi tạo.
        </EmptyState>
      )}

      {!loading && !error && data.owned.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold">Dự án tôi sở hữu ({data.owned.length})</h2>
          {data.owned.map((p) => (
            <div key={p.id} className="card flex flex-wrap items-center gap-4 p-4">
              <ProjectCover project={p} className="h-16 w-24 shrink-0" emojiClass="text-2xl" />
              <div className="min-w-52 flex-1">
                <Link to={`/quan-ly/${p.id}`} className="font-bold link">{p.title}</Link>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <StatusBadge status={p.status} />
                  <span className="text-xs text-slate-500">{daysLeft(p.end_date)}</span>
                  <span className="text-xs text-slate-500">{p.backer_count || 0} nhà tài trợ · {p.reward_count || 0} gói</span>
                </div>
                {p.status === 'suspended' && (
                  <p className="mt-1 text-xs text-orange-700">Dự án đang tạm ngưng do tài khoản chủ dự án bị khóa.</p>
                )}
                <div className="mt-2 max-w-md"><Progress project={p} compact /></div>
              </div>
              <div className="flex gap-2">
                <Link to={`/du-an/${p.id}`} className="btn-ghost text-sm">Xem</Link>
                <Link to={`/quan-ly/${p.id}`} className="btn-primary text-sm">Quản lý</Link>
              </div>
            </div>
          ))}
        </section>
      )}

      {!loading && !error && data.collaborating.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold">Dự án tôi cộng tác ({data.collaborating.length})</h2>
          {data.collaborating.map((p) => (
            <div key={p.id} className="card flex flex-wrap items-center gap-4 p-4">
              <ProjectCover project={p} className="h-16 w-24 shrink-0" emojiClass="text-2xl" />
              <div className="min-w-52 flex-1">
                <Link to={`/quan-ly/${p.id}`} className="font-bold link">{p.title}</Link>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <StatusBadge status={p.status} />
                  <span className="badge bg-indigo-100 text-indigo-700">
                    {p.collab_role === 'moderator' ? 'Quản trị nội dung' : 'Biên tập viên'}
                  </span>
                </div>
                {p.status === 'suspended' && (
                  <p className="mt-1 text-xs text-orange-700">Chủ dự án bị khóa tài khoản — mọi thao tác quản lý đang tạm dừng.</p>
                )}
                <div className="mt-2 max-w-md"><Progress project={p} compact /></div>
              </div>
              <Link to={`/quan-ly/${p.id}`} className="btn-primary text-sm">Quản lý</Link>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

const MANAGE_TABS = [
  ['tong-quan', 'Tổng quan'],
  ['tin-tuc', 'Bản tin'],
  ['goi', 'Gói tri ân'],
  ['cong-tac', 'Cộng tác viên'],
  ['tai-chinh', 'Tài chính & nhà tài trợ'],
];

export function ManageProject() {
  const { id } = useParams();
  const nav = useNavigate();
  const { categories, toast, refreshSession } = useApp();
  const [project, setProject] = useState(null);
  const [pledges, setPledges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('tong-quan');
  const [form, setForm] = useState(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [updateForm, setUpdateForm] = useState({ title: '', content: '', images: [] });
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateImageBusy, setUpdateImageBusy] = useState(false);
  const [rewardForm, setRewardForm] = useState({ title: '', description: '', min_amount: '100000', quantity_available: '100' });
  const [rewardBusy, setRewardBusy] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'editor' });
  const [inviteBusy, setInviteBusy] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('1000000');
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [closeOutcome, setCloseOutcome] = useState('successful');
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeBusy, setCloseBusy] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get(`/projects/${id}`);
      setProject(data);
      setForm({
        title: data.title,
        description: data.description,
        category_id: data.category_id,
        goal_amount: String(data.goal_amount),
        start_date: String(data.start_date).slice(0, 10),
        end_date: String(data.end_date).slice(0, 10),
        cover_emoji: data.cover_emoji || '🌱',
        cover_image_url: data.cover_image_url || '',
      });
      if (data.can_manage) {
        const pl = await api.get(`/projects/${id}/pledges`);
        setPledges(pl?.items || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load, reloadTick]);

  if (loading) return <Loading text="Đang tải dự án…" />;
  if (error) return <ErrorState message={error} onRetry={() => setReloadTick((t) => t + 1)} />;
  if (!project) return null;

  if (!project.can_manage) {
    return (
      <div className="card p-8 text-center">
        <div className="text-4xl">⛔</div>
        <b className="mt-2 block">Bạn không có quyền quản lý dự án này</b>
        <p className="mt-1 text-sm text-slate-600">Chỉ chủ dự án hoặc cộng tác viên đã chấp nhận lời mời mới được quản lý.</p>
        <Link to="/du-an-cua-toi" className="link mt-3 inline-block text-sm">← Về danh sách của tôi</Link>
      </div>
    );
  }

  if (project.status === 'suspended') {
    return (
      <div className="space-y-4">
        <PageHeader
          title={project.title}
          subtitle="Dự án đang tạm ngưng"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/du-an/${project.id}`} className="btn-ghost text-sm">Xem công khai</Link>
              <StatusBadge status={project.status} />
            </div>
          }
        />
        <div className="card border-orange-300 bg-orange-50 p-5">
          <h2 className="font-bold text-orange-800">Tạm ngưng do chủ dự án bị khóa tài khoản</h2>
          <p className="mt-1 text-sm text-orange-800">
            Toàn bộ thao tác quản lý dự án đang tạm khóa, bao gồm chỉnh sửa thông tin, đăng bản tin, thay đổi gói tri ân,
            mời hoặc mời ra cộng tác viên, giải ngân và đóng chiến dịch. Bạn vẫn có thể xem dữ liệu và trang công khai của dự án.
          </p>
          <p className="mt-2 text-xs text-orange-700">
            Các thao tác sẽ được mở lại khi quản trị viên mở khóa tài khoản chủ dự án.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to={`/du-an/${project.id}`} className="btn-primary text-sm">Xem trang dự án</Link>
            <Link to="/du-an-cua-toi" className="btn-ghost text-sm">← Về danh sách của tôi</Link>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="card p-4"><div className="text-xs text-slate-500">Đã huy động</div><div className="text-2xl font-bold text-emerald-700">{vnd(project.current_amount)}</div></div>
          <div className="card p-4"><div className="text-xs text-slate-500">Mục tiêu</div><div className="text-2xl font-bold">{vnd(project.goal_amount)}</div></div>
          <div className="card p-4"><div className="text-xs text-slate-500">Nhà tài trợ</div><div className="text-2xl font-bold">{project.backer_count}</div></div>
        </div>
      </div>
    );
  }

  const isOwner = project.my_role === 'owner';
  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const saveProject = async (e) => {
    e?.preventDefault();
    setFormError('');
    if (form.title.trim().length < 10) {
      setFormError('Tên chiến dịch tối thiểu 10 ký tự.');
      return;
    }
    if (form.description.trim().length < 30) {
      setFormError('Mô tả tối thiểu 30 ký tự.');
      return;
    }
    if (isOwner) {
      if (form.start_date < todayISO()) {
        setFormError('Ngày bắt đầu không được ở quá khứ.');
        return;
      }
      if (form.end_date < todayISO()) {
        setFormError('Ngày kết thúc không được ở quá khứ.');
        return;
      }
      if (form.end_date <= form.start_date) {
        setFormError('Ngày kết thúc phải sau ngày bắt đầu.');
        return;
      }
    }
    setFormBusy(true);
    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      cover_emoji: form.cover_emoji || '🌱',
      cover_image_url: form.cover_image_url.trim() || null,
    };
    if (isOwner) {
      payload.category_id = form.category_id;
      payload.goal_amount = Number(form.goal_amount);
      payload.start_date = form.start_date;
      payload.end_date = form.end_date;
    }
    try {
      await api.patch(`/projects/${id}`, payload);
      toast('Đã cập nhật dự án.', 'success');
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setFormBusy(false);
    }
  };

  const pickUpdateImages = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    const room = 6 - updateForm.images.length;
    if (room <= 0) {
      toast('Mỗi bản tin chỉ đính kèm tối đa 6 ảnh.', 'warning');
      return;
    }
    setUpdateImageBusy(true);
    try {
      const added = [];
      for (const file of files.slice(0, room)) {
        const { dataUrl } = await readImageFile(file, { maxBytes: 2 * 1024 * 1024, maxWidth: 1600, maxHeight: 1600 });
        added.push(dataUrl);
      }
      setUpdateForm((value) => ({ ...value, images: [...value.images, ...added] }));
      if (files.length > room) toast(`Chỉ thêm được ${room} ảnh để đủ giới hạn 6 ảnh.`, 'warning');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUpdateImageBusy(false);
    }
  };

  const postUpdate = async (e) => {
    e?.preventDefault();
    if (updateForm.title.trim().length < 3 || updateForm.content.trim().length < 10) {
      toast('Tiêu đề tối thiểu 3 ký tự và nội dung tối thiểu 10 ký tự.', 'warning');
      return;
    }
    setUpdateBusy(true);
    try {
      const data = await api.post(`/projects/${id}/updates`, {
        title: updateForm.title.trim(),
        content: updateForm.content.trim(),
        image_urls: updateForm.images,
      });
      setProject((p) => ({ ...p, updates: [data.update, ...p.updates] }));
      setUpdateForm({ title: '', content: '', images: [] });
      toast('Đã đăng bản tin, người theo dõi sẽ nhận thông báo.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUpdateBusy(false);
    }
  };

  const addReward = async (e) => {
    e?.preventDefault();
    if (rewardForm.title.trim().length < 3) {
      toast('Tên gói tối thiểu 3 ký tự.', 'warning');
      return;
    }
    if (Number(rewardForm.min_amount) <= 0) {
      toast('Mức tối thiểu phải lớn hơn 0.', 'warning');
      return;
    }
    setRewardBusy(true);
    try {
      const data = await api.post(`/projects/${id}/rewards`, {
        title: rewardForm.title.trim(),
        description: rewardForm.description.trim() || null,
        min_amount: Number(rewardForm.min_amount),
        quantity_available: Number(rewardForm.quantity_available),
      });
      setProject((p) => ({ ...p, rewards: [...p.rewards, data.reward] }));
      setRewardForm({ title: '', description: '', min_amount: '100000', quantity_available: '100' });
      toast('Đã thêm gói tri ân.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRewardBusy(false);
    }
  };

  const deleteReward = async (reward) => {
    if (!window.confirm(`Xóa gói “${reward.title}”?`)) return;
    try {
      await api.del(`/projects/${id}/rewards/${reward.id}`);
      setProject((p) => ({ ...p, rewards: p.rewards.filter((r) => r.id !== reward.id) }));
      toast('Đã xóa gói tri ân.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const invite = async (e) => {
    e?.preventDefault();
    if (!inviteForm.email.trim()) return;
    setInviteBusy(true);
    try {
      const data = await api.post(`/projects/${id}/collaborators`, {
        email: inviteForm.email.trim(),
        role: inviteForm.role,
      });
      setProject((p) => ({ ...p, collaborators: [...p.collaborators, data.invitation] }));
      setInviteForm({ email: '', role: 'editor' });
      toast('Đã gửi lời mời cộng tác.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setInviteBusy(false);
    }
  };

  const removeCollaborator = async (userId) => {
    if (!window.confirm('Mời cộng tác viên này ra khỏi dự án? Chủ dự án, các cộng tác viên còn lại, quản trị viên và nhà tài trợ sẽ được thông báo.')) return;
    try {
      await api.del(`/projects/${id}/collaborators/${userId}`);
      setProject((p) => ({ ...p, collaborators: p.collaborators.filter((c) => c.user_id !== userId) }));
      toast('Đã mời cộng tác viên ra khỏi dự án.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const leaveProject = async () => {
    if (!window.confirm('Bạn có chắc chắn muốn rời dự án này? Chủ dự án, các cộng tác viên còn lại, quản trị viên và nhà tài trợ sẽ được thông báo.')) return;
    setLeaveBusy(true);
    try {
      const data = await api.del(`/projects/${id}/collaborators/me`);
      toast(data?.message || 'Đã rời dự án.', 'success');
      await refreshSession();
      nav('/du-an-cua-toi');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLeaveBusy(false);
    }
  };

  const requestPayout = async (e) => {
    e?.preventDefault();
    setPayoutBusy(true);
    try {
      const data = await api.post(`/projects/${id}/payouts`, { amount: Number(payoutAmount) });
      toast(data.message || 'Đã gửi yêu cầu giải ngân.', 'success');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setPayoutBusy(false);
    }
  };

  const closeProject = async () => {
    setCloseBusy(true);
    try {
      await api.post(`/projects/${id}/close`, { outcome: closeOutcome });
      setCloseOpen(false);
      toast('Đã cập nhật trạng thái chiến dịch.', 'success');
      await Promise.all([load(), refreshSession()]);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setCloseBusy(false);
    }
  };

  const canClose = isOwner && ['active', 'pending_review', 'draft'].includes(project.status);
  const preview = { ...project, ...form };

  return (
    <div className="space-y-4">
      <PageHeader
        title={project.title}
        subtitle={`${isOwner ? 'Chủ dự án' : 'Cộng tác viên'} · ${daysLeft(project.end_date)}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/du-an/${project.id}`} className="btn-ghost text-sm">Xem công khai</Link>
            {!isOwner && (
              <button
                className="btn-ghost border-red-300 text-sm text-red-700 disabled:opacity-60"
                disabled={leaveBusy}
                onClick={leaveProject}
              >
                {leaveBusy ? <><Spinner className="mr-1 h-3 w-3" /> Đang rời…</> : 'Rời dự án'}
              </button>
            )}
            <StatusBadge status={project.status} />
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {MANAGE_TABS.map(([key, label]) => (
          <button
            key={key}
            className={`rounded-xl px-3 py-1.5 text-sm font-medium ${tab === key ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'tong-quan' && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-4 md:col-span-2">
            <form className="card space-y-3 p-5" onSubmit={saveProject}>
              <h2 className="font-bold">Chỉnh sửa thông tin</h2>
              {!isOwner && (
                <div className="rounded-xl bg-slate-50 p-2 text-xs text-slate-500">
                  Cộng tác viên chỉ được sửa tên, mô tả, ảnh và biểu tượng. Danh mục, mục tiêu, thời gian do chủ dự án quản lý.
                </div>
              )}
              <div>
                <label className="text-xs font-semibold">Tên chiến dịch</label>
                <input className="input mt-1" value={form.title} onChange={setField('title')} />
              </div>
              <div>
                <label className="text-xs font-semibold">Mô tả</label>
                <textarea className="input mt-1" rows="5" value={form.description} onChange={setField('description')} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold">Biểu tượng</label>
                  <input className="input mt-1" value={form.cover_emoji} onChange={setField('cover_emoji')} maxLength={8} />
                </div>
                <div>
                  <label className="text-xs font-semibold">Ảnh bìa (URL)</label>
                  <input className="input mt-1" value={form.cover_image_url} onChange={setField('cover_image_url')} placeholder="https://…" />
                </div>
                {isOwner && (
                  <>
                    <div>
                      <label className="text-xs font-semibold">Danh mục</label>
                      <select className="input mt-1" value={form.category_id} onChange={setField('category_id')}>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold">Mục tiêu (đ)</label>
                      <input type="number" min="100000" className="input mt-1" value={form.goal_amount} onChange={setField('goal_amount')} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold">Ngày bắt đầu</label>
                      <input type="date" className="input mt-1" min={todayISO()} value={form.start_date} onChange={setField('start_date')} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold">Ngày kết thúc</label>
                      <input type="date" className="input mt-1" min={form.start_date || todayISO()} value={form.end_date} onChange={setField('end_date')} />
                    </div>
                  </>
                )}
              </div>
              {formError && <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-sm text-red-700">{formError}</div>}
              <button className="btn-primary text-sm disabled:opacity-60" type="submit" disabled={formBusy}>
                {formBusy ? <><Spinner className="mr-1 h-3 w-3" /> Đang lưu…</> : 'Lưu thay đổi'}
              </button>
            </form>

            <div className="card p-5">
              <h2 className="font-bold">Xem trước</h2>
              <div className="mt-2 flex gap-3">
                <ProjectCover project={preview} className="h-20 w-28 shrink-0" emojiClass="text-3xl" />
                <div className="min-w-0">
                  <b>{preview.title}</b>
                  <div className="mt-1"><Progress project={{ ...preview, current_amount: project.current_amount }} compact /></div>
                  <div className="mt-1 text-xs text-slate-500">{formatDate(preview.start_date)} → {formatDate(preview.end_date)}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card p-5">
              <h2 className="font-bold">Tình hình chiến dịch</h2>
              <div className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Trạng thái</span><StatusBadge status={project.status} /></div>
                <div className="flex justify-between"><span className="text-slate-500">Đã huy động</span><b>{vnd(project.current_amount)}</b></div>
                <div className="flex justify-between"><span className="text-slate-500">Mục tiêu</span><b>{vnd(project.goal_amount)}</b></div>
                <div className="flex justify-between"><span className="text-slate-500">Nhà tài trợ</span><b>{project.backer_count}</b></div>
                <div className="flex justify-between"><span className="text-slate-500">Theo dõi</span><b>{project.follower_count}</b></div>
                <div className="flex justify-between"><span className="text-slate-500">Còn lại</span><b>{daysLeft(project.end_date)}</b></div>
              </div>
              <div className="mt-3"><Progress project={project} compact /></div>
            </div>

            <PredictionExplain prediction={project.prediction} fallbackScore={project.ai_success_score} compact />

            <FraudEvidenceCard
              flags={project.fraud_flags}
              riskScore={project.fraud_risk_score}
              title="Kiểm chứng gian lận"
            />

            {isOwner && (
              <div className="card border-red-200 p-5">
                <h2 className="font-bold text-red-700">Đóng chiến dịch</h2>
                <p className="mt-1 text-xs text-slate-500">Chỉ chủ dự án được đóng. Dự án thất bại đã đóng có thể được admin hoàn tiền.</p>
                <select className="input mt-2" value={closeOutcome} onChange={(e) => setCloseOutcome(e.target.value)}>
                  <option value="successful">Thành công</option>
                  <option value="failed">Thất bại</option>
                  <option value="canceled">Đã dừng</option>
                </select>
                <button className="btn-ghost mt-2 w-full border-red-300 text-sm text-red-700 disabled:opacity-50" disabled={!canClose} onClick={() => setCloseOpen(true)}>
                  {canClose ? 'Đóng chiến dịch' : 'Chiến dịch đã kết thúc'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'tin-tuc' && (
        <div className="grid gap-4 md:grid-cols-3">
          <form className="card space-y-3 p-5" onSubmit={postUpdate}>
            <h2 className="font-bold">Đăng bản tin tiến độ</h2>
            <div>
              <label className="text-xs font-semibold">Tiêu đề</label>
              <input className="input mt-1" placeholder="VD: Đã dọn 3km đầu tiên" value={updateForm.title} onChange={(e) => setUpdateForm({ ...updateForm, title: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-semibold">Nội dung</label>
              <textarea className="input mt-1" rows="5" placeholder="Cập nhật kết quả, hình ảnh, cảm ơn nhà tài trợ…" value={updateForm.content} onChange={(e) => setUpdateForm({ ...updateForm, content: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-semibold">Hình ảnh đính kèm (tối đa 6)</label>
              <input
                type="file"
                accept="image/jpeg,image/png"
                multiple
                className="input mt-1 text-xs"
                onChange={pickUpdateImages}
                disabled={updateImageBusy || updateForm.images.length >= 6}
              />
              {updateImageBusy && <p className="mt-1 text-xs text-slate-500"><Spinner className="mr-1 h-3 w-3" /> Đang nén ảnh…</p>}
              {updateForm.images.length > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {updateForm.images.map((src, index) => (
                    <div key={`${index}-${src.slice(-16)}`} className="relative">
                      <img src={src} alt={`Ảnh đính kèm ${index + 1}`} className="h-20 w-full rounded-lg border object-cover" />
                      <button
                        type="button"
                        className="absolute right-1 top-1 rounded-full bg-white/95 px-1.5 text-xs font-bold text-red-600 shadow"
                        onClick={() => setUpdateForm((value) => ({ ...value, images: value.images.filter((_, i) => i !== index) }))}
                        aria-label="Xóa ảnh"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-1 text-[11px] text-slate-500">Ảnh JPEG/PNG, tự động nén tối đa 2MB mỗi ảnh.</p>
            </div>
            <button className="btn-primary w-full text-sm disabled:opacity-60" type="submit" disabled={updateBusy || updateImageBusy}>
              {updateBusy ? <><Spinner className="mr-1 h-3 w-3" /> Đang đăng…</> : 'Đăng bản tin'}
            </button>
            <p className="text-xs text-slate-500">Người theo dõi, nhà tài trợ và cộng tác viên sẽ nhận thông báo.</p>
          </form>

          <div className="card space-y-2 p-5 md:col-span-2">
            <h2 className="font-bold">Bản tin đã đăng ({project.updates.length})</h2>
            {project.updates.length === 0 && <p className="text-sm text-slate-500">Chưa có bản tin nào.</p>}
            {project.updates.map((u) => {
              const images = parseImageList(u.image_urls);
              return (
                <div key={u.id} className="rounded-xl border border-slate-200 p-3">
                  <b>{u.title}</b>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{u.content}</p>
                  {images.length > 0 && (
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {images.map((src, index) => (
                        <a key={`${u.id}-${index}`} href={src} target="_blank" rel="noreferrer">
                          <img src={src} alt={`${u.title} - ảnh ${index + 1}`} className="h-24 w-full rounded-lg border object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 text-xs text-slate-400">{u.author_name || 'Ban tổ chức'} · {formatDateTime(u.created_at)}</div>
                </div>
              );
            })}
            <div className="border-t pt-3">
              <h3 className="text-sm font-bold">Bình luận gần đây ({project.comments.length})</h3>
              {project.comments.slice(-5).reverse().map((c) => (
                <div key={c.id} className="border-b py-1 text-sm last:border-0">
                  <b>{c.user_name}</b>
                  {c.user_role === 'collaborator' && <span className="badge ml-1 bg-indigo-100 text-indigo-700">Cộng tác viên</span>}
                  {c.user_role === 'owner' && <span className="badge ml-1 bg-emerald-100 text-emerald-700">Chủ dự án</span>}
                  : {c.content}
                </div>
              ))}
              <Link to={`/du-an/${project.id}`} className="link mt-2 inline-block text-xs">Trả lời trên trang dự án →</Link>
            </div>
          </div>
        </div>
      )}

      {tab === 'goi' && (
        <div className="grid gap-4 md:grid-cols-3">
          {isOwner ? (
            <form className="card space-y-3 p-5" onSubmit={addReward}>
              <h2 className="font-bold">Thêm gói tri ân</h2>
              <input className="input" placeholder="Tên gói" value={rewardForm.title} onChange={(e) => setRewardForm({ ...rewardForm, title: e.target.value })} />
              <textarea className="input" rows="2" placeholder="Mô tả quà tặng" value={rewardForm.description} onChange={(e) => setRewardForm({ ...rewardForm, description: e.target.value })} />
              <div>
                <label className="text-xs font-semibold">Mức tối thiểu (đ)</label>
                <input type="number" min="1000" step="1000" className="input mt-1" value={rewardForm.min_amount} onChange={(e) => setRewardForm({ ...rewardForm, min_amount: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-semibold">Số suất</label>
                <input type="number" min="0" className="input mt-1" value={rewardForm.quantity_available} onChange={(e) => setRewardForm({ ...rewardForm, quantity_available: e.target.value })} />
              </div>
              <button className="btn-primary w-full text-sm disabled:opacity-60" type="submit" disabled={rewardBusy}>
                {rewardBusy ? <><Spinner className="mr-1 h-3 w-3" /> Đang thêm…</> : 'Thêm gói'}
              </button>
            </form>
          ) : (
            <div className="card space-y-2 p-5">
              <h2 className="font-bold">Gói tri ân</h2>
              <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                Chỉ chủ dự án được thêm, sửa hoặc xóa gói tri ân. Cộng tác viên vẫn có thể xem danh sách gói bên cạnh.
              </p>
            </div>
          )}

          <div className="card space-y-2 p-5 md:col-span-2">
            <h2 className="font-bold">Gói hiện tại ({project.rewards.length})</h2>
            {project.rewards.length === 0 && <p className="text-sm text-slate-500">Chưa có gói tri ân.</p>}
            {project.rewards.map((r) => (
              <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-slate-200 p-3">
                <div className="min-w-0">
                  <b>{r.title}</b>
                  {r.description && <div className="text-xs text-slate-500">{r.description}</div>}
                  <div className="mt-1 text-xs text-slate-500">Tối thiểu {vnd(r.min_amount)} · đã nhận {r.quantity_claimed}/{r.quantity_available}</div>
                </div>
                {isOwner && (
                  <button className="text-xs text-red-500 hover:underline disabled:opacity-40" disabled={r.quantity_claimed > 0} title={r.quantity_claimed > 0 ? 'Không thể xóa gói đã có người nhận' : 'Xóa gói'} onClick={() => deleteReward(r)}>
                    Xóa
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'cong-tac' && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="card space-y-3 p-5">
            <h2 className="font-bold">Mời cộng tác viên</h2>
            {isOwner ? (
              <form className="space-y-2" onSubmit={invite}>
                <input className="input" type="email" placeholder="Email người được mời" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} />
                <select className="input" value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}>
                  <option value="editor">Biên tập viên</option>
                  <option value="moderator">Quản trị nội dung</option>
                </select>
                <button className="btn-primary w-full text-sm disabled:opacity-60" type="submit" disabled={inviteBusy}>
                  {inviteBusy ? <><Spinner className="mr-1 h-3 w-3" /> Đang gửi…</> : 'Gửi lời mời'}
                </button>
                <p className="text-xs text-slate-500">Người được mời cần có tài khoản trên nền tảng và sẽ nhận thông báo trong ứng dụng.</p>
              </form>
            ) : (
              <p className="text-sm text-slate-500">🔒 Chỉ chủ dự án được mời cộng tác viên.</p>
            )}
          </div>

          <div className="card space-y-2 p-5 md:col-span-2">
            <h2 className="font-bold">Cộng tác viên ({project.collaborators.length})</h2>
            {project.collaborators.length === 0 && <p className="text-sm text-slate-500">Chưa có cộng tác viên.</p>}
            {project.collaborators.map((c) => (
              <div key={c.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 text-sm">
                <div>
                  <b>{c.full_name}</b>
                  <div className="text-xs text-slate-500">{c.email} · {c.role === 'moderator' ? 'Quản trị nội dung' : 'Biên tập viên'}</div>
                  <div className="text-xs text-slate-400">
                    {c.accepted_at ? `Đã chấp nhận ${formatDate(c.accepted_at)}` : `Đang chờ chấp nhận · mời ${formatDate(c.invited_at)}`}
                  </div>
                </div>
                {isOwner && (
                  <button className="text-xs text-red-500 hover:underline" onClick={() => removeCollaborator(c.user_id)}>Mời ra</button>
                )}
              </div>
            ))}
          </div>

          {!isOwner && (
            <div className="card border-red-200 p-5 md:col-span-3">
              <h2 className="font-bold text-red-700">Rời dự án cộng tác</h2>
              <p className="mt-1 text-xs text-slate-500">
                Khi bạn rời dự án, chủ dự án, quản trị viên và toàn bộ nhà tài trợ sẽ nhận được thông báo.
              </p>
              <button
                className="btn-ghost mt-2 border-red-300 text-sm text-red-700 disabled:opacity-60"
                disabled={leaveBusy}
                onClick={leaveProject}
              >
                {leaveBusy ? <><Spinner className="mr-1 h-3 w-3" /> Đang rời…</> : 'Rời dự án'}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'tai-chinh' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="card p-4"><div className="text-xs text-slate-500">Đã huy động</div><div className="text-2xl font-bold text-emerald-700">{vnd(project.current_amount)}</div></div>
            <div className="card p-4"><div className="text-xs text-slate-500">Khả dụng để giải ngân</div><div className="text-2xl font-bold">{vnd(project.available_for_payout)}</div></div>
            <div className="card p-4"><div className="text-xs text-slate-500">Nhà tài trợ</div><div className="text-2xl font-bold">{project.backer_count}</div></div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {isOwner && (
              <form className="card space-y-3 p-5" onSubmit={requestPayout}>
                <h2 className="font-bold">Yêu cầu giải ngân</h2>
                <p className="text-xs text-slate-500">Tối đa {vnd(project.available_for_payout)}. Admin sẽ duyệt trước khi chuyển tiền.</p>
                <input type="number" min="100000" className="input" value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} />
                <button className="btn-primary w-full text-sm disabled:opacity-60" type="submit" disabled={payoutBusy || project.available_for_payout <= 0}>
                  {payoutBusy ? <><Spinner className="mr-1 h-3 w-3" /> Đang gửi…</> : 'Gửi yêu cầu'}
                </button>
              </form>
            )}

            <div className={`card space-y-2 p-5 ${isOwner ? 'md:col-span-2' : 'md:col-span-3'}`}>
              <h2 className="font-bold">Lịch sử giải ngân</h2>
              {project.payouts.length === 0 && <p className="text-sm text-slate-500">Chưa có yêu cầu giải ngân.</p>}
              {project.payouts.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0">
                  <div>
                    <b>{vnd(t.amount)}</b>
                    <div className="text-xs text-slate-500">{t.gateway_ref} · {formatDate(t.created_at)}</div>
                  </div>
                  <span className={`badge ${t.status === 'success' ? 'bg-emerald-100 text-emerald-700' : t.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                    {transactionStatusVi[t.status] || t.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">Nhà tài trợ ({pledges.length})</h2>
              <button className="btn-ghost text-xs" onClick={load}>Làm mới</button>
            </div>
            {pledges.length === 0 && <p className="mt-2 text-sm text-slate-500">Chưa có khoản tài trợ nào.</p>}
            {pledges.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr className="border-b">
                      <th className="py-2">Nhà tài trợ</th>
                      <th className="py-2">Số tiền</th>
                      <th className="py-2">Gói</th>
                      <th className="py-2">Trạng thái</th>
                      <th className="py-2">Thời gian</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pledges.map((p) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-2">
                          <div className="font-medium">{p.backer_name}</div>
                          <div className="text-xs text-slate-500">{p.backer_email || 'Ẩn danh'}</div>
                        </td>
                        <td className="py-2 font-semibold">{vnd(p.amount)}</td>
                        <td className="py-2 text-xs">{p.reward_title || 'Tự do'}</td>
                        <td className="py-2">
                          <span className={`badge ${p.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : p.status === 'refunded' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                            {pledgeStatusVi[p.status] || p.status}
                          </span>
                        </td>
                        <td className="py-2 text-xs text-slate-500">{formatDateTime(p.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <Modal
        open={closeOpen}
        title="Xác nhận đóng chiến dịch"
        onClose={() => setCloseOpen(false)}
        footer={
          <>
            <button className="btn-ghost text-sm" onClick={() => setCloseOpen(false)}>Hủy</button>
            <button className="btn-primary text-sm disabled:opacity-60" disabled={closeBusy} onClick={closeProject}>
              {closeBusy ? <><Spinner className="mr-1 h-3 w-3" /> Đang xử lý…</> : 'Xác nhận đóng'}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Chiến dịch sẽ chuyển sang trạng thái{' '}
          <b>{closeOutcome === 'successful' ? 'Thành công' : closeOutcome === 'failed' ? 'Thất bại' : 'Đã dừng'}</b>.
          Nhà tài trợ và người theo dõi sẽ nhận thông báo.
        </p>
      </Modal>
    </div>
  );
}
