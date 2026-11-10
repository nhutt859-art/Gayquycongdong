import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import {
  compactMoney,
  formatDate,
  formatDateTime,
  kycVi,
  roleVi,
  transactionStatusVi,
  vnd,
} from '../lib/format';
import { colors } from '../theme';
import {
  AIBox,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FraudRiskCard,
  Input,
  Loading,
  ModalSheet,
  Screen,
  SectionHeader,
  StatTile,
  StatusBadge,
} from '../components/ui';

const TABS = [
  ['overview', 'Tổng quan'],
  ['pending', 'Duyệt dự án'],
  ['payouts', 'Giải ngân'],
  ['fraud', 'Gian lận'],
  ['users', 'Người dùng'],
  ['categories', 'Danh mục'],
];

export default function AdminScreen({ navigation, route }) {
  const { currentUser, toast, refreshCategories } = useApp();
  const [tab, setTab] = useState(route.params?.tab || 'overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);
  const [pendingProjects, setPendingProjects] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [flags, setFlags] = useState([]);
  const [reports, setReports] = useState([]);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [newCategory, setNewCategory] = useState({ name: '', description: '' });
  const [editingCategory, setEditingCategory] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'overview') {
        setStats(await api.get('/admin/stats'));
      } else if (tab === 'pending') {
        const data = await api.get('/admin/projects?status=pending_review');
        setPendingProjects(data?.items || []);
      } else if (tab === 'payouts') {
        const data = await api.get('/admin/payouts');
        setPayouts(data?.items || []);
      } else if (tab === 'fraud') {
        const [f, r, s] = await Promise.all([
          api.get('/admin/fraud-flags'),
          api.get('/admin/reports'),
          api.get('/admin/stats'),
        ]);
        setFlags(f?.items || []);
        setReports(r?.items || []);
        setStats(s);
      } else if (tab === 'users') {
        const data = await api.get('/admin/users');
        setUsers(data?.items || []);
      } else if (tab === 'categories') {
        const data = await api.get('/admin/categories');
        setCategories(data?.items || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load, reloadTick]);

  const refresh = () => setReloadTick((t) => t + 1);

  const approveProject = async (project) => {
    setBusy(project.id);
    try {
      await api.post(`/admin/projects/${project.id}/approve`);
      toast('Đã duyệt công khai dự án.', 'success');
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
      toast('Lý do từ chối tối thiểu 5 ký tự.', 'warning');
      return;
    }
    setBusy(rejectTarget.id);
    try {
      await api.post(`/admin/projects/${rejectTarget.id}/reject`, { reason: rejectReason.trim() });
      toast('Đã từ chối dự án.', 'success');
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
    setBusy(flag.id);
    try {
      await api.patch(`/admin/fraud-flags/${flag.id}`, { review_status: status });
      toast('Đã cập nhật trạng thái cảnh báo.', 'success');
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
      toast('Đã cập nhật báo cáo.', 'success');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const toggleUser = async (user) => {
    const next = user.status === 'active' ? 'locked' : 'active';
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

  const addCategory = async () => {
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
      await refreshCategories();
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const saveCategory = async () => {
    if (!editingCategory) return;
    if (editingCategory.name.trim().length < 2) {
      toast('Tên danh mục tối thiểu 2 ký tự.', 'warning');
      return;
    }
    setBusy(editingCategory.id);
    try {
      await api.patch(`/admin/categories/${editingCategory.id}`, {
        name: editingCategory.name.trim(),
        description: editingCategory.description?.trim() || null,
      });
      setEditingCategory(null);
      toast('Đã cập nhật danh mục.', 'success');
      await refreshCategories();
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const deleteCategory = async (category) => {
    setBusy(category.id);
    try {
      await api.del(`/admin/categories/${category.id}`);
      toast('Đã xóa danh mục.', 'success');
      await refreshCategories();
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.full_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q),
    );
  }, [users, userSearch]);

  if (!currentUser || currentUser.role !== 'admin') {
    return (
      <Screen>
        <Card style={{ padding: 22, alignItems: 'center' }}>
          <Text style={{ fontSize: 42 }}>🛡️</Text>
          <Text style={{ fontSize: 18, fontWeight: '900', marginTop: 8 }}>Khu vực quản trị</Text>
          <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 5 }}>
            Chỉ tài khoản quản trị viên mới truy cập được.
          </Text>
          <Button title="Về trang chủ" onPress={() => navigation.navigate('MainTabs')} style={{ marginTop: 14, width: '100%' }} />
        </Card>
      </Screen>
    );
  }

  const chartMax = Math.max(1, ...((stats?.chart || []).map((d) => Number(d.amount) || 0)));

  return (
    <Screen>
      <SectionHeader
        title="Quản trị hệ thống"
        subtitle="Duyệt dự án, giải ngân, kiểm chứng gian lận và quản lý người dùng"
        action={
          <Pressable onPress={refresh} hitSlop={8}>
            <Ionicons name="refresh" size={20} color={colors.primary} />
          </Pressable>
        }
      />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
        {TABS.map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setTab(key)}
            style={{
              backgroundColor: tab === key ? '#1e293b' : colors.white,
              borderRadius: 9,
              paddingHorizontal: 10,
              paddingVertical: 7,
              marginRight: 5,
              marginBottom: 5,
            }}
          >
            <Text style={{ fontSize: 10, fontWeight: '700', color: tab === key ? '#fff' : colors.muted }}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? <Loading text="Đang tải dữ liệu quản trị…" /> : null}
      {!loading && error ? <ErrorState message={error} onRetry={refresh} /> : null}

      {!loading && !error && tab === 'overview' && stats ? (
        <View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {[
              ['Tổng huy động', compactMoney(stats.total_raised), vnd(stats.total_raised), colors.primary],
              ['Đang gây quỹ', String(stats.active_projects), `${stats.total_projects} dự án`, colors.text],
              ['Tỉ lệ thành công', `${stats.success_rate}%`, `${stats.successful_projects} thành công`, colors.blue],
              ['Cảnh báo mở', String(stats.open_flags), `${stats.open_reports} báo cáo`, stats.open_flags ? colors.red : colors.primary],
              ['Người dùng hoạt động', String(stats.active_users), '', colors.text],
              ['Khoản tài trợ đã trả', String(stats.paid_pledges), '', colors.text],
              ['Báo cáo chờ xử lý', String(stats.open_reports), '', stats.open_reports ? colors.amber : colors.text],
              ['Dự án chờ duyệt', String(stats.pending_projects), 'Xem tab Duyệt dự án', colors.text],
            ].map(([label, value, hint, tone]) => (
              <View key={label} style={{ width: '50%', padding: 3 }}>
                <StatTile label={label} value={value} hint={hint} tone={tone} />
              </View>
            ))}
          </View>

          <Card style={{ padding: 14, marginTop: 8 }}>
            <Text style={{ fontWeight: '800', fontSize: 13 }}>Tốc độ tài trợ 7 ngày qua</Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 130, marginTop: 12 }}>
              {(stats.chart || []).map((d) => (
                <View key={d.day} style={{ flex: 1, alignItems: 'center', marginHorizontal: 1 }}>
                  <Text style={{ fontSize: 8, color: colors.muted }}>{d.pledges} lượt</Text>
                  <View
                    style={{
                      width: '80%',
                      height: Math.max(4, (Number(d.amount) / chartMax) * 82),
                      backgroundColor: colors.primary,
                      borderTopLeftRadius: 3,
                      borderTopRightRadius: 3,
                    }}
                  />
                  <Text style={{ fontSize: 8, color: colors.soft, marginTop: 3 }}>{formatDate(d.day).slice(0, 5)}</Text>
                </View>
              ))}
            </View>
          </Card>

          <Card style={{ padding: 14, marginTop: 8 }}>
            <Text style={{ fontWeight: '800', fontSize: 13 }}>Top danh mục theo số tiền</Text>
            {(stats.top_categories || []).map((c) => (
              <View key={c.name} style={{ marginTop: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12 }}>{c.name}</Text>
                  <Text style={{ fontSize: 12, fontWeight: '800' }}>{vnd(c.total)}</Text>
                </View>
                <View style={{ height: 5, backgroundColor: '#e2e8f0', borderRadius: 99, marginTop: 3 }}>
                  <View
                    style={{
                      height: '100%',
                      width: `${Math.max(2, (Number(c.total) / Math.max(1, Number(stats.total_raised))) * 100)}%`,
                      backgroundColor: colors.primary,
                      borderRadius: 99,
                    }}
                  />
                </View>
                <Text style={{ fontSize: 9, color: colors.soft, marginTop: 2 }}>{c.projects} dự án</Text>
              </View>
            ))}
          </Card>

          <Card style={{ padding: 14, marginTop: 8 }}>
            <Text style={{ fontWeight: '800', fontSize: 13 }}>Tình trạng giám sát</Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 5, lineHeight: 18 }}>
              Hệ thống đang theo dõi {stats.total_projects} dự án và {stats.paid_pledges} giao dịch đã thanh toán.
            </Text>
            <Text style={{ fontSize: 12, color: stats.open_flags ? colors.amber : colors.primary, marginTop: 4 }}>
              {stats.open_flags > 0
                ? `Có ${stats.open_flags} cảnh báo gian lận cần xác minh.`
                : 'Chưa có cảnh báo gian lận nào đang mở.'}
            </Text>
            {stats.fraud_model ? (
              <View style={{ backgroundColor: colors.slateSoft, borderRadius: 10, padding: 9, marginTop: 8 }}>
                <Text style={{ fontSize: 10, color: colors.muted }}>
                  Mô hình gian lận: {stats.fraud_model.project_model} / {stats.fraud_model.pledge_model} · ngưỡng{' '}
                  {stats.fraud_model.threshold}%
                </Text>
              </View>
            ) : null}
            {stats.ai_model ? (
              <View style={{ backgroundColor: colors.indigoSoft, borderRadius: 10, padding: 9, marginTop: 6 }}>
                <Text style={{ fontSize: 10, color: colors.indigo }}>
                  AI: {stats.ai_model.version} · AUC {stats.ai_model.metrics?.auc ?? '—'} · Accuracy{' '}
                  {stats.ai_model.metrics?.accuracy ?? '—'}
                </Text>
              </View>
            ) : null}
          </Card>
        </View>
      ) : null}

      {!loading && !error && tab === 'pending' ? (
        <View>
          <SectionHeader title={`Dự án chờ duyệt (${pendingProjects.length})`} />
          {pendingProjects.length === 0 ? (
            <EmptyState icon="✅" title="Không còn dự án chờ duyệt">Mọi dự án đã được xử lý.</EmptyState>
          ) : (
            pendingProjects.map((p) => (
              <Card key={p.id} style={{ padding: 12, marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <Text style={{ fontSize: 28, marginRight: 8 }}>{p.cover_emoji || '📁'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '800', fontSize: 13 }}>{p.title}</Text>
                    <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>
                      {p.owner_name} · {p.owner_email} · {p.category_name}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 5 }}>
                      <Badge label={`Mục tiêu ${vnd(p.goal_amount)}`} />
                      <Badge label={`AI ${Math.round(p.ai_success_score)}%`} tone="amber" style={{ marginLeft: 4 }} />
                      <Badge
                        label={`Rủi ro ${Math.round(p.fraud_risk_score)}%`}
                        tone={Number(p.fraud_risk_score) >= 60 ? 'red' : 'slate'}
                        style={{ marginLeft: 4 }}
                      />
                    </View>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', marginTop: 8 }}>
                  <Button
                    title="Xem hồ sơ"
                    variant="ghost"
                    onPress={() => navigation.navigate('ProjectDetail', { id: p.id })}
                    style={{ flex: 1, marginRight: 5 }}
                  />
                  <Button
                    title="Duyệt"
                    loading={busy === p.id}
                    onPress={() => approveProject(p)}
                    style={{ flex: 1, marginRight: 5 }}
                  />
                  <Button
                    title="Từ chối"
                    variant="danger"
                    onPress={() => {
                      setRejectTarget(p);
                      setRejectReason('');
                    }}
                    style={{ flex: 1 }}
                  />
                </View>
              </Card>
            ))
          )}
        </View>
      ) : null}

      {!loading && !error && tab === 'payouts' ? (
        <View>
          <SectionHeader title="Yêu cầu giải ngân" subtitle={`${payouts.length} yêu cầu`} />
          {payouts.length === 0 ? (
            <EmptyState icon="🏦" title="Chưa có yêu cầu giải ngân" />
          ) : (
            payouts.map((p) => (
              <Card key={p.id} style={{ padding: 12, marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '800', fontSize: 13 }}>{p.project_title}</Text>
                    <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>
                      {p.owner_name} · {p.owner_email}
                    </Text>
                    <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>
                      Số tiền <Text style={{ fontWeight: '800', color: colors.text }}>{vnd(p.amount)}</Text> · Đã huy động{' '}
                      {vnd(p.current_amount)} · {formatDate(p.created_at)}
                    </Text>
                    <Text style={{ fontSize: 9, color: colors.soft }}>{p.gateway_ref}</Text>
                  </View>
                  <Badge
                    label={transactionStatusVi[p.status] || p.status}
                    tone={p.status === 'success' ? 'emerald' : p.status === 'failed' ? 'red' : 'amber'}
                  />
                </View>
                {p.status === 'pending' ? (
                  <View style={{ flexDirection: 'row', marginTop: 8 }}>
                    <Button
                      title="Duyệt"
                      loading={busy === p.id}
                      onPress={() => reviewPayout(p, 'approve')}
                      style={{ flex: 1, marginRight: 5 }}
                    />
                    <Button
                      title="Từ chối"
                      variant="danger"
                      onPress={() => reviewPayout(p, 'reject')}
                      style={{ flex: 1 }}
                    />
                  </View>
                ) : null}
              </Card>
            ))
          )}
        </View>
      ) : null}

      {!loading && !error && tab === 'fraud' ? (
        <View>
          <AIBox variant={flags.some((f) => f.review_status === 'pending') ? 'warn' : 'success'} title="KIỂM CHỨNG GIAN LẬN">
            <Text style={{ fontSize: 12, color: '#334155', lineHeight: 18 }}>
              Hệ thống chấm điểm từ các tín hiệu độc lập: KYC, tín nhiệm, lịch sử chủ dự án, mục tiêu so với danh mục, tần suất
              giao dịch, độ lệch số tiền và hành vi ẩn danh. Mỗi cảnh báo đều lưu bằng chứng để quản trị viên xác minh.
            </Text>
          </AIBox>

          <SectionHeader title={`Cảnh báo (${flags.length})`} />
          {flags.length === 0 ? (
            <EmptyState icon="🛡️" title="Chưa có cảnh báo gian lận" />
          ) : (
            flags.map((f) => (
              <View key={f.id} style={{ marginBottom: 8 }}>
                <FraudRiskCard flags={[f]} riskScore={f.risk_score} threshold={60} title={f.entity_label || f.entity_id} />
                <Card style={{ padding: 10 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    {f.entity_type === 'user' ? 'Người dùng' : f.entity_type === 'project' ? 'Dự án' : 'Giao dịch'} ·{' '}
                    {formatDateTime(f.flagged_at)} · {f.model_version}
                  </Text>
                  {f.review_status === 'pending' ? (
                    <View style={{ flexDirection: 'row', marginTop: 8 }}>
                      <Button
                        title="Xác nhận — xử lý"
                        loading={busy === f.id}
                        onPress={() => reviewFlag(f, 'confirmed')}
                        style={{ flex: 1, marginRight: 5 }}
                      />
                      <Button
                        title="Báo nhầm"
                        variant="ghost"
                        onPress={() => reviewFlag(f, 'false_positive')}
                        style={{ flex: 1 }}
                      />
                    </View>
                  ) : (
                    <Text style={{ fontSize: 10, color: colors.soft, marginTop: 5 }}>
                      Đã xử lý{f.reviewer_email ? ` bởi ${f.reviewer_email}` : ''}
                      {f.reviewed_at ? ` · ${formatDateTime(f.reviewed_at)}` : ''}
                    </Text>
                  )}
                </Card>
              </View>
            ))
          )}

          <SectionHeader title={`Báo cáo từ người dùng (${reports.length})`} />
          {reports.length === 0 ? (
            <Card style={{ padding: 14 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Chưa có báo cáo.</Text>
            </Card>
          ) : (
            reports.map((r) => (
              <Card key={r.id} style={{ padding: 12, marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '800', fontSize: 12 }}>{r.project_title}</Text>
                    <Text style={{ fontSize: 11, color: '#334155', marginTop: 3 }}>{r.reason}</Text>
                    <Text style={{ fontSize: 9, color: colors.soft, marginTop: 3 }}>
                      {r.reporter_name} · {r.reporter_email} · {formatDateTime(r.created_at)}
                    </Text>
                  </View>
                  <Badge
                    label={r.status === 'open' ? 'Mới' : r.status === 'reviewed' ? 'Đã xem' : 'Đã đóng'}
                    tone={r.status === 'open' ? 'amber' : r.status === 'reviewed' ? 'blue' : 'slate'}
                  />
                </View>
                {r.status === 'open' ? (
                  <View style={{ flexDirection: 'row', marginTop: 6 }}>
                    <Pressable onPress={() => updateReport(r, 'reviewed')} style={{ marginRight: 14 }}>
                      <Text style={{ fontSize: 11, color: colors.primary, fontWeight: '700' }}>Đánh dấu đã xem</Text>
                    </Pressable>
                    <Pressable onPress={() => updateReport(r, 'closed')}>
                      <Text style={{ fontSize: 11, color: colors.muted, fontWeight: '700' }}>Đóng</Text>
                    </Pressable>
                  </View>
                ) : null}
              </Card>
            ))
          )}
        </View>
      ) : null}

      {!loading && !error && tab === 'users' ? (
        <View>
          <SectionHeader title={`Người dùng (${filteredUsers.length})`} />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: colors.slateSoft,
              borderRadius: 10,
              paddingHorizontal: 10,
              marginBottom: 8,
            }}
          >
            <Ionicons name="search" size={17} color={colors.soft} />
            <TextInput
              value={userSearch}
              onChangeText={setUserSearch}
              placeholder="Tìm theo tên hoặc email…"
              placeholderTextColor={colors.soft}
              style={{ flex: 1, paddingVertical: 9, paddingHorizontal: 7, color: colors.text }}
            />
          </View>
          {filteredUsers.length === 0 ? (
            <Card style={{ padding: 14 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Không tìm thấy người dùng phù hợp.</Text>
            </Card>
          ) : (
            filteredUsers.map((u) => (
              <Card key={u.id} style={{ padding: 11, marginBottom: 7 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '800', fontSize: 13 }}>{u.full_name}</Text>
                    <Text style={{ fontSize: 10, color: colors.muted }}>{u.email}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
                      <Badge label={roleVi[u.role] || u.role} tone="indigo" />
                      <Badge
                        label={kycVi[u.kyc_status] || u.kyc_status}
                        tone={u.kyc_status === 'verified' ? 'emerald' : u.kyc_status === 'pending' ? 'amber' : 'slate'}
                        style={{ marginLeft: 4 }}
                      />
                      <Badge
                        label={u.status === 'active' ? 'Hoạt động' : 'Đã khóa'}
                        tone={u.status === 'active' ? 'emerald' : 'red'}
                        style={{ marginLeft: 4 }}
                      />
                    </View>
                    <Text style={{ fontSize: 9, color: colors.soft, marginTop: 3 }}>
                      Tin cậy {Math.round(Number(u.trust_score))} · {u.owned_projects} dự án · {u.paid_pledges} tài trợ
                    </Text>
                  </View>
                  <Button
                    title={u.status === 'active' ? 'Khóa' : 'Mở khóa'}
                    variant={u.status === 'active' ? 'danger' : 'soft'}
                    loading={busy === u.id}
                    onPress={() => toggleUser(u)}
                    style={{ minHeight: 34, paddingHorizontal: 10 }}
                    textStyle={{ fontSize: 10 }}
                  />
                </View>
              </Card>
            ))
          )}
        </View>
      ) : null}

      {!loading && !error && tab === 'categories' ? (
        <View>
          <SectionHeader title="Quản lý danh mục" subtitle={`${categories.length} danh mục`} />
          <Card style={{ padding: 12 }}>
            <Input
              label="Tên danh mục"
              value={newCategory.name}
              onChangeText={(v) => setNewCategory((c) => ({ ...c, name: v }))}
              placeholder="VD: Nông nghiệp"
            />
            <Input
              label="Mô tả"
              value={newCategory.description}
              onChangeText={(v) => setNewCategory((c) => ({ ...c, description: v }))}
              placeholder="Mô tả ngắn"
            />
            <Button title="+ Thêm danh mục" onPress={addCategory} loading={busy === 'new-category'} />
          </Card>

          {categories.map((c) => (
            <Card key={c.id} style={{ padding: 11, marginTop: 7 }}>
              {editingCategory?.id === c.id ? (
                <View>
                  <Input
                    label="Tên"
                    value={editingCategory.name}
                    onChangeText={(v) => setEditingCategory((e) => ({ ...e, name: v }))}
                  />
                  <Input
                    label="Mô tả"
                    value={editingCategory.description || ''}
                    onChangeText={(v) => setEditingCategory((e) => ({ ...e, description: v }))}
                  />
                  <View style={{ flexDirection: 'row' }}>
                    <Button title="Lưu" onPress={saveCategory} loading={busy === c.id} style={{ flex: 1, marginRight: 5 }} />
                    <Button title="Hủy" variant="ghost" onPress={() => setEditingCategory(null)} style={{ flex: 1 }} />
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '800', fontSize: 13 }}>{c.name}</Text>
                    <Text style={{ fontSize: 10, color: colors.muted }}>{c.description || '—'}</Text>
                    <Badge label={`${c.project_count} dự án`} style={{ marginTop: 4 }} />
                  </View>
                  <Pressable
                    onPress={() => setEditingCategory({ id: c.id, name: c.name, description: c.description || '' })}
                    hitSlop={8}
                    style={{ marginRight: 12 }}
                  >
                    <Ionicons name="create-outline" size={18} color={colors.primary} />
                  </Pressable>
                  <Pressable onPress={() => deleteCategory(c)} disabled={c.project_count > 0} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color={c.project_count > 0 ? colors.soft : colors.red} />
                  </Pressable>
                </View>
              )}
            </Card>
          ))}
        </View>
      ) : null}

      <ModalSheet open={!!rejectTarget} title="Từ chối dự án" onClose={() => setRejectTarget(null)}>
        <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 8, lineHeight: 18 }}>
          Dự án <Text style={{ fontWeight: '800', color: colors.text }}>{rejectTarget?.title}</Text> sẽ chuyển sang trạng thái “Đã
          dừng”. Chủ dự án sẽ nhận thông báo kèm lý do.
        </Text>
        <Input
          label="Lý do từ chối"
          value={rejectReason}
          onChangeText={setRejectReason}
          placeholder="Tối thiểu 5 ký tự…"
          multiline
        />
        <Button title="Xác nhận từ chối" variant="danger" onPress={rejectProject} loading={busy === rejectTarget?.id} />
      </ModalSheet>
    </Screen>
  );
}
