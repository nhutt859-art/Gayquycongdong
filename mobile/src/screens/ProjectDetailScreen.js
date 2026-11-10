import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import { daysLeft, formatDate, timeAgo, vnd } from '../lib/format';
import { colors, radius } from '../theme';
import {
  AIBox,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  FraudRiskCard,
  Input,
  Loading,
  ModalSheet,
  PredictionExplain,
  ProjectCover,
  ProgressBar,
  Screen,
  SectionHeader,
  StatusBadge,
} from '../components/ui';

const TABS = [
  ['story', 'Câu chuyện'],
  ['comments', 'Bình luận'],
  ['rewards', 'Gói tri ân'],
];

function CommentItem({ comment, replies, currentUser, onReply }) {
  return (
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 10, marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: colors.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 6,
          }}
        >
          <Text style={{ color: colors.primaryDark, fontWeight: '800', fontSize: 11 }}>
            {comment.user_name?.charAt(0)?.toUpperCase() || '?'}
          </Text>
        </View>
        <Text style={{ fontWeight: '800', fontSize: 13 }}>{comment.user_name}</Text>
        <Text style={{ fontSize: 10, color: colors.soft, marginLeft: 6 }}>{timeAgo(comment.created_at)}</Text>
      </View>
      <Text style={{ fontSize: 13, color: '#334155', marginTop: 5, lineHeight: 19 }}>{comment.content}</Text>
      {currentUser ? (
        <Pressable onPress={() => onReply(comment)} style={{ marginTop: 5 }}>
          <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>Trả lời</Text>
        </Pressable>
      ) : null}
      {replies.length > 0 ? (
        <View style={{ borderLeftWidth: 2, borderLeftColor: colors.primarySoft, paddingLeft: 8, marginTop: 8 }}>
          {replies.map((reply) => (
            <View key={reply.id} style={{ backgroundColor: colors.slateSoft, borderRadius: 8, padding: 8, marginBottom: 5 }}>
              <Text style={{ fontSize: 12, fontWeight: '800' }}>{reply.user_name}</Text>
              <Text style={{ fontSize: 10, color: colors.soft }}>{timeAgo(reply.created_at)}</Text>
              <Text style={{ fontSize: 12, color: '#334155', marginTop: 2 }}>{reply.content}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function ProjectDetailScreen({ navigation, route }) {
  const { id } = route.params;
  const { currentUser, toast } = useApp();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('story');
  const [comment, setComment] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [commentBusy, setCommentBusy] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportBusy, setReportBusy] = useState(false);

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

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

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

  const requireLogin = () => {
    if (currentUser) return true;
    navigation.navigate('Auth');
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
        follower_count: Math.max(0, Number(p.follower_count || 0) + (p.is_following ? -1 : 1)),
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

  const goDonate = (rewardId = null) => {
    if (!requireLogin()) return;
    navigation.navigate('Checkout', { id, rewardId });
  };

  if (loading) return <Screen><Loading text="Đang tải dự án…" /></Screen>;
  if (error) {
    return (
      <Screen>
        <ErrorState message={error} onRetry={load} />
      </Screen>
    );
  }
  if (!project) return null;

  const isOwner = project.my_role === 'owner';
  const ended = daysLeft(project.end_date) === 'Đã kết thúc';
  let donateMessage = '';
  if (!currentUser) donateMessage = 'Đăng nhập để tài trợ dự án.';
  else if (project.owner_id === currentUser.id) donateMessage = 'Bạn không thể tài trợ chính dự án của mình.';
  else if (currentUser.role === 'admin') donateMessage = 'Quản trị viên không thực hiện tài trợ.';
  else if (project.status !== 'active') donateMessage = 'Dự án không ở trạng thái đang gây quỹ.';
  else if (ended) donateMessage = 'Chiến dịch đã hết hạn.';

  return (
    <Screen>
      <Card style={{ overflow: 'hidden', marginBottom: 12 }}>
        <ProjectCover project={project} height={190} style={{ borderRadius: 0 }} />
        <View style={{ padding: 14 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusBadge status={project.status} />
            <Badge label={project.category_name || 'Dự án'} style={{ marginLeft: 6 }} />
            <Text style={{ fontSize: 10, color: colors.muted, marginLeft: 8 }}>
              {daysLeft(project.end_date)} · {formatDate(project.end_date)}
            </Text>
          </View>
          <Text style={{ fontSize: 20, fontWeight: '900', color: colors.text, marginTop: 8, lineHeight: 27 }}>
            {project.title}
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
            Tổ chức bởi <Text style={{ fontWeight: '700', color: '#334155' }}>{project.owner_name}</Text> · Tin cậy{' '}
            {Math.round(Number(project.owner_trust_score || 0))}/100
          </Text>
          <View style={{ marginTop: 10 }}>
            <ProgressBar project={project} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
            {[
              ['Đã huy động', vnd(project.current_amount)],
              ['Mục tiêu', vnd(project.goal_amount)],
              ['Nhà tài trợ', String(project.backer_count || 0)],
              ['Theo dõi', String(project.follower_count || 0)],
            ].map(([label, value]) => (
              <View key={label} style={{ width: '50%', padding: 3 }}>
                <View style={{ backgroundColor: colors.slateSoft, borderRadius: 10, padding: 8 }}>
                  <Text style={{ fontSize: 10, color: colors.muted }}>{label}</Text>
                  <Text style={{ fontSize: 13, fontWeight: '800', marginTop: 2 }}>{value}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
            {project.can_manage ? (
              <Button
                title="Quản lý dự án"
                icon="settings-outline"
                onPress={() => navigation.navigate('ManageProject', { id })}
                style={{ flex: 1, marginRight: 6 }}
              />
            ) : null}
            <Button
              title={project.is_following ? '★ Đang theo dõi' : '☆ Theo dõi'}
              variant="ghost"
              loading={followBusy}
              onPress={toggleFollow}
              style={{ flex: 1, marginRight: 6 }}
            />
            {currentUser && !isOwner && currentUser.role !== 'admin' ? (
              <Button
                title="Báo cáo"
                variant="ghost"
                icon="flag-outline"
                onPress={() => setReportOpen(true)}
                style={{ marginTop: 6 }}
              />
            ) : null}
          </View>

          {project.can_pledge ? (
            <Button
              title="Tài trợ dự án"
              icon="heart"
              onPress={() => goDonate()}
              style={{ marginTop: 10 }}
            />
          ) : donateMessage ? (
            <View style={{ backgroundColor: colors.amberSoft, borderRadius: 10, padding: 10, marginTop: 10 }}>
              <Text style={{ fontSize: 12, color: colors.amber }}>{donateMessage}</Text>
            </View>
          ) : null}
        </View>
      </Card>

      <PredictionExplain prediction={project.prediction} fallbackScore={project.ai_success_score} />

      <View style={{ height: 10 }} />
      <FraudRiskCard
        flags={project.fraud_flags || []}
        riskScore={project.fraud_risk_score}
        threshold={60}
        title="Kiểm chứng gian lận"
      />

      <View style={{ flexDirection: 'row', marginTop: 14, marginBottom: 10 }}>
        {TABS.map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setTab(key)}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderBottomWidth: 2,
              borderBottomColor: tab === key ? colors.primary : colors.border,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '800', color: tab === key ? colors.primary : colors.muted }}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'story' ? (
        <View>
          <Card style={{ padding: 14 }}>
            <Text style={{ fontWeight: '800', marginBottom: 6 }}>Về chiến dịch</Text>
            <Text style={{ fontSize: 13, color: '#334155', lineHeight: 20 }}>{project.description}</Text>
          </Card>
          <SectionHeader title="Cập nhật từ chủ dự án" subtitle={`${project.updates?.length || 0} bản tin`} />
          {(project.updates || []).length === 0 ? (
            <EmptyState icon="📣" title="Chưa có bản tin">Chủ dự án sẽ cập nhật tiến độ tại đây.</EmptyState>
          ) : (
            (project.updates || []).map((u) => (
              <Card key={u.id} style={{ padding: 12, marginBottom: 8 }}>
                <Text style={{ fontWeight: '800' }}>{u.title}</Text>
                <Text style={{ fontSize: 10, color: colors.soft, marginTop: 2 }}>
                  {u.author_name || 'Chủ dự án'} · {timeAgo(u.created_at)}
                </Text>
                <Text style={{ fontSize: 13, color: '#334155', marginTop: 6, lineHeight: 19 }}>{u.content}</Text>
              </Card>
            ))
          )}
          {project.collaborators?.length > 0 ? (
            <Card style={{ padding: 12, marginTop: 8 }}>
              <Text style={{ fontWeight: '800', marginBottom: 6 }}>Đội ngũ cộng tác</Text>
              {project.collaborators.map((c) => (
                <Text key={`${c.user_id}-${c.role}`} style={{ fontSize: 12, color: colors.muted, marginBottom: 3 }}>
                  • {c.full_name} — {c.role === 'editor' ? 'Biên tập' : c.role === 'viewer' ? 'Theo dõi' : c.role}
                </Text>
              ))}
            </Card>
          ) : null}
        </View>
      ) : null}

      {tab === 'comments' ? (
        <View>
          {commentTree.length === 0 ? (
            <EmptyState icon="💬" title="Chưa có bình luận">Hãy là người đầu tiên động viên dự án.</EmptyState>
          ) : (
            commentTree.map(({ root, replies }) => (
              <CommentItem
                key={root.id}
                comment={root}
                replies={replies}
                currentUser={currentUser}
                onReply={setReplyTo}
              />
            ))
          )}
          <Card style={{ padding: 12, marginTop: 8 }}>
            {replyTo ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ fontSize: 11, color: colors.primary, flex: 1 }}>
                  Đang trả lời {replyTo.user_name}
                </Text>
                <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.soft} />
                </Pressable>
              </View>
            ) : null}
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Chia sẻ suy nghĩ của bạn…"
              placeholderTextColor={colors.soft}
              multiline
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                padding: 10,
                minHeight: 70,
                textAlignVertical: 'top',
                color: colors.text,
              }}
            />
            <Button
              title={currentUser ? 'Gửi bình luận' : 'Đăng nhập để bình luận'}
              onPress={currentUser ? sendComment : () => navigation.navigate('Auth')}
              loading={commentBusy}
              style={{ marginTop: 8 }}
            />
          </Card>
        </View>
      ) : null}

      {tab === 'rewards' ? (
        <View>
          {(project.rewards || []).length === 0 ? (
            <EmptyState icon="🎁" title="Chưa có gói tri ân">
              Bạn có thể tài trợ tự do cho chiến dịch.
            </EmptyState>
          ) : (
            (project.rewards || []).map((r) => {
              const soldOut = r.remaining <= 0;
              return (
                <Card key={r.id} style={{ padding: 12, marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontWeight: '800', flex: 1, marginRight: 8 }}>{r.title}</Text>
                    <Badge label={soldOut ? 'Hết suất' : `Còn ${r.remaining} suất`} tone={soldOut ? 'slate' : 'emerald'} />
                  </View>
                  {r.description ? (
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>{r.description}</Text>
                  ) : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                    <Text style={{ fontSize: 12 }}>
                      Tối thiểu <Text style={{ fontWeight: '800' }}>{vnd(r.min_amount)}</Text>
                    </Text>
                    {project.can_pledge && !soldOut ? (
                      <Button title="Chọn gói" onPress={() => goDonate(r.id)} style={{ paddingHorizontal: 12, minHeight: 34 }} />
                    ) : null}
                  </View>
                </Card>
              );
            })
          )}
        </View>
      ) : null}

      <ModalSheet open={reportOpen} title="Báo cáo vi phạm" onClose={() => setReportOpen(false)}>
        <Input
          label="Lý do báo cáo"
          value={reportReason}
          onChangeText={setReportReason}
          placeholder="Mô tả vấn đề tối thiểu 10 ký tự…"
          multiline
        />
        <Button title="Gửi báo cáo" onPress={sendReport} loading={reportBusy} />
      </ModalSheet>
    </Screen>
  );
}
