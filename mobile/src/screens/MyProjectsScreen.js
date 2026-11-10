import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import { daysLeft, vnd } from '../lib/format';
import { colors } from '../theme';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Screen,
  SectionHeader,
  StatusBadge,
} from '../components/ui';

function ProjectRow({ project, onOpen, onManage, role }) {
  return (
    <Card style={{ padding: 12, marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <Text style={{ fontSize: 26, marginRight: 8 }}>{project.cover_emoji || '🌱'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '800', fontSize: 13 }} numberOfLines={2}>{project.title}</Text>
          <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>
            {project.category_name || 'Dự án'} · {daysLeft(project.end_date)}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 5 }}>
            <StatusBadge status={project.status} />
            {role ? <Badge label={role} tone="indigo" style={{ marginLeft: 5 }} /> : null}
            <Badge label={vnd(project.current_amount)} tone="emerald" style={{ marginLeft: 5 }} />
          </View>
        </View>
      </View>
      <View style={{ flexDirection: 'row', marginTop: 8 }}>
        <Button title="Xem dự án" variant="ghost" onPress={onOpen} style={{ flex: 1, marginRight: 6 }} />
        <Button title="Quản lý" onPress={onManage} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

export default function MyProjectsScreen({ navigation }) {
  const { currentUser, refreshSession, toast } = useApp();
  const [data, setData] = useState({ owned: [], collaborating: [], invitations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    if (!currentUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/me/projects');
      setData({
        owned: res?.owned || [],
        collaborating: res?.collaborating || [],
        invitations: res?.invitations || [],
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleInvitation = async (projectId, action) => {
    setBusy(projectId);
    try {
      await api.post(`/me/invitations/${projectId}/${action}`);
      toast(action === 'accept' ? 'Đã chấp nhận lời mời cộng tác.' : 'Đã từ chối lời mời.', action === 'accept' ? 'success' : 'info');
      await Promise.allSettled([load(), refreshSession()]);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  if (!currentUser) {
    return (
      <Screen>
        <Card style={{ padding: 22, alignItems: 'center' }}>
          <Text style={{ fontSize: 42 }}>📁</Text>
          <Text style={{ fontSize: 19, fontWeight: '900', marginTop: 8 }}>Đăng nhập để quản lý dự án</Text>
          <Button title="Đăng nhập" onPress={() => navigation.navigate('Auth')} style={{ marginTop: 14, width: '100%' }} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionHeader
        title="Dự án của tôi"
        subtitle="Dự án sở hữu, cộng tác và lời mời"
        action={<Button title="+ Tạo dự án" onPress={() => navigation.navigate('CreateProject')} />}
      />

      {loading ? <Loading text="Đang tải dự án…" /> : null}
      {!loading && error ? <ErrorState message={error} onRetry={load} /> : null}

      {!loading && !error ? (
        <>
          {data.invitations.length > 0 ? (
            <>
              <SectionHeader title="Lời mời cộng tác" subtitle={`${data.invitations.length} lời mời đang chờ`} />
              {data.invitations.map((inv) => (
                <Card key={inv.id} style={{ padding: 12, marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                    <Text style={{ fontSize: 24, marginRight: 8 }}>{inv.cover_emoji || '🤝'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '800', fontSize: 13 }}>{inv.title}</Text>
                      <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>
                        {inv.owner_name} · {inv.category_name} · vai trò {inv.collab_role}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', marginTop: 8 }}>
                    <Button
                      title="Từ chối"
                      variant="ghost"
                      loading={busy === inv.id}
                      onPress={() => handleInvitation(inv.id, 'decline')}
                      style={{ flex: 1, marginRight: 6 }}
                    />
                    <Button
                      title="Chấp nhận"
                      loading={busy === inv.id}
                      onPress={() => handleInvitation(inv.id, 'accept')}
                      style={{ flex: 1 }}
                    />
                  </View>
                </Card>
              ))}
            </>
          ) : null}

          <SectionHeader title="Dự án sở hữu" subtitle={`${data.owned.length} dự án`} />
          {data.owned.length === 0 ? (
            <EmptyState icon="🌱" title="Bạn chưa tạo dự án nào">
              Bắt đầu chiến dịch đầu tiên để gây quỹ cho cộng đồng.
            </EmptyState>
          ) : (
            data.owned.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                role="Chủ dự án"
                onOpen={() => navigation.navigate('ProjectDetail', { id: p.id })}
                onManage={() => navigation.navigate('ManageProject', { id: p.id })}
              />
            ))
          )}

          <SectionHeader title="Dự án cộng tác" subtitle={`${data.collaborating.length} dự án`} />
          {data.collaborating.length === 0 ? (
            <Card style={{ padding: 14 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Bạn chưa cộng tác dự án nào.</Text>
            </Card>
          ) : (
            data.collaborating.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                role={p.collab_role === 'editor' ? 'Biên tập' : p.collab_role === 'viewer' ? 'Theo dõi' : p.collab_role}
                onOpen={() => navigation.navigate('ProjectDetail', { id: p.id })}
                onManage={() => navigation.navigate('ManageProject', { id: p.id })}
              />
            ))
          )}
        </>
      ) : null}
    </Screen>
  );
}
