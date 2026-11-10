import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import {
  formatDate,
  formatDateTime,
  kycVi,
  pledgeStatusVi,
  roleVi,
  transactionStatusVi,
  transactionTypeVi,
  vnd,
} from '../lib/format';
import { colors } from '../theme';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  Input,
  Loading,
  Screen,
  SectionHeader,
  StatTile,
} from '../components/ui';

export default function ProfileScreen({ navigation }) {
  const {
    currentUser,
    interests,
    stats,
    notifications,
    refreshSession,
    updateCurrentUser,
    resendVerification,
    logout,
    toast,
  } = useApp();
  const [pledges, setPledges] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState({ full_name: '', phone: '', avatar_url: '' });
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [kycBusy, setKycBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState('');

  useEffect(() => {
    if (!currentUser) return;
    setForm({
      full_name: currentUser.full_name || '',
      phone: currentUser.phone || '',
      avatar_url: currentUser.avatar_url || '',
    });
  }, [currentUser]);

  const loadHistory = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setLoadError('');
    try {
      const [pledgeData, txData] = await Promise.all([api.get('/me/pledges'), api.get('/me/transactions')]);
      setPledges(pledgeData?.items || []);
      setTransactions(txData?.items || []);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory]),
  );

  const startKyc = async () => {
    setKycBusy(true);
    try {
      const data = await api.post('/me/kyc');
      updateCurrentUser(data.user);
      await refreshSession();
      toast('Xác thực danh tính thành công.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setKycBusy(false);
    }
  };

  const saveProfile = async () => {
    if (form.full_name.trim().length < 2) {
      setProfileError('Họ tên tối thiểu 2 ký tự.');
      return;
    }
    setProfileBusy(true);
    setProfileError('');
    try {
      const data = await api.patch('/me', {
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        avatar_url: form.avatar_url.trim() || null,
      });
      updateCurrentUser(data.user);
      await refreshSession();
      toast('Đã cập nhật hồ sơ.', 'success');
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setProfileBusy(false);
    }
  };

  const resendEmail = async () => {
    setEmailBusy(true);
    setEmailMsg('');
    try {
      await resendVerification(currentUser.email);
      setEmailMsg('Nếu email hợp lệ, hướng dẫn xác thực đã được gửi lại.');
    } catch (err) {
      setEmailMsg(err.message);
    } finally {
      setEmailBusy(false);
    }
  };

  const doLogout = async () => {
    await logout();
    toast('Đã đăng xuất.', 'info');
    navigation.navigate('MainTabs', { screen: 'HomeTab' });
  };

  if (!currentUser) {
    return (
      <Screen topInset>
        <Card style={{ padding: 22, alignItems: 'center' }}>
          <Text style={{ fontSize: 44 }}>👤</Text>
          <Text style={{ fontSize: 19, fontWeight: '900', marginTop: 8 }}>Bạn chưa đăng nhập</Text>
          <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 5, lineHeight: 19 }}>
            Đăng nhập để theo dõi dự án, tài trợ, nhận gợi ý AI và quản lý chiến dịch của bạn.
          </Text>
          <Button title="Đăng nhập" onPress={() => navigation.navigate('Auth')} style={{ marginTop: 14, width: '100%' }} />
          <Button
            title="Tạo tài khoản"
            variant="ghost"
            onPress={() => navigation.navigate('Auth', { mode: 'register' })}
            style={{ marginTop: 8, width: '100%' }}
          />
        </Card>
      </Screen>
    );
  }

  const unread = notifications.filter((n) => !n.is_read).length;
  const isAdmin = currentUser.role === 'admin';

  return (
    <Screen topInset>
      <Card style={{ padding: 16, marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Avatar name={currentUser.full_name} size={58} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: '900' }}>{currentUser.full_name}</Text>
            <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{currentUser.email}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
              <Badge label={roleVi[currentUser.role] || currentUser.role} tone="indigo" />
              <Badge
                label={kycVi[currentUser.kyc_status] || currentUser.kyc_status}
                tone={currentUser.kyc_status === 'verified' ? 'emerald' : currentUser.kyc_status === 'pending' ? 'amber' : 'slate'}
                style={{ marginLeft: 5 }}
              />
            </View>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 10, color: colors.muted }}>Tin cậy</Text>
            <Text style={{ fontSize: 20, fontWeight: '900', color: colors.primary }}>
              {Math.round(Number(currentUser.trust_score || 0))}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 }}>
          <View style={{ width: '50%', padding: 3 }}>
            <StatTile label="Dự án sở hữu" value={stats.owned_projects ?? 0} />
          </View>
          <View style={{ width: '50%', padding: 3 }}>
            <StatTile label="Dự án cộng tác" value={stats.collaborating_projects ?? 0} />
          </View>
          <View style={{ width: '50%', padding: 3 }}>
            <StatTile label="Tổng đã tài trợ" value={vnd(stats.total_pledged ?? 0)} />
          </View>
          <View style={{ width: '50%', padding: 3 }}>
            <StatTile label="Thông báo chưa đọc" value={unread} />
          </View>
        </View>

        <View style={{ marginTop: 10 }}>
          {currentUser.email_verified ? (
            <Text style={{ fontSize: 11, color: colors.primary }}>✓ Email đã xác thực.</Text>
          ) : (
            <>
              <Text style={{ fontSize: 11, color: colors.amber }}>⚠ Email chưa xác thực — hãy xác thực để bảo vệ tài khoản.</Text>
              <Button
                title="Gửi lại email xác thực"
                variant="ghost"
                loading={emailBusy}
                onPress={resendEmail}
                style={{ marginTop: 6 }}
              />
              {emailMsg ? <Text style={{ fontSize: 10, color: colors.muted, marginTop: 4 }}>{emailMsg}</Text> : null}
            </>
          )}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 }}>
          {currentUser.role !== 'admin' ? (
            <Button
              title="Tạo dự án"
              icon="add-circle-outline"
              onPress={() => navigation.navigate('CreateProject')}
              style={{ flex: 1, marginRight: 6 }}
            />
          ) : null}
          <Button
            title="Dự án của tôi"
            icon="folder-open-outline"
            variant="ghost"
            onPress={() => navigation.navigate('MyProjects')}
            style={{ flex: 1, marginLeft: currentUser.role !== 'admin' ? 0 : 0 }}
          />
        </View>
        {isAdmin ? (
          <Button
            title="Bảng quản trị"
            icon="shield-checkmark-outline"
            variant="dark"
            onPress={() => navigation.navigate('Admin')}
            style={{ marginTop: 8 }}
          />
        ) : null}
      </Card>

      <Card style={{ padding: 14, marginBottom: 12 }}>
        <SectionHeader title="Hồ sơ cá nhân" subtitle="Cập nhật tên hiển thị và thông tin liên hệ" />
        <Input label="Họ và tên" value={form.full_name} onChangeText={(v) => setForm((f) => ({ ...f, full_name: v }))} />
        <Input
          label="Số điện thoại"
          value={form.phone}
          onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
          keyboardType="phone-pad"
          placeholder="09xxxxxxxx"
        />
        <Input
          label="Ảnh đại diện (URL)"
          value={form.avatar_url}
          onChangeText={(v) => setForm((f) => ({ ...f, avatar_url: v }))}
          placeholder="https://…"
          autoCapitalize="none"
        />
        {profileError ? <Text style={{ fontSize: 11, color: colors.red, marginBottom: 6 }}>{profileError}</Text> : null}
        <Button title="Lưu hồ sơ" onPress={saveProfile} loading={profileBusy} />
        {currentUser.kyc_status !== 'verified' ? (
          <Button
            title="Xác thực danh tính (KYC mô phỏng)"
            variant="soft"
            icon="id-card-outline"
            onPress={startKyc}
            loading={kycBusy}
            style={{ marginTop: 8 }}
          />
        ) : null}
      </Card>

      <Card style={{ padding: 14, marginBottom: 12 }}>
        <SectionHeader
          title="Chủ đề quan tâm"
          subtitle="AI dùng để cá nhân hoá gợi ý"
          action={
            <Pressable onPress={() => navigation.navigate('Onboarding')}>
              <Text style={{ fontSize: 11, color: colors.primary, fontWeight: '800' }}>Điều chỉnh</Text>
            </Pressable>
          }
        />
        {interests.length === 0 ? (
          <Text style={{ fontSize: 12, color: colors.muted }}>Chưa chọn chủ đề.</Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {interests.map((i) => (
              <Badge key={i.category_id} label={i.name} tone="emerald" style={{ marginRight: 5, marginBottom: 5 }} />
            ))}
          </View>
        )}
      </Card>

      <SectionHeader title="Lịch sử tài trợ" subtitle={`${pledges.length} khoản đã ghi nhận`} />
      {loading ? <Loading text="Đang tải lịch sử…" /> : null}
      {!loading && loadError ? (
        <Card style={{ padding: 14 }}>
          <Text style={{ fontSize: 12, color: colors.red }}>{loadError}</Text>
          <Button title="Thử lại" variant="ghost" onPress={loadHistory} style={{ marginTop: 8 }} />
        </Card>
      ) : null}
      {!loading && !loadError && pledges.length === 0 ? (
        <EmptyState icon="💚" title="Chưa có khoản tài trợ">
          Khám phá các chiến dịch và chung tay cùng cộng đồng.
        </EmptyState>
      ) : null}
      {!loading && !loadError
        ? pledges.map((p) => (
            <Card key={p.id} style={{ padding: 12, marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <Text style={{ fontSize: 24, marginRight: 8 }}>{p.cover_emoji || '🌱'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', fontSize: 13 }} numberOfLines={2}>{p.project_title}</Text>
                  <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>
                    {formatDateTime(p.created_at)} · {vnd(p.amount)}
                    {p.reward_title ? ` · ${p.reward_title}` : ''}
                  </Text>
                </View>
                <Badge
                  label={pledgeStatusVi[p.status] || p.status}
                  tone={p.status === 'paid' ? 'emerald' : p.status === 'failed' ? 'red' : 'amber'}
                />
              </View>
              <Pressable
                onPress={() => navigation.navigate('ProjectDetail', { id: p.project_id })}
                style={{ marginTop: 6 }}
              >
                <Text style={{ fontSize: 11, color: colors.primary, fontWeight: '700' }}>Xem dự án →</Text>
              </Pressable>
            </Card>
          ))
        : null}

      <SectionHeader title="Giao dịch" subtitle={`${transactions.length} giao dịch`} />
      {!loading && !loadError && transactions.length === 0 ? (
        <Card style={{ padding: 14 }}>
          <Text style={{ fontSize: 12, color: colors.muted }}>Chưa có giao dịch.</Text>
        </Card>
      ) : null}
      {!loading && !loadError
        ? transactions.slice(0, 20).map((t) => (
            <Card key={`${t.id}-${t.type}`} style={{ padding: 10, marginBottom: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons
                  name={t.type === 'refund' ? 'return-down-back' : t.type === 'payout' ? 'bank-outline' : 'card-outline'}
                  size={18}
                  color={colors.muted}
                />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700' }}>
                    {transactionTypeVi[t.type] || t.type} · {vnd(t.amount)}
                  </Text>
                  <Text style={{ fontSize: 10, color: colors.muted }} numberOfLines={1}>
                    {t.project_title} · {formatDate(t.created_at)}
                  </Text>
                </View>
                <Badge
                  label={transactionStatusVi[t.status] || t.status}
                  tone={t.status === 'success' ? 'emerald' : t.status === 'failed' ? 'red' : 'amber'}
                />
              </View>
            </Card>
          ))
        : null}

      <Divider />
      <Button title="Đăng xuất" variant="danger" icon="log-out-outline" onPress={doLogout} />
      <Text style={{ fontSize: 10, color: colors.soft, textAlign: 'center', marginTop: 14 }}>
        GâyQuỹ+ · Nền tảng gây quỹ cộng đồng có AI đồng hành
      </Text>
    </Screen>
  );
}
