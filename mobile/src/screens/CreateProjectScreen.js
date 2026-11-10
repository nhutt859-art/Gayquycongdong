import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import { addDaysISO, todayISO, vnd } from '../lib/format';
import { colors } from '../theme';
import {
  AIBox,
  Badge,
  Button,
  Card,
  FraudRiskCard,
  Input,
  PredictionExplain,
  ProjectCover,
  Screen,
  SectionHeader,
} from '../components/ui';

const EMOJIS = ['🌱', '🌊', '🎒', '💧', '🏮', '📚', '🚑', '🧵', '🌾', '❤️', '🏫', '🐾'];
const blankReward = () => ({ title: '', description: '', min_amount: '', quantity_available: '50' });

export default function CreateProjectScreen({ navigation, route }) {
  const { categories, currentUser, refreshSession, toast } = useApp();
  const topInset = route.name === 'CreateTab';
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const [createdPrediction, setCreatedPrediction] = useState(null);
  const [createdFraud, setCreatedFraud] = useState(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category_id: '',
    goal_amount: '200000000',
    start_date: todayISO(),
    end_date: addDaysISO(45),
    cover_emoji: '🌱',
    cover_image_url: '',
  });
  const [rewards, setRewards] = useState([blankReward()]);
  const [estimate, setEstimate] = useState(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState('');
  const estimateRequest = useRef(0);

  const categoryId = form.category_id || categories[0]?.id || '';
  const categoryName = categories.find((c) => c.id === categoryId)?.name || '';
  const filledRewards = useMemo(
    () => rewards.filter((r) => r.title.trim() || r.min_amount),
    [rewards],
  );

  useEffect(() => {
    if (!categoryId || !form.goal_amount || Number(form.goal_amount) < 100000) {
      setEstimate(null);
      setEstimateError('');
      setEstimateLoading(false);
      return undefined;
    }
    const requestId = estimateRequest.current + 1;
    estimateRequest.current = requestId;
    const timer = setTimeout(async () => {
      setEstimateLoading(true);
      setEstimateError('');
      try {
        const data = await api.post('/ai/estimate', {
          category_id: categoryId,
          goal_amount: Number(form.goal_amount),
          description: form.description.trim(),
          rewards_count: filledRewards.length,
          start_date: form.start_date,
          end_date: form.end_date,
        });
        if (estimateRequest.current === requestId) setEstimate(data?.prediction || null);
      } catch (err) {
        if (estimateRequest.current === requestId) {
          setEstimate(null);
          setEstimateError(err.message);
        }
      } finally {
        if (estimateRequest.current === requestId) setEstimateLoading(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [categoryId, form.goal_amount, form.description, form.start_date, form.end_date, filledRewards.length]);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const updateReward = (index, key, value) => {
    setRewards((list) => list.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
  };

  const validateStep1 = () => {
    if (form.title.trim().length < 10) return 'Tên chiến dịch tối thiểu 10 ký tự.';
    if (!categoryId) return 'Vui lòng chọn danh mục.';
    if (form.description.trim().length < 30) return 'Mô tả chiến dịch tối thiểu 30 ký tự.';
    return '';
  };

  const validateStep2 = () => {
    if (Number(form.goal_amount) < 100000) return 'Mục tiêu tối thiểu 100.000đ.';
    if (!form.start_date || !form.end_date) return 'Vui lòng chọn ngày bắt đầu và kết thúc.';
    if (form.end_date <= form.start_date) return 'Ngày kết thúc phải sau ngày bắt đầu.';
    if (form.end_date < todayISO()) return 'Ngày kết thúc phải ở tương lai.';
    for (const [index, reward] of filledRewards.entries()) {
      if (reward.title.trim().length < 3) return `Gói tri ân #${index + 1}: tên gói tối thiểu 3 ký tự.`;
      if (Number(reward.min_amount) <= 0) return `Gói tri ân #${index + 1}: mức tối thiểu phải lớn hơn 0.`;
      if (Number(reward.quantity_available) < 0) return `Gói tri ân #${index + 1}: số suất không hợp lệ.`;
    }
    return '';
  };

  const next = () => {
    const message = step === 1 ? validateStep1() : validateStep2();
    if (message) {
      setError(message);
      return;
    }
    setError('');
    setStep((s) => s + 1);
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api.post('/projects', {
        title: form.title.trim(),
        description: form.description.trim(),
        category_id: categoryId,
        goal_amount: Number(form.goal_amount),
        start_date: form.start_date,
        end_date: form.end_date,
        cover_emoji: form.cover_emoji,
        cover_image_url: form.cover_image_url.trim() || null,
        rewards: filledRewards.map((r) => ({
          title: r.title.trim(),
          description: r.description.trim() || null,
          min_amount: Number(r.min_amount),
          quantity_available: Number(r.quantity_available),
        })),
      });
      setCreated(data.project);
      setCreatedPrediction(data.prediction || null);
      setCreatedFraud(data.fraud || null);
      await refreshSession();
      toast('Đã gửi dự án, đang chờ quản trị viên duyệt.', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!currentUser) {
    return (
      <Screen topInset={topInset}>
        <Card style={{ padding: 22, alignItems: 'center' }}>
          <Text style={{ fontSize: 42 }}>🚀</Text>
          <Text style={{ fontSize: 19, fontWeight: '900', marginTop: 8 }}>Đăng nhập để tạo dự án</Text>
          <Button title="Đăng nhập" onPress={() => navigation.navigate('Auth')} style={{ marginTop: 14, width: '100%' }} />
        </Card>
      </Screen>
    );
  }

  if (currentUser.role === 'admin') {
    return (
      <Screen topInset={topInset}>
        <Card style={{ padding: 22, alignItems: 'center' }}>
          <Text style={{ fontSize: 42 }}>🛡️</Text>
          <Text style={{ fontSize: 18, fontWeight: '900', marginTop: 8 }}>Tài khoản quản trị không tạo dự án</Text>
          <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 5 }}>
            Hãy dùng tài khoản chủ dự án để tạo chiến dịch gây quỹ.
          </Text>
        </Card>
      </Screen>
    );
  }

  if (currentUser.kyc_status !== 'verified') {
    return (
      <Screen topInset={topInset}>
        <Card style={{ padding: 22, alignItems: 'center' }}>
          <Text style={{ fontSize: 42 }}>🪪</Text>
          <Text style={{ fontSize: 18, fontWeight: '900', marginTop: 8 }}>Cần xác thực danh tính</Text>
          <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 5, lineHeight: 18 }}>
            Bạn cần xác thực danh tính (KYC mô phỏng) trước khi tạo dự án gây quỹ.
          </Text>
          <Button
            title="Đến trang cá nhân"
            onPress={() => navigation.navigate('MainTabs', { screen: 'ProfileTab' })}
            style={{ marginTop: 14, width: '100%' }}
          />
        </Card>
      </Screen>
    );
  }

  if (created) {
    return (
      <Screen topInset={topInset}>
        <Card style={{ padding: 20, alignItems: 'center' }}>
          <Text style={{ fontSize: 46 }}>📨</Text>
          <Text style={{ fontSize: 20, fontWeight: '900', marginTop: 8 }}>Đã gửi dự án thành công</Text>
          <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 5, lineHeight: 19 }}>
            “{created.title}” đang ở trạng thái{' '}
            <Text style={{ fontWeight: '800' }}>{created.status === 'pending_review' ? 'Chờ duyệt' : created.status}</Text>. Quản
            trị viên sẽ xem xét trước khi công khai.
          </Text>
          <View style={{ backgroundColor: colors.slateSoft, borderRadius: 10, padding: 10, marginTop: 12, width: '100%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Mục tiêu</Text>
              <Text style={{ fontSize: 12, fontWeight: '800' }}>{vnd(created.goal_amount)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Trạng thái</Text>
              <Text style={{ fontSize: 12, fontWeight: '800' }}>Chờ quản trị viên duyệt</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', marginTop: 14, width: '100%' }}>
            <Button
              title="Quản lý dự án"
              onPress={() => navigation.navigate('ManageProject', { id: created.id })}
              style={{ flex: 1, marginRight: 6 }}
            />
            <Button
              title="Dự án của tôi"
              variant="ghost"
              onPress={() => navigation.navigate('MyProjects')}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
        <PredictionExplain prediction={createdPrediction} fallbackScore={created.ai_success_score} />
        <FraudRiskCard
          flags={
            createdFraud?.score >= 60
              ? [
                  {
                    id: 'created-project',
                    risk_score: createdFraud.score,
                    reason: createdFraud.summary,
                    evidence: createdFraud,
                    model_version: createdFraud.model_version,
                    review_status: 'pending',
                  },
                ]
              : []
          }
          riskScore={createdFraud?.score ?? created.fraud_risk_score}
          threshold={60}
        />
      </Screen>
    );
  }

  const preview = {
    title: form.title || 'Tên chiến dịch của bạn',
    cover_emoji: form.cover_emoji,
    cover_image_url: form.cover_image_url,
    category_name: categoryName || 'Danh mục',
    goal_amount: Number(form.goal_amount) || 0,
    current_amount: 0,
    status: 'pending_review',
    fraud_risk_score: 0,
  };

  return (
    <Screen topInset={topInset}>
      <SectionHeader title="Tạo dự án gây quỹ" subtitle={`Bước ${step}/3 · Dự án sẽ được gửi duyệt trước khi công khai`} />

      <View style={{ flexDirection: 'row', marginBottom: 10 }}>
        {[[1, '1. Thông tin'], [2, '2. Mục tiêu'], [3, '3. Xem lại']].map(([n, label]) => (
          <View
            key={n}
            style={{
              flex: 1,
              backgroundColor: step === n ? '#1e293b' : colors.slateSoft,
              borderRadius: 8,
              paddingVertical: 6,
              marginRight: n < 3 ? 4 : 0,
            }}
          >
            <Text style={{ textAlign: 'center', fontSize: 10, fontWeight: '700', color: step === n ? '#fff' : colors.muted }}>
              {label}
            </Text>
          </View>
        ))}
      </View>

      {error ? (
        <View style={{ backgroundColor: colors.redSoft, borderRadius: 10, padding: 10, marginBottom: 10 }}>
          <Text style={{ fontSize: 12, color: '#991b1b' }}>{error}</Text>
        </View>
      ) : null}

      {step === 1 ? (
        <Card style={{ padding: 14 }}>
          <Input
            label="Tên chiến dịch *"
            value={form.title}
            onChangeText={(v) => setField('title', v)}
            placeholder="VD: Hồi sinh sông quê — 10km không rác"
            maxLength={200}
            hint={`${form.title.length}/200 ký tự (tối thiểu 10)`}
          />

          <Text style={{ fontSize: 12, fontWeight: '800', color: '#334155', marginBottom: 6 }}>Danh mục *</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
            {categories.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setField('category_id', c.id)}
                style={{
                  backgroundColor: categoryId === c.id ? colors.primary : colors.white,
                  borderColor: categoryId === c.id ? colors.primary : colors.border,
                  borderWidth: 1,
                  borderRadius: 99,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  marginRight: 5,
                  marginBottom: 5,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: categoryId === c.id ? '#fff' : '#334155' }}>{c.name}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={{ fontSize: 12, fontWeight: '800', color: '#334155', marginBottom: 6 }}>Biểu tượng dự án</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10 }}>
            {EMOJIS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => setField('cover_emoji', emoji)}
                style={{
                  backgroundColor: form.cover_emoji === emoji ? colors.primaryPale : colors.white,
                  borderColor: form.cover_emoji === emoji ? colors.primary : colors.border,
                  borderWidth: 1,
                  borderRadius: 9,
                  padding: 6,
                  marginRight: 5,
                  marginBottom: 5,
                }}
              >
                <Text style={{ fontSize: 19 }}>{emoji}</Text>
              </Pressable>
            ))}
          </View>

          <Input
            label="Mô tả chiến dịch *"
            value={form.description}
            onChangeText={(v) => setField('description', v)}
            placeholder="Câu chuyện, mục tiêu và kế hoạch sử dụng quỹ…"
            multiline
            hint={`${form.description.length} ký tự (tối thiểu 30)`}
          />
          <Input
            label="Ảnh bìa (URL, tùy chọn)"
            value={form.cover_image_url}
            onChangeText={(v) => setField('cover_image_url', v)}
            placeholder="https://…"
            autoCapitalize="none"
          />

          <View style={{ marginBottom: 10 }}>
            <ProjectCover project={preview} height={110} />
          </View>

          <Button title="Tiếp tục" onPress={next} />
        </Card>
      ) : null}

      {step === 2 ? (
        <Card style={{ padding: 14 }}>
          <Input
            label="Mục tiêu gây quỹ (đ) *"
            value={form.goal_amount}
            onChangeText={(v) => setField('goal_amount', v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            hint="Tối thiểu 100.000đ"
          />
          <Input
            label="Ngày bắt đầu (YYYY-MM-DD)"
            value={form.start_date}
            onChangeText={(v) => setField('start_date', v)}
            placeholder={todayISO()}
            autoCapitalize="none"
          />
          <Input
            label="Ngày kết thúc (YYYY-MM-DD)"
            value={form.end_date}
            onChangeText={(v) => setField('end_date', v)}
            placeholder={addDaysISO(45)}
            autoCapitalize="none"
          />

          {estimateLoading ? (
            <AIBox variant="info" title="AI ĐANG ƯỚC TÍNH">
              <Text style={{ fontSize: 12, color: colors.muted }}>Đang phân tích hồ sơ chiến dịch…</Text>
            </AIBox>
          ) : estimate ? (
            <PredictionExplain prediction={estimate} compact />
          ) : estimateError ? (
            <AIBox variant="warn" title="AI TẠM THỜI KHÔNG KHẢ DỤNG">
              <Text style={{ fontSize: 12, color: '#334155' }}>{estimateError}</Text>
            </AIBox>
          ) : null}

          <View style={{ height: 10 }} />
          <SectionHeader
            title="Gói tri ân"
            subtitle="Tùy chọn — thêm quà tặng cho nhà tài trợ"
            action={
              <Pressable onPress={() => setRewards((list) => [...list, blankReward()])}>
                <Text style={{ fontSize: 12, color: colors.primary, fontWeight: '800' }}>+ Thêm gói</Text>
              </Pressable>
            }
          />

          {rewards.map((r, index) => (
            <Card key={`reward-${index}`} style={{ padding: 10, marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <Text style={{ fontWeight: '800', fontSize: 12, flex: 1 }}>Gói #{index + 1}</Text>
                {rewards.length > 1 ? (
                  <Pressable onPress={() => setRewards((list) => list.filter((_, i) => i !== index))} hitSlop={8}>
                    <Ionicons name="trash-outline" size={17} color={colors.red} />
                  </Pressable>
                ) : null}
              </View>
              <Input
                label="Tên gói"
                value={r.title}
                onChangeText={(v) => updateReward(index, 'title', v)}
                placeholder="VD: Bộ quà tặng xanh"
              />
              <Input
                label="Mô tả"
                value={r.description}
                onChangeText={(v) => updateReward(index, 'description', v)}
                placeholder="Quyền lợi của nhà tài trợ"
              />
              <View style={{ flexDirection: 'row' }}>
                <Input
                  label="Mức tối thiểu (đ)"
                  value={r.min_amount}
                  onChangeText={(v) => updateReward(index, 'min_amount', v.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  style={{ flex: 1, marginRight: 6 }}
                />
                <Input
                  label="Số suất"
                  value={r.quantity_available}
                  onChangeText={(v) => updateReward(index, 'quantity_available', v.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  style={{ flex: 1 }}
                />
              </View>
            </Card>
          ))}

          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <Button title="Quay lại" variant="ghost" onPress={() => { setStep(1); setError(''); }} style={{ flex: 1, marginRight: 6 }} />
            <Button title="Xem lại" onPress={next} style={{ flex: 1 }} />
          </View>
        </Card>
      ) : null}

      {step === 3 ? (
        <View>
          <Card style={{ padding: 14 }}>
            <ProjectCover project={preview} height={150} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
              <Badge label={categoryName || 'Danh mục'} />
              <Badge label={vnd(Number(form.goal_amount))} tone="emerald" style={{ marginLeft: 5 }} />
              <Badge label="Chờ duyệt" tone="amber" style={{ marginLeft: 5 }} />
            </View>
            <Text style={{ fontSize: 17, fontWeight: '900', marginTop: 8 }}>{form.title}</Text>
            <Text style={{ fontSize: 12, color: '#334155', marginTop: 6, lineHeight: 19 }}>{form.description}</Text>
            <View style={{ backgroundColor: colors.slateSoft, borderRadius: 10, padding: 10, marginTop: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                <Text style={{ fontSize: 11, color: colors.muted }}>Thời gian</Text>
                <Text style={{ fontSize: 11, fontWeight: '700' }}>{form.start_date} → {form.end_date}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                <Text style={{ fontSize: 11, color: colors.muted }}>Mục tiêu</Text>
                <Text style={{ fontSize: 11, fontWeight: '700' }}>{vnd(Number(form.goal_amount))}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 11, color: colors.muted }}>Gói tri ân</Text>
                <Text style={{ fontSize: 11, fontWeight: '700' }}>{filledRewards.length} gói</Text>
              </View>
            </View>
            {filledRewards.length > 0 ? (
              <View style={{ marginTop: 8 }}>
                {filledRewards.map((r, i) => (
                  <Text key={`${r.title}-${i}`} style={{ fontSize: 11, color: colors.muted, marginBottom: 3 }}>
                    • {r.title} — từ {vnd(Number(r.min_amount))} · {r.quantity_available} suất
                  </Text>
                ))}
              </View>
            ) : null}
          </Card>

          {estimate ? <PredictionExplain prediction={estimate} /> : null}

          {error ? (
            <View style={{ backgroundColor: colors.redSoft, borderRadius: 10, padding: 10, marginTop: 10 }}>
              <Text style={{ fontSize: 12, color: '#991b1b' }}>{error}</Text>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', marginTop: 10 }}>
            <Button title="Quay lại" variant="ghost" onPress={() => { setStep(2); setError(''); }} style={{ flex: 1, marginRight: 6 }} />
            <Button title="Gửi duyệt" loading={busy} onPress={submit} style={{ flex: 1 }} />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}
