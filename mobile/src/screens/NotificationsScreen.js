import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { timeAgo } from '../lib/format';
import { colors, radius } from '../theme';
import { Button, Card, EmptyState, Loading, Screen, SectionHeader, confirmAction } from '../components/ui';

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

export default function NotificationsScreen({ navigation }) {
  const {
    currentUser,
    notifications,
    notificationsLoading,
    markNotificationRead,
    markAllNotificationsRead,
    removeNotification,
    clearNotifications,
    refreshNotifications,
    toast,
  } = useApp();
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState('');

  if (!currentUser) {
    return (
      <Screen topInset>
        <Card style={{ padding: 22, alignItems: 'center' }}>
          <Text style={{ fontSize: 44 }}>🔔</Text>
          <Text style={{ fontSize: 19, fontWeight: '900', marginTop: 8 }}>Đăng nhập để xem thông báo</Text>
          <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 5 }}>
            Theo dõi dự án hoặc tài trợ để nhận cập nhật mới.
          </Text>
          <Button title="Đăng nhập" onPress={() => navigation.navigate('Auth')} style={{ marginTop: 14, width: '100%' }} />
        </Card>
      </Screen>
    );
  }

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

  const clearAll = () => {
    confirmAction('Xóa toàn bộ thông báo?', 'Hành động này không thể hoàn tác.', async () => {
      setBusy('clear');
      try {
        await clearNotifications();
        toast('Đã xóa tất cả thông báo.', 'info');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        setBusy('');
      }
    });
  };

  const openLink = (link) => {
    if (!link) return;
    let match = link.match(/^\/du-an\/([^/?#]+)/);
    if (match) {
      navigation.navigate('ProjectDetail', { id: match[1] });
      return;
    }
    match = link.match(/^\/quan-ly\/([^/?#]+)/);
    if (match) {
      navigation.navigate('ManageProject', { id: match[1] });
      return;
    }
    if (link.startsWith('/du-an-cua-toi')) {
      navigation.navigate('MyProjects');
      return;
    }
    if (link.startsWith('/ca-nhan')) {
      navigation.navigate('MainTabs', { screen: 'ProfileTab' });
      return;
    }
    if (link.startsWith('/tao-du-an')) {
      navigation.navigate('CreateProject');
      return;
    }
    if (link.startsWith('/admin')) {
      navigation.navigate('Admin');
      return;
    }
    navigation.navigate('MainTabs', { screen: 'HomeTab' });
  };

  const openNotification = async (n) => {
    await markOne(n);
    openLink(n.link);
  };

  return (
    <Screen
      topInset
      refreshing={notificationsLoading}
      onRefresh={refreshNotifications}
    >
      <SectionHeader
        title="Thông báo"
        subtitle={unread > 0 ? `${unread} thông báo chưa đọc` : 'Bạn đã đọc hết thông báo'}
        action={
          <Pressable onPress={refreshNotifications} hitSlop={8}>
            <Ionicons name="refresh" size={20} color={colors.primary} />
          </Pressable>
        }
      />

      <View style={{ flexDirection: 'row', marginBottom: 10 }}>
        {[
          ['all', `Tất cả (${notifications.length})`],
          ['unread', `Chưa đọc (${unread})`],
        ].map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setFilter(key)}
            style={{
              backgroundColor: filter === key ? '#1e293b' : colors.white,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 7,
              marginRight: 6,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: filter === key ? '#fff' : colors.muted }}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flexDirection: 'row', marginBottom: 10 }}>
        <Pressable onPress={markAll} disabled={busy === 'all' || unread === 0}>
          <Text style={{ fontSize: 12, color: unread === 0 ? colors.soft : colors.primary, fontWeight: '700', marginRight: 16 }}>
            Đánh dấu đã đọc hết
          </Text>
        </Pressable>
        <Pressable onPress={clearAll} disabled={busy === 'clear' || notifications.length === 0}>
          <Text style={{ fontSize: 12, color: notifications.length === 0 ? colors.soft : colors.red, fontWeight: '700' }}>
            Xóa hết
          </Text>
        </Pressable>
      </View>

      {notificationsLoading && notifications.length === 0 ? <Loading text="Đang tải thông báo…" /> : null}

      {!notificationsLoading && items.length === 0 ? (
        <EmptyState
          icon="🔔"
          title={filter === 'unread' ? 'Không có thông báo chưa đọc' : 'Chưa có thông báo'}
        >
          Theo dõi dự án hoặc tài trợ để nhận cập nhật mới.
        </EmptyState>
      ) : null}

      {items.map((n) => {
        const [icon, label] = TYPE_META[n.type] || ['🔔', n.type];
        return (
          <Pressable
            key={n.id}
            onPress={() => openNotification(n)}
            style={{
              backgroundColor: n.is_read ? colors.white : colors.primaryPale,
              borderColor: n.is_read ? colors.border : colors.primarySoft,
              borderWidth: 1,
              borderRadius: radius.md,
              padding: 11,
              marginBottom: 8,
              flexDirection: 'row',
              alignItems: 'flex-start',
            }}
          >
            <Text style={{ fontSize: 22, marginRight: 8 }}>{icon}</Text>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                <View style={{ backgroundColor: colors.slateSoft, borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2, marginRight: 5 }}>
                  <Text style={{ fontSize: 9, fontWeight: '800', color: '#475569' }}>{label}</Text>
                </View>
                {!n.is_read ? (
                  <View style={{ backgroundColor: colors.primary, borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 9, fontWeight: '800', color: '#fff' }}>Mới</Text>
                  </View>
                ) : null}
              </View>
              <Text style={{ fontSize: 12, color: '#334155', marginTop: 4, lineHeight: 18 }}>{n.content}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                <Text style={{ fontSize: 10, color: colors.soft }}>{timeAgo(n.created_at)}</Text>
                {n.link ? <Text style={{ fontSize: 10, color: colors.soft, marginLeft: 6 }}>· Bấm để xem chi tiết →</Text> : null}
              </View>
            </View>
            <View style={{ alignItems: 'flex-end', marginLeft: 6 }}>
              {!n.is_read ? (
                <Pressable
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    markOne(n);
                  }}
                  hitSlop={6}
                >
                  <Text style={{ fontSize: 10, color: colors.primary, fontWeight: '700', marginBottom: 6 }}>Đã đọc</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={(e) => {
                  e?.stopPropagation?.();
                  removeOne(n.id);
                }}
                disabled={busy === n.id}
                hitSlop={6}
              >
                <Ionicons name="trash-outline" size={15} color={colors.soft} />
              </Pressable>
            </View>
          </Pressable>
        );
      })}
    </Screen>
  );
}
