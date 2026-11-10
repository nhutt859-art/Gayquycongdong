import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useApp } from '../context/AppContext';
import { colors, radius } from '../theme';
import { Button, Card, Screen } from '../components/ui';

export default function OnboardingScreen({ navigation, route }) {
  const { categories, interests, saveInterests, toast } = useApp();
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSelected(interests.map((i) => i.category_id));
  }, [interests.length]);

  const toggle = (id) => {
    setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await saveInterests(selected);
      toast(`Đã lưu ${selected.length} chủ đề quan tâm. AI sẽ gợi ý dự án phù hợp.`, 'success');
      if (navigation.canGoBack()) navigation.goBack();
      else navigation.navigate('MainTabs');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card style={{ padding: 18 }}>
        <Text style={{ fontSize: 20, fontWeight: '900' }}>Chọn chủ đề bạn quan tâm</Text>
        <Text style={{ fontSize: 13, color: colors.muted, marginTop: 5, lineHeight: 19 }}>
          AI dùng lựa chọn này (kết hợp lịch sử tài trợ) để gợi ý dự án phù hợp. Có thể đổi lại ở trang Cá nhân.
        </Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 }}>
          {categories.map((c) => {
            const active = selected.includes(c.id);
            return (
              <Pressable
                key={c.id}
                onPress={() => toggle(c.id)}
                style={{
                  backgroundColor: active ? colors.primary : colors.white,
                  borderColor: active ? colors.primary : colors.border,
                  borderWidth: 1,
                  borderRadius: 99,
                  paddingHorizontal: 13,
                  paddingVertical: 8,
                  marginRight: 6,
                  marginBottom: 6,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: active ? colors.white : '#334155' }}>
                  {c.name}
                  <Text style={{ color: active ? '#a7f3d0' : colors.soft }}> {c.active_project_count ?? 0}</Text>
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ backgroundColor: colors.slateSoft, borderRadius: 10, padding: 10, marginTop: 6 }}>
          <Text style={{ fontSize: 11, color: colors.muted }}>
            Đã chọn <Text style={{ fontWeight: '800', color: colors.text }}>{selected.length}</Text> chủ đề. Bạn có thể bỏ qua
            và cập nhật sau.
          </Text>
        </View>

        {error ? (
          <View style={{ backgroundColor: colors.redSoft, borderRadius: 10, padding: 10, marginTop: 10 }}>
            <Text style={{ fontSize: 12, color: '#991b1b' }}>{error}</Text>
          </View>
        ) : null}

        <Button title="Hoàn tất" onPress={save} loading={busy} style={{ marginTop: 14 }} />
        <Pressable
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.navigate('MainTabs', { screen: route.params?.fromTab || 'HomeTab' });
          }}
          style={{ marginTop: 12, alignItems: 'center' }}
        >
          <Text style={{ fontSize: 12, color: colors.muted }}>Bỏ qua</Text>
        </Pressable>
      </Card>
    </Screen>
  );
}
