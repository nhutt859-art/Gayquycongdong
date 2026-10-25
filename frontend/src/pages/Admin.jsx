import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import {
  AIBox,
  EmptyState,
  ErrorState,
  Loading,
  Modal,
  Spinner,
  StatCard,
} from '../components/ui';
import {
  compactMoney,
  formatDate,
  formatDateTime,
  kycVi,
  roleVi,
  transactionStatusVi,
  vnd,
} from '../lib/format';

const TABS = [
  ['tong-quan', 'Tổng quan'],
  ['duyet-du-an', 'Duyệt dự án'],
  ['giai-ngan', 'Giải ngân'],
  ['gian-lan', 'Gian lận & báo cáo'],
  ['nguoi-dung', 'Người dùng'],
  ['danh-muc', 'Danh mục'],
];

function Shell({ tab, children }) {
  return (
    <div className="grid gap-4 md:grid-cols-5">
      <div className="card h-fit space-y-1 p-2">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            to={`/admin/${key}`}
            className={`block rounded-xl px-3 py-2 text-sm font-medium ${tab === key ? 'bg-slate-800 text-white' : 'hover:bg-slate-100'}`}
          >
            {label}
          </Link>
        ))}
        <Link to="/" className="mt-1 block rounded-xl px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100">← Về trang chủ</Link>
      </div>
      <div className="space-y-4 md:col-span-4">{children}</div>
    </div>
  );
}

