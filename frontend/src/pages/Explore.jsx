import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import { EmptyState, ErrorState, Loading, PageHeader, ProjectCard, Spinner } from '../components/ui';

const PAGE_SIZE = 6;

const STATUS_OPTIONS = [
  ['', 'Mọi trạng thái'],
  ['active', 'Đang gây quỹ'],
  ['successful', 'Thành công'],
  ['failed', 'Thất bại'],
  ['canceled', 'Đã dừng'],
];

export default function Explore() {
  const [sp] = useSearchParams();
  const { categories, currentUser, toast } = useApp();
  const [q, setQ] = useState(sp.get('q') || '');
  const [cat, setCat] = useState(sp.get('cat') || '');
  const [status, setStatus] = useState(sp.get('status') || '');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [followBusy, setFollowBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sort });
    if (q.trim()) params.set('q', q.trim());
    if (cat) params.set('category', cat);
    if (status) params.set('status', status);
    try {
      const res = await api.get(`/projects?${params.toString()}`);
      setData({ items: res?.items || [], total: res?.total || 0, pages: res?.pages || 1 });
    } catch (err) {
      setError(err.message);
      setData({ items: [], total: 0, pages: 1 });
    } finally {
      setLoading(false);
    }
  }, [q, cat, status, sort, page]);

  useEffect(() => {
    const timer = setTimeout(load, q ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, q, reloadTick]);

  const setFilter = (setter) => (e) => {
    setPage(1);
    setter(e.target.value);
  };

  const clearFilters = () => {
    setQ('');
    setCat('');
    setStatus('');
    setSort('newest');
    setPage(1);
  };

  const toggleFollow = async (project) => {
    if (!currentUser) {
      toast('Đăng nhập để theo dõi dự án.', 'warning');
      return;
    }
    setFollowBusy(project.id);
    try {
      if (project.is_following) await api.del(`/projects/${project.id}/follow`);
      else await api.post(`/projects/${project.id}/follow`);
      const next = !project.is_following;
      setData((d) => ({ ...d, items: d.items.map((p) => (p.id === project.id ? { ...p, is_following: next } : p)) }));
      toast(next ? 'Đã theo dõi dự án.' : 'Đã bỏ theo dõi dự án.', next ? 'success' : 'info');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setFollowBusy('');
    }
  };

  const hasFilter = q || cat || status || sort !== 'newest';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Khám phá dự án"
        subtitle="Tìm chiến dịch phù hợp với điều bạn quan tâm"
        action={
          currentUser && currentUser.role !== 'admin' ? (
            <Link to="/tao-du-an" className="btn-primary text-sm">+ Tạo dự án</Link>
          ) : null
        }
      />

      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <input
            className="input !w-full sm:!w-72"
            placeholder="Tìm kiếm theo tên hoặc mô tả…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <select className="input !w-auto" value={cat} onChange={setFilter(setCat)}>
            <option value="">Tất cả danh mục</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select className="input !w-auto" value={status} onChange={setFilter(setStatus)}>
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select className="input !w-auto" value={sort} onChange={setFilter(setSort)} title="Sắp xếp">
            <option value="newest">Mới nhất</option>
            <option value="ending">Sắp kết thúc</option>
            <option value="progress">Gần đạt mục tiêu</option>
            <option value="ai">AI đánh giá cao</option>
            <option value="popular">Nhiều nhà tài trợ</option>
          </select>
          <span className="ml-auto self-center text-xs text-slate-500">
            {loading ? 'Đang tìm…' : `${data.total} dự án`}
          </span>
        </div>
        {hasFilter && (
          <button className="link text-xs" onClick={clearFilters}>
            ✕ Xóa bộ lọc
          </button>
        )}
      </div>

      {loading && <Loading text="Đang tải dự án…" />}
      {!loading && error && <ErrorState message={error} onRetry={() => setReloadTick((t) => t + 1)} />}
      {!loading && !error && data.items.length === 0 && (
        <EmptyState icon="🔍" title="Không tìm thấy dự án phù hợp" action={<button className="btn-ghost text-sm" onClick={clearFilters}>Xóa bộ lọc</button>}>
          Thử từ khóa khác hoặc chọn danh mục khác.
        </EmptyState>
      )}

      {!loading && !error && data.items.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          {data.items.map((p) => (
            <ProjectCard key={p.id} project={p} onFollow={toggleFollow} followBusy={followBusy === p.id} />
          ))}
        </div>
      )}

      {!loading && !error && data.pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ← Trước
          </button>
          <span>Trang {page}/{data.pages}</span>
          <button className="btn-ghost" disabled={page >= data.pages} onClick={() => setPage((p) => Math.min(data.pages, p + 1))}>
            Sau →
          </button>
        </div>
      )}

      {followBusy && (
        <div className="flex justify-center text-xs text-slate-500">
          <Spinner className="mr-2 h-3 w-3 text-emerald-600" /> Đang cập nhật…
        </div>
      )}
    </div>
  );
}
