import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import {
  AIBox,
  ErrorState,
  Loading,
  Modal,
  Progress,
  ProjectCover,
  Spinner,
  StatusBadge,
} from '../components/ui';
import { daysLeft, formatDate, formatDateTime, percent, timeAgo, vnd } from '../lib/format';

const TABS = [
  ['capnhat', 'Câu chuyện & cập nhật'],
  ['binhluan', 'Bình luận'],
  ['goi', 'Gói tri ân'],
];

function CommentItem({ comment, replies, currentUser, onReply }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
          {comment.user_name?.charAt(0)?.toUpperCase() || '?'}
        </span>
        <b>{comment.user_name}</b>
        <span className="text-xs text-slate-400">{timeAgo(comment.created_at)}</span>
      </div>
      <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{comment.content}</p>
      {currentUser && (
        <button className="link mt-1 text-xs" onClick={() => onReply(comment)}>
          Trả lời
        </button>
      )}
      {replies.length > 0 && (
        <div className="mt-2 space-y-2 border-l-2 border-emerald-100 pl-3">
          {replies.map((reply) => (
            <div key={reply.id} className="rounded-lg bg-slate-50 p-2">
              <div className="flex flex-wrap items-center gap-1 text-xs">
                <b className="text-sm">{reply.user_name}</b>
                <span className="text-slate-400">· {timeAgo(reply.created_at)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-line text-sm text-slate-700">{reply.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const nav = useNavigate();
  const { currentUser, toast } = useApp();
  const initialTab = ['capnhat', 'binhluan', 'goi'].includes(searchParams.get('tab')) ? searchParams.get('tab') : 'capnhat';
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(initialTab);
  const [comment, setComment] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [commentBusy, setCommentBusy] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get(`/projects/${id}`);
      setProject(data);
    } catch (err) {
      setError(err.message);
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load, reloadTick]);

  const commentTree = useMemo(() => {
    if (!project?.comments) return [];
    const roots = project.comments.filter((c) => !c.parent_comment_id);
    const byParent = new Map();
    project.comments
      .filter((c) => c.parent_comment_id)
      .forEach((c) => {
        const list = byParent.get(c.parent_comment_id) || [];
        list.push(c);
        byParent.set(c.parent_comment_id, list);
      });
    return roots.map((root) => ({ root, replies: byParent.get(root.id) || [] }));
  }, [project]);

  const requireLogin = (target = `/du-an/${id}`) => {
    if (currentUser) return true;
    nav('/dang-nhap', { state: { from: target } });
    return false;
  };

  const toggleFollow = async () => {
    if (!requireLogin()) return;
    setFollowBusy(true);
    try {
      if (project.is_following) await api.del(`/projects/${id}/follow`);
      else await api.post(`/projects/${id}/follow`);
      setProject((p) => ({
        ...p,
        is_following: !p.is_following,
        follower_count: Math.max(0, (p.follower_count || 0) + (p.is_following ? -1 : 1)),
      }));
      toast(project.is_following ? 'Đã bỏ theo dõi dự án.' : 'Đã theo dõi dự án, bạn sẽ nhận thông báo cập nhật.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setFollowBusy(false);
    }
  };

  const sendComment = async () => {
    if (!requireLogin()) return;
    if (!comment.trim()) return;
    setCommentBusy(true);
    try {
      const data = await api.post(`/projects/${id}/comments`, {
        content: comment.trim(),
        parent_comment_id: replyTo?.id || null,
      });
      setProject((p) => ({ ...p, comments: [...p.comments, data.comment] }));
      setComment('');
      setReplyTo(null);
      toast('Đã gửi bình luận.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setCommentBusy(false);
    }
  };

  const sendReport = async () => {
    if (reportReason.trim().length < 10) {
      toast('Vui lòng nhập lý do tối thiểu 10 ký tự.', 'warning');
      return;
    }
    setReportBusy(true);
    try {
      await api.post(`/projects/${id}/reports`, { reason: reportReason.trim() });
      setReportOpen(false);
      setReportReason('');
      toast('Đã gửi báo cáo, quản trị viên sẽ xem xét sớm.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setReportBusy(false);
    }
  };

  if (loading) return <Loading text="Đang tải dự án…" />;
  if (error) {
    return (
      <div className="space-y-3">
        <ErrorState message={error} onRetry={() => setReloadTick((t) => t + 1)} />
        <div className="text-center">
          <Link to="/kham-pha" className="link text-sm">← Về trang khám phá</Link>
        </div>
      </div>
    );
  }
  if (!project) return null;

  const isOwner = project.my_role === 'owner';
  const aiScore = Math.round(Number(project.ai_success_score || 0));
  const canDonate = project.can_pledge;
  const ended = daysLeft(project.end_date) === 'Đã kết thúc';
  const donateTarget = `/tai-tro/${project.id}`;

  let donateMessage = '';
  if (!currentUser) donateMessage = 'Đăng nhập để tài trợ dự án.';
  else if (project.owner_id === currentUser.id) donateMessage = 'Bạn không thể tài trợ chính dự án của mình.';
  else if (currentUser.role === 'admin') donateMessage = 'Quản trị viên không thực hiện tài trợ.';
  else if (project.status !== 'active') donateMessage = 'Dự án không ở trạng thái đang gây quỹ.';
  else if (ended) donateMessage = 'Chiến dịch đã hết hạn.';

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <div className="card overflow-hidden">
            <ProjectCover project={project} className="h-56 md:h-72" emojiClass="text-7xl" />
            <div className="space-y-3 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={project.status} />
                <span className="badge bg-slate-100">{project.category_name}</span>
                <span className="text-xs text-slate-500">{daysLeft(project.end_date)} · Kết thúc {formatDate(project.end_date)}</span>
              </div>
              <h1 className="text-2xl font-bold leading-snug">{project.title}</h1>
              <div className="text-sm text-slate-500">
                Tổ chức bởi <b className="text-slate-700">{project.owner_name}</b> · Độ tin cậy {Math.round(Number(project.owner_trust_score || 0))}/100
              </div>
              <Progress project={project} />
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-2">
                  <div className="text-xs text-slate-500">Đã huy động</div>
                  <b>{vnd(project.current_amount)}</b>
                </div>
                <div className="rounded-xl bg-slate-50 p-2">
                  <div className="text-xs text-slate-500">Mục tiêu</div>
                  <b>{vnd(project.goal_amount)}</b>
                </div>
                <div className="rounded-xl bg-slate-50 p-2">
                  <div className="text-xs text-slate-500">Nhà tài trợ</div>
                  <b>{project.backer_count}</b>
                </div>
                <div className="rounded-xl bg-slate-50 p-2">
                  <div className="text-xs text-slate-500">Theo dõi</div>
                  <b>{project.follower_count}</b>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {project.can_manage && (
                  <Link to={`/quan-ly/${project.id}`} className="btn-primary text-sm">Quản lý dự án</Link>
                )}
                <button className="btn-ghost text-sm disabled:opacity-60" disabled={followBusy} onClick={toggleFollow}>
                  {followBusy ? <Spinner className="mr-1 h-3 w-3" /> : null}
                  {project.is_following ? '★ Đang theo dõi' : '☆ Theo dõi để nhận cập nhật'}
                </button>
                {currentUser && !isOwner && currentUser.role !== 'admin' && (
                  <button className="btn-ghost text-sm" onClick={() => setReportOpen(true)}>⚑ Báo cáo vi phạm</button>
                )}
              </div>
            </div>
          </div>

          <AIBox variant={aiScore >= 70 ? 'success' : aiScore >= 45 ? 'info' : 'warn'}>
            <b>AI dự đoán khả năng thành công: {aiScore}%</b>{' '}
            {project.prediction?.model_version ? `(mô hình ${project.prediction.model_version})` : ''}.
            <div className="mt-1">
              {aiScore >= 70
                ? 'Tín hiệu tích cực: mục tiêu hợp lý, có gói tri ân và mô tả rõ ràng. Hãy đăng cập nhật đều đặn để giữ đà.'
                : aiScore >= 45
                  ? 'Tiềm năng ở mức trung bình. Nên bổ sung gói tri ân nhỏ, tăng tần suất cập nhật và chia sẻ rộng hơn.'
                  : 'Rủi ro cao: cần cải thiện mô tả, bổ sung gói tri ân và kiểm chứng thông tin tổ chức trước khi mở rộng.'}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Điểm rủi ro gian lận: {Math.round(Number(project.fraud_risk_score))}% · Đây là mô hình heuristic phục vụ đồ án.
            </div>
          </AIBox>

          <div className="card p-5">
            <div className="mb-3 flex flex-wrap gap-2">
              {TABS.map(([key, label]) => (
                <button
                  key={key}
                  className={`rounded-xl px-3 py-1.5 text-sm font-medium ${tab === key ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  onClick={() => setTab(key)}
                >
                  {label}
                  {key === 'binhluan' ? ` (${project.comments.length})` : ''}
                  {key === 'goi' ? ` (${project.rewards.length})` : ''}
                </button>
              ))}
            </div>

            {tab === 'capnhat' && (
              <div className="space-y-4">
                <div>
                  <h2 className="font-bold">Về chiến dịch</h2>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate-600">{project.description}</p>
                  <div className="mt-2 text-xs text-slate-400">
                    Bắt đầu {formatDate(project.start_date)} · Kết thúc {formatDate(project.end_date)}
                  </div>
                </div>
                <div>
                  <h2 className="font-bold">Cập nhật tiến độ ({project.updates.length})</h2>
                  {project.updates.length === 0 && <p className="mt-1 text-sm text-slate-500">Chưa có bản tin nào.</p>}
                  <div className="mt-2 space-y-2">
                    {project.updates.map((u) => (
                      <div key={u.id} className="rounded-xl border border-slate-200 p-3">
                        <b>{u.title}</b>
                        <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{u.content}</p>
                        <div className="mt-1 text-xs text-slate-400">
                          {u.author_name || 'Ban tổ chức'} · {formatDateTime(u.created_at)} · {timeAgo(u.created_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 'binhluan' && (
              <div className="space-y-3">
                {project.comments.length === 0 && <p className="text-sm text-slate-500">Chưa có bình luận. Hãy đặt câu hỏi đầu tiên!</p>}
                {commentTree.map(({ root, replies }) => (
                  <CommentItem
                    key={root.id}
                    comment={root}
                    replies={replies}
                    currentUser={currentUser}
                    onReply={(c) => {
                      setReplyTo(c);
                      setComment(`@${c.user_name} `);
                    }}
                  />
                ))}
                {currentUser ? (
                  <div className="space-y-1">
                    {replyTo && (
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        Đang trả lời <b>{replyTo.user_name}</b>
                        <button className="link" onClick={() => { setReplyTo(null); setComment(''); }}>Hủy</button>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        className="input"
                        placeholder="Đặt câu hỏi hoặc chia sẻ cảm nhận…"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendComment()}
                      />
                      <button className="btn-primary text-sm disabled:opacity-60" onClick={sendComment} disabled={commentBusy || !comment.trim()}>
                        Gửi
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                    <Link className="link font-semibold" to="/dang-nhap" state={{ from: `/du-an/${project.id}` }}>
                      Đăng nhập
                    </Link>{' '}
                    để bình luận và theo dõi dự án.
                  </div>
                )}
              </div>
            )}

            {tab === 'goi' && (
              <div className="space-y-2">
                {project.rewards.length === 0 && <p className="text-sm text-slate-500">Dự án nhận tài trợ tự do, không kèm quà tri ân.</p>}
                {project.rewards.map((r) => {
                  const soldOut = r.remaining <= 0;
                  return (
                    <div key={r.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <b>{r.title}</b>
                          {r.description && <p className="mt-1 text-sm text-slate-600">{r.description}</p>}
                        </div>
                        <span className={`badge ${soldOut ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700'}`}>
                          {soldOut ? 'Hết suất' : `Còn ${r.remaining} suất`}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>Tối thiểu <b>{vnd(r.min_amount)}</b></span>
                        {canDonate && !soldOut ? (
                          <Link to={`/tai-tro/${project.id}?reward=${r.id}`} className="btn-primary text-sm">Chọn gói này</Link>
                        ) : (
                          <span className="text-xs text-slate-500">{soldOut ? 'Gói đã nhận đủ' : donateMessage}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="card space-y-3 p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold text-emerald-700">{percent(project)}%</span>
              <span className="text-xs text-slate-500">{daysLeft(project.end_date)}</span>
            </div>
            <Progress project={project} compact />
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-slate-50 p-2">
                <div className="text-xs text-slate-500">Đã nhận</div>
                <b>{vnd(project.current_amount)}</b>
              </div>
              <div className="rounded-xl bg-slate-50 p-2">
                <div className="text-xs text-slate-500">Mục tiêu</div>
                <b>{vnd(project.goal_amount)}</b>
              </div>
            </div>
            {canDonate ? (
              <Link to={donateTarget} className="btn-primary block w-full text-center">Tài trợ dự án</Link>
            ) : (
              <div className="space-y-2">
                <button className="btn-primary w-full cursor-not-allowed opacity-50" disabled>Tài trợ dự án</button>
                <div className="text-xs text-amber-700">{donateMessage}</div>
              </div>
            )}
            {project.my_pledge_total > 0 && (
              <div className="rounded-xl bg-emerald-50 p-2 text-xs text-emerald-700">
                Bạn đã tài trợ {vnd(project.my_pledge_total)} cho dự án này.
              </div>
            )}
            <div className="text-xs text-slate-500">Thanh toán mô phỏng · Không phát sinh giao dịch thật.</div>
          </div>

          <div className="card space-y-2 p-5">
            <h3 className="font-bold">Gói tri ân</h3>
            {project.rewards.length === 0 && <p className="text-sm text-slate-500">Tài trợ tự do, không kèm quà tri ân.</p>}
            {project.rewards.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <b>{r.title}</b>
                <div className="text-xs text-slate-500">Tối thiểu {vnd(r.min_amount)} · còn {r.remaining} suất</div>
                {canDonate && r.remaining > 0 && (
                  <Link to={`/tai-tro/${project.id}?reward=${r.id}`} className="btn-ghost mt-2 block text-center text-xs">
                    Chọn gói này
                  </Link>
                )}
              </div>
            ))}
            {canDonate && (
              <Link to={donateTarget} className="btn-ghost block text-center text-sm">Tài trợ tự do</Link>
            )}
          </div>

          <div className="card p-5 text-sm">
            <h3 className="font-bold">Chia sẻ dự án</h3>
            <p className="mt-1 text-xs text-slate-500">Sao chép liên kết để lan toả chiến dịch tới cộng đồng.</p>
            <button
              className="btn-ghost mt-2 w-full text-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  toast('Đã sao chép liên kết dự án.', 'success');
                } catch {
                  toast('Không sao chép được liên kết trên trình duyệt này.', 'warning');
                }
              }}
            >
              📋 Sao chép liên kết
            </button>
          </div>
        </aside>
      </div>

      <Modal
        open={reportOpen}
        title="Báo cáo dự án vi phạm"
        onClose={() => setReportOpen(false)}
        footer={
          <>
            <button className="btn-ghost text-sm" onClick={() => setReportOpen(false)}>Hủy</button>
            <button className="btn-primary text-sm disabled:opacity-60" disabled={reportBusy} onClick={sendReport}>
              Gửi báo cáo
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Mô tả lý do bạn cho rằng dự án này có dấu hiệu vi phạm (tối thiểu 10 ký tự). Quản trị viên sẽ xem xét.
        </p>
        <textarea
          className="input"
          rows="4"
          value={reportReason}
          onChange={(e) => setReportReason(e.target.value)}
          placeholder="Ví dụ: thông tin tổ chức không rõ ràng, cam kết lợi nhuận bất thường…"
        />
      </Modal>
    </div>
  );
}
