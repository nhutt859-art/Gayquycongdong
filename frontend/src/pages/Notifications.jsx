import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { EmptyState, Loading, PageHeader, Spinner } from '../components/ui';
import { timeAgo } from '../lib/format';

const TYPE_META = {
  pledge: ['💚', 'Tài trợ'],
  pledge_success: ['💚', 'Tài trợ'],
  refund: ['↩️', 'Hoàn tiền'],
  payout: ['🏦', 'Giải ngân'],
  comment: ['💬', 'Bình luận'],
  update: ['📣', 'Bản tin'],
  project: ['📁', 'Dự án'],
  fraud: ['🚨', 'Cảnh báo'],
  report: ['⚑', 'Báo cáo'],
  invite: ['🤝', 'Cộng tác'],
  collab: ['🤝', 'Cộng tác'],
  ai: ['✨', 'AI gợi ý'],
  account: ['🔐', 'Tài khoản'],
  success: ['✅', 'Thành công'],
  info: ['ℹ️', 'Thông tin'],
};

export default function Notifications() {
  const {
    notifications,
    notificationsLoading,
    markNotificationRead,
    markAllNotificationsRead,
    removeNotification,
    clearNotifications,
    toast,
  } = useApp();
  const nav = useNavigate();
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState('');

  const unread = notifications.filter((n) => !n.is_read).length;
  const items = filter === 'unread' ? notifications.filter((n) => !n.is_read) : notifications;

  const markAll = async () => {
    setBusy('all');
    try {
      await markAllNotificationsRead();
      toast('Đã đánh dấu tất cả là đã đọc.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const markOne = async (n) => {
    if (n.is_read) return;
    try {
      await markNotificationRead(n.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const removeOne = async (id) => {
    setBusy(id);
    try {
      await removeNotification(id);
      toast('Đã xóa thông báo.', 'info');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const clearAll = async () => {
    if (!window.confirm('Xóa toàn bộ thông báo?')) return;
    setBusy('clear');
    try {
      await clearNotifications();
      toast('Đã xóa tất cả thông báo.', 'info');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const openNotification = async (n) => {
    await markOne(n);
    if (n.link) nav(n.link);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Thông báo"
        subtitle={unread > 0 ? `${unread} thông báo chưa đọc` : 'Bạn đã đọc hết thông báo'}
        action={
          <div className="flex flex-wrap gap-3 text-sm">
            <button className="link disabled:opacity-50" disabled={busy === 'all' || unread === 0} onClick={markAll}>
              Đánh dấu đã đọc hết
            </button>
            <button className="link text-slate-500 disabled:opacity-50" disabled={busy === 'clear' || notifications.length === 0} onClick={clearAll}>
              Xóa hết
            </button>
          </div>
        }
      />

      <div className="flex gap-2">
        {[
          ['all', `Tất cả (${notifications.length})`],
          ['unread', `Chưa đọc (${unread})`],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`rounded-xl px-3 py-1.5 text-sm font-medium ${filter === key ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {notificationsLoading && <Loading text="Đang tải thông báo…" />}

      {!notificationsLoading && items.length === 0 && (
        <EmptyState icon="🔔" title={filter === 'unread' ? 'Không có thông báo chưa đọc' : 'Chưa có thông báo'}>
          Theo dõi dự án hoặc tài trợ để nhận cập nhật mới.
        </EmptyState>
      )}

      {!notificationsLoading && items.length > 0 && (
        <div className="space-y-2">
          {items.map((n) => {
            const [icon, label] = TYPE_META[n.type] || ['🔔', n.type];
            return (
              <div
                key={n.id}
                className={`card flex cursor-pointer items-start gap-3 p-3 text-sm transition hover:border-emerald-300 ${n.is_read ? 'bg-white' : 'border-emerald-200 bg-emerald-50/60'}`}
                onClick={() => openNotification(n)}
              >
                <span className="text-2xl">{icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge bg-slate-100">{label}</span>
                    {!n.is_read && <span className="badge bg-emerald-600 text-white">Mới</span>}
                  </div>
                  <p className="mt-1 text-slate-700">{n.content}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span>{timeAgo(n.created_at)}</span>
                    {n.link && <span>· Bấm để xem chi tiết →</span>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {!n.is_read && (
                    <button
                      className="link text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        markOne(n);
                      }}
                    >
                      Đã đọc
                    </button>
                  )}
                  <button
                    className="text-xs text-slate-400 hover:text-red-600 disabled:opacity-50"
                    disabled={busy === n.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeOne(n.id);
                    }}
                  >
                    {busy === n.id ? <Spinner className="h-3 w-3" /> : 'Xóa'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
