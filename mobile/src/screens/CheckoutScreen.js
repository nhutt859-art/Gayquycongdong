import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  Input,
  Loading,
  ProjectCover,
  Screen,
  StatusBadge,
} from '../components/ui';

const MIN_AMOUNT = 10000;
const QUICK_AMOUNTS = [100000, 200000, 500000, 1000000, 2000000, 5000000];
const METHODS = ['VNPay', 'Momo', 'Thẻ quốc tế'];

export default function CheckoutScreen({ navigation, route }) {
  const { id, rewardId } = route.params;
  const { currentUser, toast, refreshSession, refreshNotifications } = useApp();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [amount, setAmount] = useState(String(MIN_AMOUNT));
  const [method, setMethod] = useState('VNPay');
  const [anonymous, setAnonymous] = useState(false);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await api.get(`/projects/${id}`);
      setProject(data);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const preset = useMemo(() => {
    if (!project || !rewardId) return null;
    return (project.rewards || []).find((r) => r.id === rewardId) || null;
  }, [project, rewardId]);

  useEffect(() => {
    if (preset) setAmount(String(Number(preset.min_amount)));
  }, [preset]);

  const minAmount = preset ? Number(preset.min_amount) : MIN_AMOUNT;
  const amountNumber = Number(amount) || 0;
  const validAmount = amountNumber >= minAmount;

  if (loading) return <Screen><Loading text="Đang chuẩn bị trang thanh toán…" /></Screen>;
  if (loadError) return <Screen><ErrorState message={loadError} onRetry={load} /></Screen>;
  if (!project) return null;

  if (step === 3 && result) {
    return (
      <Screen>
        <Card style={{ padding: 22, alignItems: 'center' }}>
          <Text style={{ fontSize: 46 }}>🎉</Text>
          <Text style={{ fontSize: 20, fontWeight: '900', marginTop: 8 }}>Tài trợ thành công!</Text>
          <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 4 }}>
            Bạn đã tài trợ <Text style={{ fontWeight: '800', color: colors.primary }}>{vnd(result.pledge.amount)}</Text> cho “{project.title}”.
          </Text>
          {preset ? (
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 4 }}>
              Gói tri ân: <Text style={{ fontWeight: '700' }}>{preset.title}</Text>
            </Text>
          ) : null}
          <View style={{ backgroundColor: colors.slateSoft, borderRadius: 12, padding: 12, marginTop: 12, width: '100%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Phương thức</Text>
              <Text style={{ fontSize: 12, fontWeight: '700' }}>{method}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Ẩn danh</Text>
              <Text style={{ fontSize: 12, fontWeight: '700' }}>{anonymous ? 'Có' : 'Không'}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Trạng thái</Text>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>Đã thanh toán (mô phỏng)</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', marginTop: 14, width: '100%' }}>
            <Button title="Về dự án" variant="ghost" onPress={() => navigation.goBack()} style={{ flex: 1, marginRight: 6 }} />
            <Button
              title="Lịch sử đóng góp"
              onPress={() => navigation.navigate('MainTabs', { screen: 'ProfileTab' })}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
        {result.fraud && Number(result.fraud.score) >= 60 ? (
          <AIBox variant="warn" title="GIAO DỊCH ĐANG ĐƯỢC XEM XÉT">
            <Text style={{ fontSize: 12, color: '#334155' }}>
              Điểm rủi ro <Text style={{ fontWeight: '800' }}>{Math.round(Number(result.fraud.score))}%</Text>. {result.fraud.summary}
            </Text>
            <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
              Khoản tài trợ vẫn được ghi nhận; quản trị viên sẽ xác minh trước khi giải ngân.
            </Text>
          </AIBox>
        ) : (
          <AIBox variant="success" title="GIAO DỊCH AN TOÀN">
            <Text style={{ fontSize: 12, color: '#334155' }}>
              Giao dịch không có tín hiệu bất thường. Hệ thống tiếp tục theo dõi nếu có giao dịch mới.
            </Text>
          </AIBox>
        )}
      </Screen>
    );
  }

  const soldOut = preset && preset.remaining <= 0;

  const goToPayment = () => {
    setError('');
    if (soldOut) {
      setError('Gói tri ân đã hết suất, vui lòng chọn gói khác.');
      return;
    }
    if (!validAmount) {
      setError(`Số tiền tối thiểu là ${vnd(minAmount)}${preset ? ` cho gói “${preset.title}”` : ''}.`);
      return;
    }
    setStep(2);
  };

  const pay = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await api.post(`/projects/${project.id}/pledges`, {
        amount: amountNumber,
        reward_id: preset?.id || null,
        is_anonymous: anonymous,
        method,
        simulate_failure: simulateFailure,
      });
      setResult(data);
      setStep(3);
      toast(data.message || 'Tài trợ thành công.', 'success');
      refreshNotifications();
      refreshSession();
    } catch (err) {
      setError(err.message);
      toast(err.message, 'error');
      if (err.status === 402) setStep(2);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card style={{ padding: 12, marginBottom: 12 }}>
        <View style={{ flexDirection: 'row' }}>
          <ProjectCover project={project} height={70} style={{ width: 100, marginRight: 10 }} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusBadge status={project.status} />
              <Text style={{ fontSize: 10, color: colors.muted, marginLeft: 6 }}>{daysLeft(project.end_date)}</Text>
            </View>
            <Text style={{ fontWeight: '800', fontSize: 13, marginTop: 4 }} numberOfLines={2}>{project.title}</Text>
            <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>
              {percent(project)}% · {vnd(project.current_amount)} / {vnd(project.goal_amount)}
            </Text>
          </View>
        </View>
      </Card>

      <Card style={{ padding: 14 }}>
        <Text style={{ fontSize: 19, fontWeight: '900' }}>Tài trợ dự án</Text>
        <View style={{ flexDirection: 'row', marginTop: 10, marginBottom: 12 }}>
          {[[1, '1. Chọn mức'], [2, '2. Thanh toán'], [3, '3. Hoàn tất']].map(([n, label]) => (
            <View
              key={n}
              style={{
                flex: 1,
                backgroundColor: step === n ? '#1e293b' : colors.slateSoft,
                borderRadius: 8,
                paddingVertical: 5,
                marginRight: n < 3 ? 4 : 0,
              }}
            >
              <Text style={{ textAlign: 'center', fontSize: 10, fontWeight: '700', color: step === n ? '#fff' : colors.muted }}>
                {label}
              </Text>
            </View>
          ))}
        </View>

        {!project.can_pledge ? (
          <View style={{ backgroundColor: colors.amberSoft, borderRadius: 10, padding: 10, marginBottom: 10 }}>
            <Text style={{ fontSize: 12, color: colors.amber, lineHeight: 18 }}>
              ⛔ Bạn không thể tài trợ dự án này
              {currentUser?.role === 'admin'
                ? ' vì đang dùng tài khoản quản trị.'
                : project.owner_id === currentUser?.id
                  ? ' vì đây là dự án của bạn.'
                  : project.status !== 'active'
                    ? ' vì dự án không ở trạng thái đang gây quỹ.'
                    : ' vì chiến dịch đã kết thúc.'}
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={{ backgroundColor: colors.redSoft, borderRadius: 10, padding: 10, marginBottom: 10 }}>
            <Text style={{ fontSize: 12, color: '#991b1b' }}>{error}</Text>
          </View>
        ) : null}

        {step === 1 ? (
          <View>
            <Input
              label="Số tiền tài trợ (đ)"
              value={amount}
              onChangeText={(v) => setAmount(v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              hint={`Tối thiểu ${vnd(minAmount)}`}
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
              {QUICK_AMOUNTS.filter((m) => m >= minAmount).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setAmount(String(m))}
                  style={{
                    borderWidth: 1,
                    borderColor: amountNumber === m ? colors.primary : colors.border,
                    backgroundColor: amountNumber === m ? colors.primaryPale : colors.white,
                    borderRadius: 99,
                    paddingHorizontal: 11,
                    paddingVertical: 6,
                    marginRight: 6,
                    marginBottom: 6,
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '700', color: amountNumber === m ? colors.primaryDark : '#475569' }}>
                    {vnd(m)}
                  </Text>
                </Pressable>
              ))}
            </View>

            {preset ? (
              <View style={{ borderWidth: 1, borderColor: colors.primarySoft, backgroundColor: colors.primaryPale, borderRadius: 10, padding: 10 }}>
                <Text style={{ fontWeight: '800', fontSize: 13 }}>Gói đã chọn: {preset.title}</Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                  Tối thiểu {vnd(preset.min_amount)} · còn {preset.remaining} suất
                </Text>
                {preset.description ? (
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{preset.description}</Text>
                ) : null}
                <Pressable onPress={() => navigation.goBack()} style={{ marginTop: 5 }}>
                  <Text style={{ fontSize: 11, color: colors.primary, fontWeight: '700' }}>Đổi gói khác</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ backgroundColor: colors.slateSoft, borderRadius: 10, padding: 10 }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>Bạn đang tài trợ tự do, không kèm quà tri ân.</Text>
              </View>
            )}

            <Pressable
              onPress={() => setAnonymous((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}
            >
              <Ionicons name={anonymous ? 'checkbox' : 'square-outline'} size={20} color={anonymous ? colors.primary : colors.soft} />
              <Text style={{ fontSize: 12, color: '#334155', marginLeft: 6, flex: 1 }}>
                Tài trợ ẩn danh (tên không hiển thị với chủ dự án)
              </Text>
            </Pressable>

            <Button
              title="Tiếp tục thanh toán"
              onPress={goToPayment}
              disabled={!project.can_pledge}
              style={{ marginTop: 12 }}
            />
          </View>
        ) : null}

        {step === 2 ? (
          <View>
            <View style={{ backgroundColor: colors.slateSoft, borderRadius: 10, padding: 10, marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>Số tiền</Text>
                <Text style={{ fontSize: 12, fontWeight: '800' }}>{vnd(amountNumber)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>Dự án</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', flex: 1, textAlign: 'right', marginLeft: 10 }}>{project.title}</Text>
              </View>
              {preset ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>Gói tri ân</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700' }}>{preset.title}</Text>
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>Ẩn danh</Text>
                <Text style={{ fontSize: 12, fontWeight: '700' }}>{anonymous ? 'Có' : 'Không'}</Text>
              </View>
            </View>

            <Text style={{ fontSize: 12, fontWeight: '800', color: '#334155', marginBottom: 6 }}>Phương thức thanh toán</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
              {METHODS.map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setMethod(m)}
                  style={{
                    borderWidth: 1,
                    borderColor: method === m ? colors.primary : colors.border,
                    backgroundColor: method === m ? colors.primaryPale : colors.white,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    marginRight: 6,
                    marginBottom: 6,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: method === m ? colors.primaryDark : '#475569' }}>{m}</Text>
                </Pressable>
              ))}
            </View>

            <AIBox variant={amountNumber >= 5000000 ? 'warn' : 'info'} title="KIỂM TRA RỦI RO TỰ ĐỘNG">
              <Text style={{ fontSize: 12, color: '#334155', lineHeight: 18 }}>
                Giao dịch được kiểm tra rủi ro tự động trước khi xác nhận.
                {amountNumber >= 5000000
                  ? ' Khoản tài trợ lớn có thể được gắn cờ để quản trị viên xem xét.'
                  : ' Hệ thống ghi nhận giao dịch và cập nhật tiến độ dự án ngay lập tức.'}
              </Text>
            </AIBox>

            <Pressable
              onPress={() => setSimulateFailure((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}
            >
              <Ionicons
                name={simulateFailure ? 'checkbox' : 'square-outline'}
                size={20}
                color={simulateFailure ? colors.red : colors.soft}
              />
              <Text style={{ fontSize: 12, color: '#334155', marginLeft: 6, flex: 1 }}>
                Giả lập thanh toán thất bại (để kiểm thử)
              </Text>
            </Pressable>

            <View style={{ flexDirection: 'row', marginTop: 12 }}>
              <Button
                title="Quay lại"
                variant="ghost"
                disabled={busy}
                onPress={() => {
                  setStep(1);
                  setError('');
                }}
                style={{ flex: 1, marginRight: 6 }}
              />
              <Button
                title={`Xác nhận ${vnd(amountNumber)}`}
                onPress={pay}
                loading={busy}
                disabled={!project.can_pledge}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : null}
      </Card>
    </Screen>
  );
}