export function Admin({ tab = 'tong-quan' }) {
  const navigate = useNavigate();
  const { toast, refreshCategories } = useApp();
  const activeTab = TABS.some(([key]) => key === tab) ? tab : 'tong-quan';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [busy, setBusy] = useState('');
  const [stats, setStats] = useState(null);
  const [pendingProjects, setPendingProjects] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [flags, setFlags] = useState([]);
  const [reports, setReports] = useState([]);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [newCategory, setNewCategory] = useState({ name: '', description: '' });
  const [editingCategory, setEditingCategory] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (activeTab === 'tong-quan') {
        setStats(await api.get('/admin/stats'));
      } else if (activeTab === 'duyet-du-an') {
        const data = await api.get('/admin/projects?status=pending_review');
        setPendingProjects(data?.items || []);
      } else if (activeTab === 'giai-ngan') {
        const data = await api.get('/admin/payouts');
        setPayouts(data?.items || []);
      } else if (activeTab === 'gian-lan') {
        const [f, r] = await Promise.all([api.get('/admin/fraud-flags'), api.get('/admin/reports')]);
        setFlags(f?.items || []);
        setReports(r?.items || []);
      } else if (activeTab === 'nguoi-dung') {
        const data = await api.get('/admin/users');
        setUsers(data?.items || []);
      } else if (activeTab === 'danh-muc') {
        const data = await api.get('/admin/categories');
        setCategories(data?.items || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    load();
  }, [load, reloadTick]);

  const refresh = () => setReloadTick((t) => t + 1);

  const approveProject = async (project) => {
    setBusy(project.id);
    try {
      await api.post(`/admin/projects/${project.id}/approve`);
      toast(`Đã duyệt công khai “${project.title}”.`, 'success');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const rejectProject = async () => {
    if (!rejectTarget) return;
    if (rejectReason.trim().length < 5) {
      toast('Vui lòng nhập lý do từ chối tối thiểu 5 ký tự.', 'warning');
      return;
    }
    setBusy(rejectTarget.id);
    try {
      await api.post(`/admin/projects/${rejectTarget.id}/reject`, { reason: rejectReason.trim() });
      toast(`Đã từ chối “${rejectTarget.title}”.`, 'success');
      setRejectTarget(null);
      setRejectReason('');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const reviewPayout = async (payout, action) => {
    setBusy(payout.id);
    try {
      await api.post(`/admin/payouts/${payout.id}/${action}`);
      toast(action === 'approve' ? 'Đã duyệt giải ngân.' : 'Đã từ chối giải ngân.', 'success');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const reviewFlag = async (flag, status) => {
    if (status === 'confirmed' && !window.confirm('Xác nhận gian lận sẽ tạm khóa dự án/tài khoản hoặc đánh dấu giao dịch thất bại. Tiếp tục?')) return;
    setBusy(flag.id);
    try {
      await api.patch(`/admin/fraud-flags/${flag.id}`, { review_status: status });
      toast(status === 'confirmed' ? 'Đã xác nhận và xử lý.' : 'Đã đánh dấu báo nhầm.', 'success');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const updateReport = async (report, status) => {
    setBusy(report.id);
    try {
      await api.patch(`/admin/reports/${report.id}`, { status });
      toast('Đã cập nhật trạng thái báo cáo.', 'success');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const toggleUser = async (user) => {
    const next = user.status === 'active' ? 'locked' : 'active';
    if (next === 'locked' && !window.confirm(`Khóa tài khoản ${user.email}?`)) return;
    setBusy(user.id);
    try {
      await api.patch(`/admin/users/${user.id}/status`, { status: next });
      toast(next === 'locked' ? 'Đã khóa tài khoản.' : 'Đã mở khóa tài khoản.', 'success');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const addCategory = async (e) => {
    e?.preventDefault();
    if (newCategory.name.trim().length < 2) {
      toast('Tên danh mục tối thiểu 2 ký tự.', 'warning');
      return;
    }
    setBusy('new-category');
    try {
      await api.post('/admin/categories', {
        name: newCategory.name.trim(),
        description: newCategory.description.trim() || null,
      });
      setNewCategory({ name: '', description: '' });
      toast('Đã thêm danh mục.', 'success');
      await Promise.all([load(), refreshCategories()]);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const saveCategory = async (category) => {
    if (!editingCategory?.name?.trim()) return;
    setBusy(category.id);
    try {
      await api.patch(`/admin/categories/${category.id}`, {
        name: editingCategory.name.trim(),
        description: editingCategory.description?.trim() || null,
      });
      setEditingCategory(null);
      toast('Đã cập nhật danh mục.', 'success');
      await Promise.all([load(), refreshCategories()]);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const deleteCategory = async (category) => {
    if (!window.confirm(`Xóa danh mục “${category.name}”?`)) return;
    setBusy(category.id);
    try {
      await api.del(`/admin/categories/${category.id}`);
      toast('Đã xóa danh mục.', 'success');
      await Promise.all([load(), refreshCategories()]);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const chartMax = Math.max(1, ...(stats?.chart || []).map((d) => Number(d.amount)));
  const filteredUsers = users.filter(
    (u) =>
      !userSearch.trim() ||
      u.full_name.toLowerCase().includes(userSearch.trim().toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.trim().toLowerCase()),
  );

  return (
    <Shell tab={activeTab}>
      {loading && <Loading text="Đang tải dữ liệu quản trị…" />}
      {!loading && error && <ErrorState message={error} onRetry={refresh} />}

      {!loading && !error && activeTab === 'tong-quan' && stats && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Tổng huy động" value={compactMoney(stats.total_raised)} tone="emerald" hint={vnd(stats.total_raised)} />
            <StatCard label="Dự án đang gây quỹ" value={stats.active_projects} hint={`${stats.total_projects} dự án tổng cộng`} />
            <StatCard label="Tỉ lệ thành công" value={`${stats.success_rate}%`} hint={`${stats.successful_projects} thành công / ${stats.failed_projects} thất bại`} />
            <StatCard label="Cảnh báo gian lận mở" value={stats.open_flags} tone={stats.open_flags ? 'red' : 'emerald'} hint={`${stats.open_reports} báo cáo đang mở`} />
            <StatCard label="Người dùng hoạt động" value={stats.active_users} />
            <StatCard label="Khoản tài trợ đã trả" value={stats.paid_pledges} />
            <StatCard label="Báo cáo chờ xử lý" value={stats.open_reports} tone={stats.open_reports ? 'amber' : 'default'} />
            <StatCard label="Dự án chờ duyệt" value={stats.pending_projects} hint="Xem tab Duyệt dự án" />
          </div>

          <div className="card p-4">
            <b className="text-sm">Tốc độ tài trợ 7 ngày qua</b>
            <div className="mt-3 flex h-32 items-end gap-2">
              {(stats.chart || []).map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                  <div className="text-[10px] text-slate-500">{d.pledges} lượt</div>
                  <div
                    className="w-full rounded-t bg-emerald-500"
                    style={{ height: `${Math.max(4, (Number(d.amount) / chartMax) * 88)}px` }}
                    title={`${d.day}: ${vnd(d.amount)} · ${d.pledges} lượt`}
                  />
                  <div className="text-[10px] text-slate-400">{formatDate(d.day).slice(0, 5)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="card p-4">
              <b className="text-sm">Top danh mục theo số tiền</b>
              <div className="mt-2 space-y-2">
                {(stats.top_categories || []).map((c) => (
                  <div key={c.name}>
                    <div className="flex justify-between text-sm"><span>{c.name}</span><b>{vnd(c.total)}</b></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${Math.max(2, (Number(c.total) / Math.max(1, Number(stats.total_raised))) * 100)}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-slate-400">{c.projects} dự án</div>
                  </div>
                ))}
              </div>
            </div>
            <AIBox variant="info" title="✨ AI ĐIỀU HÀNH">
              Hệ thống đang theo dõi {stats.total_projects} dự án và {stats.paid_pledges} giao dịch đã thanh toán.
              {stats.open_flags > 0
                ? ` Có ${stats.open_flags} cảnh báo gian lận cần xác minh — ưu tiên xử lý các cảnh báo rủi ro cao.`
                : ' Chưa có cảnh báo gian lận nào đang mở.'}
              <div className="mt-2 text-xs text-slate-500">Điểm AI được tính heuristic từ mục tiêu, danh mục, mô tả và hành vi giao dịch.</div>
            </AIBox>
          </div>
        </>
      )}

      {!loading && !error && activeTab === 'duyet-du-an' && (
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold">Dự án chờ duyệt ({pendingProjects.length})</h1>
            <button className="btn-ghost text-sm" onClick={refresh}>Làm mới</button>
          </div>
          {pendingProjects.length === 0 && <EmptyState icon="✅" title="Không còn dự án chờ duyệt">Mọi dự án đã được xử lý.</EmptyState>}
          {pendingProjects.map((p) => (
            <div key={p.id} className="card flex flex-wrap items-center gap-3 p-4">
              <span className="text-3xl">{p.cover_emoji || '📁'}</span>
              <div className="min-w-52 flex-1">
                <Link to={`/du-an/${p.id}`} className="font-bold link">{p.title}</Link>
                <div className="text-xs text-slate-500">
                  {p.owner_name} · {p.owner_email} · {p.category_name}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                  <span className="badge bg-slate-100">Mục tiêu {vnd(p.goal_amount)}</span>
                  <span className="badge bg-amber-100 text-amber-700">AI thành công {Math.round(p.ai_success_score)}%</span>
                  <span className={`badge ${Number(p.fraud_risk_score) >= 60 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                    Rủi ro {Math.round(p.fraud_risk_score)}%
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost text-sm" onClick={() => navigate(`/du-an/${p.id}`)}>Xem hồ sơ</button>
                <button className="btn-primary text-sm disabled:opacity-60" disabled={busy === p.id} onClick={() => approveProject(p)}>
                  {busy === p.id ? <Spinner className="h-3 w-3" /> : 'Duyệt công khai'}
                </button>
                <button className="btn-ghost border-red-300 text-sm text-red-700" onClick={() => { setRejectTarget(p); setRejectReason(''); }}>
                  Từ chối
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {!loading && !error && activeTab === 'giai-ngan' && (
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold">Yêu cầu giải ngân</h1>
            <button className="btn-ghost text-sm" onClick={refresh}>Làm mới</button>
          </div>
          {payouts.length === 0 && <EmptyState icon="🏦" title="Chưa có yêu cầu giải ngân" />}
          {payouts.map((p) => (
            <div key={p.id} className="card flex flex-wrap items-center gap-3 p-4 text-sm">
              <div className="min-w-52 flex-1">
                <b>{p.project_title}</b>
                <div className="text-xs text-slate-500">{p.owner_name} · {p.owner_email}</div>
                <div className="mt-1 text-xs text-slate-500">
                  Số tiền <b className="text-slate-700">{vnd(p.amount)}</b> · Dự án đã huy động {vnd(p.current_amount)} · {formatDate(p.created_at)}
                </div>
                <div className="text-[11px] text-slate-400">{p.gateway_ref}</div>
              </div>
              <span className={`badge ${p.status === 'success' ? 'bg-emerald-100 text-emerald-700' : p.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                {transactionStatusVi[p.status] || p.status}
              </span>
              {p.status === 'pending' && (
                <div className="flex gap-2">
                  <button className="btn-primary text-sm disabled:opacity-60" disabled={busy === p.id} onClick={() => reviewPayout(p, 'approve')}>Duyệt</button>
                  <button className="btn-ghost border-red-300 text-sm text-red-700 disabled:opacity-60" disabled={busy === p.id} onClick={() => reviewPayout(p, 'reject')}>Từ chối</button>
                </div>
              )}
            </div>
          ))}
          <div className="card p-4 text-xs text-slate-500">
            Dự án thất bại hoặc đã dừng sẽ được hoàn tiền cho nhà tài trợ thay vì giải ngân.
          </div>
        </>
      )}

      {!loading && !error && activeTab === 'gian-lan' && (
        <>
          <AIBox variant={flags.some((f) => f.review_status === 'pending') ? 'warn' : 'success'} title="⚠️ AI CẢNH BÁO GIAN LẬN">
            Hệ thống chấm điểm dự án mới và mọi giao dịch theo mục tiêu, độ tin cậy chủ dự án, tần suất và tính ẩn danh.
            Cảnh báo vượt ngưỡng cần quản trị viên xác minh.
          </AIBox>

          <div className="flex items-center justify-between">
            <h2 className="font-bold">Cảnh báo ({flags.length})</h2>
            <button className="btn-ghost text-sm" onClick={refresh}>Làm mới</button>
          </div>
          {flags.length === 0 && <EmptyState icon="🛡️" title="Chưa có cảnh báo gian lận" />}
          {flags.map((f) => (
            <div key={f.id} className="card space-y-2 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`badge ${f.review_status === 'pending' ? 'bg-amber-100 text-amber-700' : f.review_status === 'confirmed' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                  {f.review_status === 'pending' ? 'Chờ xử lý' : f.review_status === 'confirmed' ? 'Đã xác nhận' : 'Báo nhầm'}
                </span>
                <span className="badge bg-slate-100">{{ user: 'Người dùng', project: 'Dự án', pledge: 'Giao dịch' }[f.entity_type] || f.entity_type}</span>
                <b className="text-red-600">Rủi ro {Math.round(f.risk_score)}%</b>
                <span className="text-xs text-slate-400">{formatDateTime(f.flagged_at)}</span>
              </div>
              <div className="font-semibold">{f.entity_label || f.entity_id}</div>
              <div className="text-slate-600">{f.reason}</div>
              {f.review_status === 'pending' ? (
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary text-sm disabled:opacity-60" disabled={busy === f.id} onClick={() => reviewFlag(f, 'confirmed')}>Xác nhận — xử lý</button>
                  <button className="btn-ghost text-sm disabled:opacity-60" disabled={busy === f.id} onClick={() => reviewFlag(f, 'false_positive')}>Báo nhầm</button>
                </div>
              ) : (
                <div className="text-xs text-slate-400">
                  Đã xử lý{f.reviewer_email ? ` bởi ${f.reviewer_email}` : ''}{f.reviewed_at ? ` · ${formatDateTime(f.reviewed_at)}` : ''}
                </div>
              )}
            </div>
          ))}

          <div className="card p-4">
            <h2 className="font-bold">Báo cáo từ người dùng ({reports.length})</h2>
            {reports.length === 0 && <p className="mt-1 text-sm text-slate-500">Chưa có báo cáo.</p>}
            {reports.map((r) => (
              <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 border-b py-2 text-sm last:border-0">
                <div className="min-w-0">
                  <b>{r.project_title}</b>
                  <div className="text-slate-600">{r.reason}</div>
                  <div className="text-xs text-slate-400">{r.reporter_name} · {r.reporter_email} · {formatDateTime(r.created_at)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`badge ${r.status === 'open' ? 'bg-amber-100 text-amber-700' : r.status === 'reviewed' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                    {r.status === 'open' ? 'Mới' : r.status === 'reviewed' ? 'Đã xem' : 'Đã đóng'}
                  </span>
                  {r.status === 'open' && (
                    <>
                      <button className="link text-xs disabled:opacity-50" disabled={busy === r.id} onClick={() => updateReport(r, 'reviewed')}>Đánh dấu đã xem</button>
                      <button className="link text-xs text-slate-500" onClick={() => updateReport(r, 'closed')}>Đóng</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {!loading && !error && activeTab === 'nguoi-dung' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-lg font-bold">Người dùng ({filteredUsers.length})</h1>
            <input className="input !w-64" placeholder="Tìm theo tên hoặc email…" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
          </div>
          <div className="card overflow-x-auto p-2">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr className="border-b">
                  <th className="p-2">Người dùng</th>
                  <th className="p-2">Vai trò</th>
                  <th className="p-2">KYC</th>
                  <th className="p-2">Tin cậy</th>
                  <th className="p-2">Hoạt động</th>
                  <th className="p-2">Trạng thái</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="p-2">
                      <b>{u.full_name}</b>
                      <div className="text-xs text-slate-500">{u.email}</div>
                      <span className={`badge mt-1 ${u.email_verified_at ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {u.email_verified_at ? 'Email đã xác thực' : 'Email chưa xác thực'}
                      </span>
                    </td>
                    <td className="p-2">{(roleVi[u.role] || u.role)}</td>
                    <td className="p-2 text-xs">{kycVi[u.kyc_status]}</td>
                    <td className="p-2">{Math.round(Number(u.trust_score))}</td>
                    <td className="p-2 text-xs text-slate-500">{u.owned_projects} dự án · {u.paid_pledges} tài trợ</td>
                    <td className="p-2">
                      <span className={`badge ${u.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {u.status === 'active' ? 'Hoạt động' : 'Đã khóa'}
                      </span>
                    </td>
                    <td className="p-2 text-right">
                      <button className={`text-xs hover:underline disabled:opacity-50 ${u.status === 'active' ? 'text-red-600' : 'text-emerald-700'}`} disabled={busy === u.id} onClick={() => toggleUser(u)}>
                        {u.status === 'active' ? 'Khóa' : 'Mở khóa'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredUsers.length === 0 && <div className="p-6 text-center text-sm text-slate-500">Không tìm thấy người dùng phù hợp.</div>}
          </div>
        </>
      )}

      {!loading && !error && activeTab === 'danh-muc' && (
        <>
          <h1 className="text-lg font-bold">Quản lý danh mục</h1>
          <form className="card flex flex-wrap items-end gap-2 p-4" onSubmit={addCategory}>
            <div className="min-w-48 flex-1">
              <label className="text-xs font-semibold">Tên danh mục</label>
              <input className="input mt-1" placeholder="VD: Nông nghiệp" value={newCategory.name} onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })} />
            </div>
            <div className="min-w-48 flex-[2]">
              <label className="text-xs font-semibold">Mô tả</label>
              <input className="input mt-1" placeholder="Mô tả ngắn" value={newCategory.description} onChange={(e) => setNewCategory({ ...newCategory, description: e.target.value })} />
            </div>
            <button className="btn-primary text-sm disabled:opacity-60" type="submit" disabled={busy === 'new-category'}>+ Thêm</button>
          </form>

          <div className="card divide-y p-2">
            {categories.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 p-2 text-sm">
                {editingCategory?.id === c.id ? (
                  <>
                    <input className="input !w-48" value={editingCategory.name} onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })} />
                    <input className="input !w-64" value={editingCategory.description || ''} onChange={(e) => setEditingCategory({ ...editingCategory, description: e.target.value })} />
                    <button className="btn-primary text-xs" onClick={() => saveCategory(c)}>Lưu</button>
                    <button className="btn-ghost text-xs" onClick={() => setEditingCategory(null)}>Hủy</button>
                  </>
                ) : (
                  <>
                    <b className="min-w-32">{c.name}</b>
                    <span className="flex-1 text-xs text-slate-500">{c.description}</span>
                    <span className="badge bg-slate-100">{c.project_count} dự án</span>
                    <button className="link text-xs" onClick={() => setEditingCategory({ id: c.id, name: c.name, description: c.description || '' })}>Sửa</button>
                    <button className="text-xs text-red-500 hover:underline disabled:opacity-40" disabled={c.project_count > 0 || busy === c.id} title={c.project_count > 0 ? 'Không thể xóa danh mục đang có dự án' : 'Xóa'} onClick={() => deleteCategory(c)}>Xóa</button>
                  </>
                )}
              </div>
            ))}
            {categories.length === 0 && <div className="p-6 text-center text-sm text-slate-500">Chưa có danh mục.</div>}
          </div>
        </>
      )}

      <Modal
        open={!!rejectTarget}
        title="Từ chối dự án"
        onClose={() => setRejectTarget(null)}
        footer={
          <>
            <button className="btn-ghost text-sm" onClick={() => setRejectTarget(null)}>Hủy</button>
            <button className="btn-primary text-sm disabled:opacity-60" disabled={busy === rejectTarget?.id} onClick={rejectProject}>Xác nhận từ chối</button>
          </>
        }
      >
        <p className="text-sm text-slate-600">Dự án <b>{rejectTarget?.title}</b> sẽ chuyển sang trạng thái “Đã dừng”. Chủ dự án sẽ nhận thông báo kèm lý do.</p>
        <textarea className="input" rows="4" placeholder="Lý do từ chối (tối thiểu 5 ký tự)…" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
      </Modal>
    </Shell>
  );
}
