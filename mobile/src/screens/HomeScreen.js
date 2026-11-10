import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import { daysLeft, percent, vnd } from '../lib/format';
import { colors, radius } from '../theme';
import {
  AIBox,
  Badge,
  Button,
  Card,
  ErrorState,
  Loading,
  ProjectCard,
  ProgressBar,
  RecommendationBreakdown,
  Screen,
  SectionHeader,
} from '../components/ui';

export default function HomeScreen({ navigation }) {
  const { currentUser, categories, toast } = useApp();
  const [projects, setProjects] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [followBusy, setFollowBusy] = useState('');

  const load = useCallback(async () => {
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
      setRefreshing(false);
    }
  }, [currentUser]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const refresh = () => {
    setRefreshing(true);
    load();
  };

  const toggleFollow = async (project) => {
    if (!currentUser) {
      navigation.navigate('Auth');
      return;
    }
    setFollowBusy(project.id);
    try {
      if (project.is_following) await api.del(`/projects/${project.id}/follow`);
      else await api.post(`/projects/${project.id}/follow`);
      const next = !project.is_following;
      setProjects((list) =>
        list.map((p) => (p.id === project.id ? { ...p, is_following: next } : p)),
      );
      toast(next ? 'Đã theo dõi dự án.' : 'Đã bỏ theo dõi dự án.', next ? 'success' : 'info');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setFollowBusy('');
    }
  };

  return (
    <Screen topInset refreshing={refreshing} onRefresh={refresh}>
      <LinearGradient
        colors={['#047857', '#0f766e', '#115e59']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: radius.xl, padding: 18, marginBottom: 16 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#a7f3d0', fontSize: 12, fontWeight: '700' }}>
              NỀN TẢNG GÂY QUỸ CỘNG ĐỒNG
            </Text>
            <Text style={{ color: '#fff', fontSize: 26, fontWeight: '900', marginTop: 4 }}>
              🤝 GâyQuỹ+
            </Text>
            <Text style={{ color: '#d1fae5', fontSize: 13, marginTop: 6, lineHeight: 19 }}>
              {currentUser
                ? `Xin chào ${currentUser.full_name.split(' ').slice(-1)[0]}! Cùng lan toả điều tốt đẹp.`
                : 'Khám phá các chiến dịch minh bạch, có AI đồng hành.'}
            </Text>
          </View>
          {currentUser ? (
            <Pressable
              onPress={() => navigation.navigate('NotificationsTab')}
              style={{ backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 99, padding: 10 }}
            >
              <Ionicons name="notifications-outline" size={22} color="#fff" />
            </Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', marginTop: 14 }}>
          <Button
            title="Khám phá ngay"
            icon="compass-outline"
            variant="soft"
            onPress={() => navigation.navigate('ExploreTab')}
            style={{ flex: 1, backgroundColor: '#fff', borderColor: '#fff' }}
          />
          {currentUser && currentUser.role !== 'admin' ? (
            <Button
              title="Tạo dự án"
              icon="add-circle-outline"
              onPress={() => navigation.navigate('CreateTab')}
              style={{ flex: 1, marginLeft: 8, backgroundColor: '#f59e0b', borderColor: '#f59e0b' }}
            />
          ) : null}
        </View>
      </LinearGradient>

      {loading ? <Loading text="Đang tải trang chủ…" /> : null}
      {!loading && error ? <ErrorState message={error} onRetry={load} /> : null}

      {!loading && !error ? (
        <>
          {currentUser && recommendations.length > 0 ? (
            <View style={{ marginBottom: 16 }}>
              <SectionHeader
                title="✨ AI gợi ý cho bạn"
                subtitle="Dựa trên chủ đề quan tâm và lịch sử tài trợ"
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {recommendations.slice(0, 5).map((item) => (
                  <Card
                    key={item.id || item.project_id}
                    style={{ width: 250, marginRight: 12, padding: 14 }}
                    onPress={() =>
                      navigation.navigate('ProjectDetail', { id: item.project_id || item.id })
                    }
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                      <Text style={{ fontSize: 26, marginRight: 8 }}>{item.cover_emoji || '🌱'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: '800', fontSize: 13 }} numberOfLines={2}>
                          {item.title}
                        </Text>
                        <Text style={{ fontSize: 10, color: colors.muted }}>
                          {item.category_name || 'Dự án cộng đồng'}
                        </Text>
                      </View>
                    </View>
                    <RecommendationBreakdown item={item} />
                    <View style={{ marginTop: 8 }}>
                      <ProgressBar project={item} compact />
                    </View>
                  </Card>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <SectionHeader title="Chủ đề quan tâm" subtitle="Chạm để lọc dự án theo danh mục" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            {categories.map((c) => (
              <Pressable
                key={c.id}
                onPress={() =>
                  navigation.navigate('ExploreTab', { categoryId: c.id, categoryName: c.name })
                }
                style={{
                  backgroundColor: colors.white,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 99,
                  paddingHorizontal: 13,
                  paddingVertical: 8,
                  marginRight: 8,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#334155' }}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <SectionHeader
            title="Chiến dịch sắp kết thúc"
            subtitle="Còn ít thời gian — chung tay ngay"
            action={
              <Pressable onPress={() => navigation.navigate('ExploreTab')}>
                <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>Xem tất cả</Text>
              </Pressable>
            }
          />

          {projects.length === 0 ? (
            <AIBox variant="info">
              <Text style={{ color: '#334155' }}>Chưa có chiến dịch đang gây quỹ.</Text>
            </AIBox>
          ) : (
            projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onPress={() => navigation.navigate('ProjectDetail', { id: p.id })}
                onFollow={() => toggleFollow(p)}
                followBusy={followBusy === p.id}
              />
            ))
          )}

          <Card style={{ padding: 14, marginTop: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View
                style={{
                  backgroundColor: colors.primaryPale,
                  borderRadius: 12,
                  padding: 9,
                  marginRight: 10,
                }}
              >
                <Ionicons name="sparkles" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '800', fontSize: 13 }}>AI đồng hành cùng chiến dịch</Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2, lineHeight: 16 }}>
                  Dự đoán khả năng thành công, gợi ý dự án phù hợp và kiểm chứng gian lận có bằng chứng.
                </Text>
              </View>
            </View>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
