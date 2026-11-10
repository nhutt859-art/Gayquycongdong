import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import {
  daysLeft,
  formatDate,
  formatDateTime,
  pledgeStatusVi,
  transactionStatusVi,
  vnd,
} from '../lib/format';
import { colors } from '../theme';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FraudRiskCard,
  Input,
  Loading,
  PredictionExplain,
  ProjectCover,
  Screen,
  SectionHeader,
  StatusBadge,
  confirmAction,
} from '../components/ui';

const TABS = [
  ['overview', 'Tổng quan'],
  ['updates', 'Bản tin'],
  ['rewards', 'Gói tri ân'],
  ['collab', 'Cộng tác'],
  ['finance', 'Tài chính'],
];

export default function ManageProjectScreen({ navigation, route }) {
  const { id } = route.params;
  const { categories, toast, refreshSession } = useApp();
  const [project, setProject] = useState(null);
  const [pledges, setPledges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [form, setForm] = useState(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [updateForm, setUpdateForm] = useState({ title: '', content: '' });
  const [updateBusy, setUpdateBusy] = useState(false);
  const [rewardForm, setRewardForm] = useState({ title: '', description: '', min_amount: '100000', quantity_available: '100' });
  const [rewardBusy, setRewardBusy] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'editor' });
  const [inviteBusy, setInviteBusy] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('1000000');
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [closeOutcome, setCloseOutcome] = useState('successful');
  const [closeBusy, setCloseBusy] = useState(false);
  const isOwner = project?.my_role === 'owner';

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
  }, [load]);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const saveProject = async () => {
    if (form.title.trim().length < 10) {
      setFormError('Tên chiến dịch tối thiểu 10 ký tự.');
      return;
    }
    if (form.description.trim().length < 30) {
      setFormError('Mô tả tối thiểu 30 ký tự.');
      return;
    }
    setFormBusy(true);
    setFormError('');
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

  const postUpdate = async () => {
    if (updateForm.title.trim().length < 3 || updateForm.content.trim().length < 10) {
      toast('Tiêu đề tối thiểu 3 ký tự và nội dung tối thiểu 10 ký tự.', 'warning');
      return;
    }
    setUpdateBusy(true);
    try {
      const data = await api.post(`/projects/${id}/updates`, {
        title: updateForm.title.trim(),
        content: updateForm.content.trim(),
      });
      setProject((p) => ({ ...p, updates: [data.update, ...p.updates] }));
      setUpdateForm({ title: '', content: '' });
      toast('Đã đăng bản tin, người theo dõi sẽ nhận thông báo.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUpdateBusy(false);
    }
  };

  const addReward = async () => {
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

  const deleteReward = (reward) => {
    confirmAction('Xóa gói tri ân?', `Gói “${reward.title}” sẽ bị xóa khỏi dự án.`, async () => {
      try {
        await api.del(`/projects/${id}/rewards/${reward.id}`);
        setProject((p) => ({ ...p, rewards: p.rewards.filter((r) => r.id !== reward.id) }));
        toast('Đã xóa gói tri ân.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  };

  const invite = async () => {
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

  const removeCollaborator = (userId) => {
    confirmAction('Xóa cộng tác viên?', 'Người này sẽ không còn quyền quản lý dự án.', async () => {
      try {
        await api.del(`/projects/${id}/collaborators/${userId}`);
        setProject((p) => ({ ...p, collaborators: p.collaborators.filter((c) => c.user_id !== userId) }));
        toast('Đã xóa cộng tác viên.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  };

  const requestPayout = async () => {
    if (!Number(payoutAmount)) {
      toast('Vui lòng nhập số tiền giải ngân.', 'warning');
      return;
    }
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

  const closeProject = () => {
    confirmAction(
      'Kết thúc chiến dịch?',
      closeOutcome === 'successful'
        ? 'Dự án sẽ được đánh dấu thành công và có thể giải ngân.'
        : closeOutcome === 'failed'
          ? 'Dự án sẽ được đánh dấu thất bại và hoàn tiền cho nhà tài trợ.'
          : 'Dự án sẽ bị dừng và hoàn tiền cho nhà tài trợ.',
      async () => {
        setCloseBusy(true);
        try {
          await api.post(`/projects/${id}/close`, { outcome: closeOutcome });
          toast('Đã cập nhật trạng thái chiến dịch.', 'success');
          await Promise.all([load(), refreshSession()]);
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          setCloseBusy(false);
        }
      },
    );
  };

  if (loading) return <Screen><Loading text="Đang tải dự án…" /></Screen>;
  if (error) return <Screen><ErrorState message={error} onRetry={load} /></Screen>;
  if (!project) return null;

  if (!project.can_manage) {
    return (
      <Screen>
        <Card style={{ padding: 22, alignItems: 'center' }}>
          <Text style={{ fontSize: 42 }}>⛔</Text>
          <Text style={{ fontSize: 18, fontWeight: '900', marginTop: 8 }}>Bạn không có quyền quản lý dự án này</Text>
          <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 5 }}>
            Chỉ chủ dự án hoặc cộng tác viên đã chấp nhận lời mời mới được quản lý.
          </Text>
          <Button
            title="Về dự án của tôi"
            onPress={() => navigation.navigate('MyProjects')}
            style={{ marginTop: 14, width: '100%' }}
          />
        </Card>
      </Screen>
    );
  }

  const canClose = isOwner && ['active', 'pending_review', 'draft'].includes(project.status);

  return (
    <Screen>
      <Card style={{ padding: 12, marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <ProjectCover project={project} height={70} style={{ width: 100, marginRight: 10 }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusBadge status={project.status} />
              <Badge label={isOwner ? 'Chủ dự án' : 'Cộng tác viên'} tone="indigo" style={{ marginLeft: 5 }} />
            </View>
            <Text style={{ fontWeight: '800', fontSize: 14, marginTop: 5 }} numberOfLines={2}>{project.title}</Text>
            <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>
              {daysLeft(project.end_date)} · {vnd(project.current_amount)} / {vnd(project.goal_amount)}
            </Text>
          </View>
        </View>
        <Button
          title="Xem công khai"
          variant="ghost"
          icon="eye-outline"
          onPress={() => navigation.navigate('ProjectDetail', { id })}
          style={{ marginTop: 8 }}
        />
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
        {TABS.map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setTab(key)}
            style={{
              backgroundColor: tab === key ? '#1e293b' : colors.white,
              borderRadius: 9,
              paddingHorizontal: 11,
              paddingVertical: 7,
              marginRight: 5,
              marginBottom: 5,
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: '700', color: tab === key ? '#fff' : colors.muted }}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'overview' ? (
        <View>
          <Card style={{ padding: 14 }}>
            <SectionHeader title="Chỉnh sửa thông tin" subtitle={isOwner ? 'Bạn có thể sửa mục tiêu và thời gian' : 'Cộng tác viên chỉ sửa nội dung'} />
            <Input label="Tên chiến dịch" value={form.title} onChangeText={(v) => setField('title', v)} />
            <Input label="Mô tả" value={form.description} onChangeText={(v) => setField('description', v)} multiline />
            <Input
              label="Ảnh bìa (URL)"
              value={form.cover_image_url}
              onChangeText={(v) => setField('cover_image_url', v)}
              autoCapitalize="none"
              placeholder="https://…"
            />
            <Text style={{ fontSize: 11, fontWeight: '800', color: '#334155', marginBottom: 5 }}>Biểu tượng</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
              {['🌱', '🌊', '🎒', '💧', '🏮', '📚', '🚑', '🧵', '🌾', '❤️', '🏫', '🐾'].map((emoji) => (
                <Pressable
                  key={emoji}
                  onPress={() => setField('cover_emoji', emoji)}
                  style={{
                    borderWidth: 1,
                    borderColor: form.cover_emoji === emoji ? colors.primary : colors.border,
                    backgroundColor: form.cover_emoji === emoji ? colors.primaryPale : colors.white,
                    borderRadius: 8,
                    padding: 5,
                    marginRight: 4,
                    marginBottom: 4,
                  }}
                >
                  <Text style={{ fontSize: 18 }}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
            {isOwner ? (
              <>
                <Text style={{ fontSize: 11, fontWeight: '800', color: '#334155', marginBottom: 5 }}>Danh mục</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
                  {categories.map((c) => (
                    <Pressable
                      key={c.id}
                      onPress={() => setField('category_id', c.id)}
                      style={{
                        borderWidth: 1,
                        borderColor: form.category_id === c.id ? colors.primary : colors.border,
                        backgroundColor: form.category_id === c.id ? colors.primary : colors.white,
                        borderRadius: 99,
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        marginRight: 4,
                        marginBottom: 4,
                      }}
                    >
                      <Text style={{ fontSize: 10, fontWeight: '700', color: form.category_id === c.id ? '#fff' : '#334155' }}>
                        {c.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Input
                  label="Mục tiêu (đ)"
                  value={form.goal_amount}
                  onChangeText={(v) => setField('goal_amount', v.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                />
                <View style={{ flexDirection: 'row' }}>
                  <Input
                    label="Bắt đầu"
                    value={form.start_date}
                    onChangeText={(v) => setField('start_date', v)}
                    placeholder="YYYY-MM-DD"
                    style={{ flex: 1, marginRight: 6 }}
                  />
                  <Input
                    label="Kết thúc"
                    value={form.end_date}
                    onChangeText={(v) => setField('end_date', v)}
                    placeholder="YYYY-MM-DD"
                    style={{ flex: 1 }}
                  />
                </View>
              </>
            ) : null}
            {formError ? <Text style={{ fontSize: 11, color: colors.red, marginBottom: 6 }}>{formError}</Text> : null}
            <Button title="Lưu thay đổi" onPress={saveProject} loading={formBusy} />
          </Card>

          <View style={{ height: 10 }} />
          <PredictionExplain prediction={project.prediction} fallbackScore={project.ai_success_score} />
          <View style={{ height: 10 }} />
          <FraudRiskCard flags={project.fraud_flags || []} riskScore={project.fraud_risk_score} threshold={60} />
        </View>
      ) : null}

      {tab === 'updates' ? (
        <View>
          <Card style={{ padding: 14 }}>
            <SectionHeader title="Đăng bản tin mới" subtitle="Người theo dõi sẽ nhận thông báo" />
            <Input label="Tiêu đề" value={updateForm.title} onChangeText={(v) => setUpdateForm((f) => ({ ...f, title: v }))} />
            <Input
              label="Nội dung"
              value={updateForm.content}
              onChangeText={(v) => setUpdateForm((f) => ({ ...f, content: v }))}
              multiline
            />
            <Button title="Đăng bản tin" onPress={postUpdate} loading={updateBusy} />
          </Card>
          <SectionHeader title="Bản tin đã đăng" subtitle={`${project.updates?.length || 0} bản tin`} />
          {(project.updates || []).length === 0 ? (
            <EmptyState icon="📣" title="Chưa có bản tin" />
          ) : (
            project.updates.map((u) => (
              <Card key={u.id} style={{ padding: 12, marginBottom: 8 }}>
                <Text style={{ fontWeight: '800' }}>{u.title}</Text>
                <Text style={{ fontSize: 10, color: colors.soft, marginTop: 2 }}>{formatDateTime(u.created_at)}</Text>
                <Text style={{ fontSize: 12, color: '#334155', marginTop: 5, lineHeight: 18 }}>{u.content}</Text>
              </Card>
            ))
          )}
        </View>
      ) : null}

      {tab === 'rewards' ? (
        <View>
          <Card style={{ padding: 14 }}>
            <SectionHeader title="Thêm gói tri ân" />
            <Input label="Tên gói" value={rewardForm.title} onChangeText={(v) => setRewardForm((f) => ({ ...f, title: v }))} />
            <Input
              label="Mô tả"
              value={rewardForm.description}
              onChangeText={(v) => setRewardForm((f) => ({ ...f, description: v }))}
            />
            <View style={{ flexDirection: 'row' }}>
              <Input
                label="Tối thiểu (đ)"
                value={rewardForm.min_amount}
                onChangeText={(v) => setRewardForm((f) => ({ ...f, min_amount: v.replace(/[^0-9]/g, '') }))}
                keyboardType="number-pad"
                style={{ flex: 1, marginRight: 6 }}
              />
              <Input
                label="Số suất"
                value={rewardForm.quantity_available}
                onChangeText={(v) => setRewardForm((f) => ({ ...f, quantity_available: v.replace(/[^0-9]/g, '') }))}
                keyboardType="number-pad"
                style={{ flex: 1 }}
              />
            </View>
            <Button title="Thêm gói" onPress={addReward} loading={rewardBusy} />
          </Card>
          <SectionHeader title="Gói hiện có" subtitle={`${project.rewards?.length || 0} gói`} />
          {(project.rewards || []).map((r) => (
            <Card key={r.id} style={{ padding: 12, marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800' }}>{r.title}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                    Từ {vnd(r.min_amount)} · còn {r.remaining}/{r.quantity_available} suất
                  </Text>
                  {r.description ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{r.description}</Text> : null}
                </View>
                <Pressable onPress={() => deleteReward(r)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={colors.red} />
                </Pressable>
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      {tab === 'collab' ? (
        <View>
          {isOwner ? (
            <Card style={{ padding: 14 }}>
              <SectionHeader title="Mời cộng tác viên" subtitle="Nhập email người dùng đã đăng ký" />
              <Input
                label="Email"
                value={inviteForm.email}
                onChangeText={(v) => setInviteForm((f) => ({ ...f, email: v }))}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#334155', marginBottom: 5 }}>Vai trò</Text>
              <View style={{ flexDirection: 'row', marginBottom: 10 }}>
                {[
                  ['editor', 'Biên tập'],
                  ['viewer', 'Theo dõi'],
                ].map(([key, label]) => (
                  <Pressable
                    key={key}
                    onPress={() => setInviteForm((f) => ({ ...f, role: key }))}
                    style={{
                      borderWidth: 1,
                      borderColor: inviteForm.role === key ? colors.primary : colors.border,
                      backgroundColor: inviteForm.role === key ? colors.primaryPale : colors.white,
                      borderRadius: 9,
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      marginRight: 6,
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '700', color: inviteForm.role === key ? colors.primaryDark : '#475569' }}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Button title="Gửi lời mời" onPress={invite} loading={inviteBusy} />
            </Card>
          ) : null}
          <SectionHeader title="Đội ngũ" subtitle={`${project.collaborators?.length || 0} người`} />
          {(project.collaborators || []).map((c) => (
            <Card key={`${c.user_id}-${c.role}`} style={{ padding: 12, marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', fontSize: 13 }}>{c.full_name}</Text>
                  <Text style={{ fontSize: 10, color: colors.muted }}>{c.email} · {c.role}</Text>
                  <Text style={{ fontSize: 10, color: c.accepted_at ? colors.primary : colors.amber, marginTop: 2 }}>
                    {c.accepted_at ? 'Đã chấp nhận' : 'Đang chờ chấp nhận'}
                  </Text>
                </View>
                {isOwner ? (
                  <Pressable onPress={() => removeCollaborator(c.user_id)} hitSlop={8}>
                    <Ionicons name="person-remove-outline" size={18} color={colors.red} />
                  </Pressable>
                ) : null}
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      {tab === 'finance' ? (
        <View>
          <Card style={{ padding: 14 }}>
            <SectionHeader title="Giải ngân" subtitle={`Có thể rút: ${vnd(project.available_for_payout || 0)}`} />
            <Input
              label="Số tiền yêu cầu (đ)"
              value={payoutAmount}
              onChangeText={(v) => setPayoutAmount(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
            />
            <Button title="Gửi yêu cầu giải ngân" onPress={requestPayout} loading={payoutBusy} />
          </Card>

          <SectionHeader title="Lịch sử giải ngân" subtitle={`${project.payouts?.length || 0} giao dịch`} />
          {(project.payouts || []).length === 0 ? (
            <Card style={{ padding: 14 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Chưa có yêu cầu giải ngân.</Text>
            </Card>
          ) : (
            project.payouts.map((p) => (
              <Card key={p.id} style={{ padding: 10, marginBottom: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '700' }}>{vnd(p.amount)} · {p.method}</Text>
                    <Text style={{ fontSize: 10, color: colors.muted }}>{formatDate(p.created_at)} · {p.gateway_ref}</Text>
                  </View>
                  <Badge
                    label={transactionStatusVi[p.status] || p.status}
                    tone={p.status === 'success' ? 'emerald' : p.status === 'failed' ? 'red' : 'amber'}
                  />
                </View>
              </Card>
            ))
          )}

          <SectionHeader title="Nhà tài trợ" subtitle={`${pledges.length} khoản`} />
          {pledges.length === 0 ? (
            <Card style={{ padding: 14 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Chưa có nhà tài trợ.</Text>
            </Card>
          ) : (
            pledges.slice(0, 30).map((p) => (
              <Card key={p.id} style={{ padding: 10, marginBottom: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '700' }}>{p.backer_name}</Text>
                    <Text style={{ fontSize: 10, color: colors.muted }}>
                      {vnd(p.amount)} · {formatDateTime(p.created_at)}
                      {p.reward_title ? ` · ${p.reward_title}` : ''}
                    </Text>
                  </View>
                  <Badge
                    label={pledgeStatusVi[p.status] || p.status}
                    tone={p.status === 'paid' ? 'emerald' : p.status === 'failed' ? 'red' : 'amber'}
                  />
                </View>
              </Card>
            ))
          )}

          {canClose ? (
            <Card style={{ padding: 14, marginTop: 10 }}>
              <SectionHeader title="Kết thúc chiến dịch" subtitle="Chọn kết quả trước khi xác nhận" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
                {[
                  ['successful', 'Thành công'],
                  ['failed', 'Thất bại'],
                  ['canceled', 'Dừng'],
                ].map(([key, label]) => (
                  <Pressable
                    key={key}
                    onPress={() => setCloseOutcome(key)}
                    style={{
                      borderWidth: 1,
                      borderColor: closeOutcome === key ? colors.red : colors.border,
                      backgroundColor: closeOutcome === key ? colors.redSoft : colors.white,
                      borderRadius: 9,
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      marginRight: 6,
                      marginBottom: 4,
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '700', color: closeOutcome === key ? colors.red : '#475569' }}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              <Button title="Kết thúc chiến dịch" variant="danger" loading={closeBusy} onPress={closeProject} />
            </Card>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
