import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import { AIBox, EmptyState, ErrorState, Loading, PageHeader, ProjectCard, Spinner } from '../components/ui';
import { compactMoney } from '../lib/format';

export default function Home() {
  const { currentUser, categories, interests, toast } = useApp();
  const nav = useNavigate();
  const [projects, setProjects] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [followBusy, setFollowBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const listTask = api.get('/projects?status=active&limit=6&sort=ending', { auth: false });
      const recTask = currentUser
        ? api.get('/me/recommendations').catch(() => ({ items: [] }))
        : Promise.resolve({ items: [] });
      const [list, recs] = await Promise.all([listTask, recTask]);
      setProjects(list?.items || []);
      setRecommendations(recs?.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleFollow = async (project) => {
    if (!currentUser) {
      nav('/dang-nhap', { state: { from: '/' } });
      return;
    }
    setFollowBusy(project.id);
    try {
      if (project.is_following) await api.del(`/projects/${project.id}/follow`);
      else await api.post(`/projects/${project.id}/follow`);
      const next = !project.is_following;
      setProjects((list) => list.map((p) => (p.id === project.id ? { ...p, is_following: next } : p)));
      toast(next ? 'Đã theo dõi dự án, bạn sẽ nhận thông báo cập nhật.' : 'Đã bỏ theo dõi dự án.', next ? 'success' : 'info');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setFollowBusy('');
    }
  };

  const activeCount = projects.length;
  const raised = projects.reduce((sum, p) => sum + Number(p.current_amount || 0), 0);
  const interestNames = interests.map((i) => i.name);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-600 to-teal-600 p-6 text-white shadow-sm md:p-10">
        <div className="grid items-center gap-6 md:grid-cols-5">
          <div className="md:col-span-3">
            <span className="badge bg-white/15 text-emerald-50">Nền tảng gây quỹ cộng đồng + AI</span>
            <h1 className="mt-3 text-2xl font-bold leading-tight md:text-4xl">
              Gây quỹ minh bạch,<br className="hidden md:block" /> lan toả điều tốt đẹp
            </h1>
            <p className="mt-3 max-w-xl text-emerald-50">
              Kêu gọi — Tài trợ — Theo dõi tiến độ theo thời gian thực. AI đồng hành cùng chủ dự án và nhà tài trợ
              trong suốt chiến dịch.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/kham-pha" className="rounded-xl bg-white px-5 py-2 font-semibold text-emerald-700 hover:bg-emerald-50">
                Khám phá dự án
              </Link>
              <Link
                to={currentUser ? '/tao-du-an' : '/dang-nhap'}
                className="rounded-xl border border-white/70 px-5 py-2 font-semibold hover:bg-white/10"
              >
                Tạo chiến dịch
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 md:col-span-2">
            {[
              ['Đang gây quỹ', activeCount, '🌱'],
              ['Đã huy động', compactMoney(raised), '💚'],
              ['Minh bạch', '100%', '🔎'],
            ].map(([label, value, icon]) => (
              <div key={label} className="rounded-2xl bg-white/10 p-3 text-center backdrop-blur">
                <div className="text-2xl">{icon}</div>
                <div className="mt-1 text-lg font-bold">{value}</div>
                <div className="text-[11px] text-emerald-50">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {currentUser ? (
        <AIBox variant={recommendations.length ? 'success' : 'info'}>
          <b>Gợi ý dành riêng cho {currentUser.full_name}:</b>{' '}
          {recommendations.length > 0 ? (
            <>
              dựa trên sở thích {interestNames.length ? <i>{interestNames.join(', ')}</i> : <i>và hành vi tài trợ</i>}, AI chấm{' '}
              {recommendations.slice(0, 3).map((p, index) => (
                <span key={p.id}>
                  {index > 0 && ' · '}
                  <Link to={`/du-an/${p.id}`} className="font-semibold text-emerald-700 hover:underline">
                    {p.title} ({Math.round(Number(p.score) * 100)}%)
                  </Link>
                </span>
              ))}
              .
            </>
          ) : (
            <>
              chưa đủ dữ liệu để cá nhân hoá.{' '}
              <Link to="/chon-so-thich" className="font-semibold text-emerald-700 hover:underline">
                Chọn chủ đề quan tâm
              </Link>{' '}
              để AI gợi ý chính xác hơn.
            </>
          )}
          <span className="text-slate-500"> Điểm gợi ý được tính lại mỗi lần bạn mở trang.</span>
        </AIBox>
      ) : (
        <AIBox>
          <b>AI gợi ý dự án phù hợp:</b>{' '}
          <Link to="/dang-nhap" className="font-semibold text-emerald-700 hover:underline">
            đăng nhập
          </Link>{' '}
          để nhận gợi ý dựa trên sở thích và lịch sử tài trợ của bạn.
        </AIBox>
      )}

      <section>
        <PageHeader
          title="Danh mục"
          subtitle="Tìm dự án theo lĩnh vực bạn quan tâm"
          action={
            <Link to="/kham-pha" className="link text-sm">
              Xem tất cả →
            </Link>
          }
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {categories.map((c) => (
            <Link key={c.id} to={`/kham-pha?cat=${c.id}`} className="badge border bg-white px-3 py-1.5 hover:border-emerald-400 hover:text-emerald-700">
              {c.name}
              <span className="ml-1 text-slate-400">{c.active_project_count ?? c.project_count ?? 0}</span>
            </Link>
          ))}
          {categories.length === 0 && <span className="text-sm text-slate-500">Chưa tải được danh mục.</span>}
        </div>
      </section>

      <section className="space-y-3">
        <PageHeader
          title="Dự án đang gây quỹ"
          subtitle="Mỗi đóng góp đều được ghi nhận và công khai"
          action={
            <Link to="/kham-pha" className="btn-ghost text-sm">
              Xem tất cả
            </Link>
          }
        />
        {loading && <Loading />}
        {!loading && error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && projects.length === 0 && (
          <EmptyState icon="🌱" title="Chưa có dự án đang gây quỹ" action={<Link to="/tao-du-an" className="btn-primary text-sm">Tạo chiến dịch đầu tiên</Link>} />
        )}
        {!loading && !error && projects.length > 0 && (
          <div className="grid gap-4 md:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} onFollow={toggleFollow} followBusy={followBusy === p.id} />
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          ['🛡️', 'Minh bạch dòng tiền', 'Mọi khoản tài trợ, hoàn tiền và giải ngân đều có giao dịch ghi nhận trong cơ sở dữ liệu.'],
          ['🤖', 'AI hỗ trợ ra quyết định', 'Dự đoán khả năng thành công, gợi ý dự án phù hợp và phát hiện giao dịch bất thường.'],
          ['🤝', 'Cộng đồng đồng hành', 'Theo dõi dự án, bình luận, nhận cập nhật tiến độ và báo cáo nội dung chưa minh bạch.'],
        ].map(([icon, title, desc]) => (
          <div key={title} className="card p-5">
            <div className="text-3xl">{icon}</div>
            <b className="mt-2 block">{title}</b>
            <p className="mt-1 text-sm text-slate-500">{desc}</p>
          </div>
        ))}
      </section>

      {followBusy && (
        <div className="flex justify-center text-sm text-slate-500">
          <Spinner className="mr-2 h-4 w-4 text-emerald-600" /> Đang cập nhật theo dõi…
        </div>
      )}
    </div>
  );
}
