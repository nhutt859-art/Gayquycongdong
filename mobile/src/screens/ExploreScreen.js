import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import { colors, radius } from '../theme';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Loading,
  ProjectCard,
  Screen,
  SectionHeader,
} from '../components/ui';

const PAGE_SIZE = 6;
const STATUS_OPTIONS = [
  ['', 'Mọi trạng thái'],
  ['active', 'Đang gây quỹ'],
  ['successful', 'Thành công'],
  ['failed', 'Thất bại'],
  ['canceled', 'Đã dừng'],
];
const SORT_OPTIONS = [
  ['newest', 'Mới nhất'],
  ['ending', 'Sắp kết thúc'],
  ['progress', 'Gần đạt mục tiêu'],
  ['ai', 'AI đánh giá cao'],
  ['popular', 'Nhiều nhà tài trợ'],
];

export default function ExploreScreen({ navigation, route }) {
  const { categories, currentUser, toast } = useApp();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [followBusy, setFollowBusy] = useState('');
  const firstRender = useRef(true);

  useEffect(() => {
    if (route.params?.categoryId) {
      setCat(route.params.categoryId);
      setPage(1);
    }
    if (route.params?.q !== undefined) {
      setQ(route.params.q || '');
      setPage(1);
    }
  }, [route.params?.categoryId, route.params?.q]);

  const load = useCallback(async () => {
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        sort,
      });
      if (q.trim()) params.set('q', q.trim());
      if (cat) params.set('category', cat);
      if (status) params.set('status', status);
      const res = await api.get(`/projects?${params.toString()}`, { auth: false });
      setData({ items: res?.items || [], total: res?.total || 0, pages: res?.pages || 1 });
    } catch (err) {
      setError(err.message);
      setData({ items: [], total: 0, pages: 1 });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [q, cat, status, sort, page]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      load();
      return undefined;
    }
    const timer = setTimeout(load, q ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

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
      setData((d) => ({
        ...d,
        items: d.items.map((p) => (p.id === project.id ? { ...p, is_following: next } : p)),
      }));
      toast(next ? 'Đã theo dõi dự án.' : 'Đã bỏ theo dõi dự án.', next ? 'success' : 'info');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setFollowBusy('');
    }
  };

  const clearFilters = () => {
    setQ('');
    setCat('');
    setStatus('');
    setSort('newest');
    setPage(1);
  };

  const hasFilter = q || cat || status || sort !== 'newest';
  const activeCategory = categories.find((c) => c.id === cat);

  return (
    <Screen topInset refreshing={refreshing} onRefresh={refresh}>
      <SectionHeader
        title="Khám phá dự án"
        subtitle={`${data.total || 0} chiến dịch cộng đồng`}
        action={
          currentUser && currentUser.role !== 'admin' ? (
            <Button title="+ Tạo" onPress={() => navigation.navigate('CreateTab')} />
          ) : null
        }
      />

      <Card style={{ padding: 12, marginBottom: 12 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.slateSoft,
            borderRadius: radius.md,
            paddingHorizontal: 10,
          }}
        >
          <Ionicons name="search" size={18} color={colors.soft} />
          <TextInput
            value={q}
            onChangeText={(value) => {
              setQ(value);
              setPage(1);
            }}
            placeholder="Tìm theo tên hoặc mô tả…"
            placeholderTextColor={colors.soft}
            style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 8, color: colors.text }}
          />
          {q ? (
            <Pressable onPress={() => setQ('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.soft} />
            </Pressable>
          ) : null}
        </View>

        <Text style={{ fontSize: 11, fontWeight: '800', color: colors.muted, marginTop: 10 }}>
          DANH MỤC
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 5 }}>
          <Chip label="Tất cả" active={!cat} onPress={() => { setCat(''); setPage(1); }} />
          {categories.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              active={cat === c.id}
              onPress={() => {
                setCat(cat === c.id ? '' : c.id);
                setPage(1);
              }}
            />
          ))}
        </ScrollView>

        <Text style={{ fontSize: 11, fontWeight: '800', color: colors.muted, marginTop: 4 }}>
          TRẠNG THÁI
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 5 }}>
          {STATUS_OPTIONS.map(([value, label]) => (
            <Chip
              key={value || 'all'}
              label={label}
              active={status === value}
              onPress={() => {
                setStatus(value);
                setPage(1);
              }}
            />
          ))}
        </ScrollView>

        <Text style={{ fontSize: 11, fontWeight: '800', color: colors.muted, marginTop: 4 }}>
          SẮP XẾP
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 5 }}>
          {SORT_OPTIONS.map(([value, label]) => (
            <Chip
              key={value}
              label={label}
              active={sort === value}
              onPress={() => {
                setSort(value);
                setPage(1);
              }}
            />
          ))}
        </ScrollView>

        {hasFilter ? (
          <Pressable onPress={clearFilters} style={{ marginTop: 6 }}>
            <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>
              ✕ Xóa bộ lọc
            </Text>
          </Pressable>
        ) : null}
      </Card>

      {activeCategory ? (
        <Badge
          label={`Đang lọc: ${activeCategory.name}`}
          tone="emerald"
          style={{ marginBottom: 10, alignSelf: 'flex-start' }}
        />
      ) : null}

      {loading ? <Loading text="Đang tìm dự án…" /> : null}
      {!loading && error ? <ErrorState message={error} onRetry={load} /> : null}

      {!loading && !error && data.items.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="Không tìm thấy dự án phù hợp"
          action={<Button title="Xóa bộ lọc" variant="ghost" onPress={clearFilters} />}
        >
          Thử từ khóa khác hoặc chọn danh mục khác.
        </EmptyState>
      ) : null}

      {!loading && !error
        ? data.items.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onPress={() => navigation.navigate('ProjectDetail', { id: p.id })}
              onFollow={() => toggleFollow(p)}
              followBusy={followBusy === p.id}
            />
          ))
        : null}

      {!loading && !error && data.pages > 1 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
          <Button
            title="← Trước"
            variant="ghost"
            disabled={page <= 1}
            onPress={() => setPage((p) => Math.max(1, p - 1))}
            style={{ marginRight: 10 }}
          />
          <Text style={{ fontSize: 12, color: colors.muted, fontWeight: '700' }}>
            Trang {page}/{data.pages}
          </Text>
          <Button
            title="Sau →"
            variant="ghost"
            disabled={page >= data.pages}
            onPress={() => setPage((p) => Math.min(data.pages, p + 1))}
            style={{ marginLeft: 10 }}
          />
        </View>
      ) : null}
    </Screen>
  );
}
