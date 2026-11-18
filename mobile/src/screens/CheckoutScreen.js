import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import { daysLeft, percent, vnd } from '../lib/format';
import { colors } from '../theme';
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

export default function CheckoutScreen({ navigation, route }) {
  const { id, rewardId } = route.params;
  const { currentUser, toast, refreshSession, refreshNotifications } = useApp();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [amount, setAmount] = useState(String(MIN_AMOUNT));
  const [anonymous, setAnonymous] = useState(false);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [payment, setPayment] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [checking, setChecking] = useState(false);

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

  const checkPayment = useCallback(
    async ({ silent = false } = {}) => {
      if (!payment?.txn_ref) return null;
      if (!silent) setChecking(true);
      try {
        const data = await api.get(`/payments/status/${encodeURIComponent(payment.txn_ref)}`);
        setPaymentStatus(data);
        if (!silent) setError('');
        if (data.result === 'success') {
          refreshNotifications();
          refreshSession();
        }
        return data;
      } catch (err) {
        if (!silent) setError(err.message);
        return null;
      } finally {
        if (!silent) setChecking(false);
      }
    },
    [payment?.txn_ref, refreshNotifications, refreshSession],
  );

  // Khi người dùng quay lại app sau khi thanh toán trên trình duyệt, tự kiểm tra trạng thái.
  useEffect(() => {
    if (!payment?.txn_ref) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkPayment({ silent: true });
    });
    return () => subscription.remove();
  }, [checkPayment, payment?.txn_ref]);

  const minAmount = preset ? Number(preset.min_amount) : MIN_AMOUNT;
  const amountNumber = Number(amount) || 0;
  const validAmount = amountNumber >= minAmount;

  if (loading) return <Screen><Loading text="Đang chuẩn bị trang thanh toán…" /></Screen>;
  if (loadError) return <Screen><ErrorState message={loadError} onRetry={load} /></Screen>;
  if (!project) return null;

  if (step === 3 && payment) {
    const paid = paymentStatus?.result === 'success';
    const failed = paymentStatus?.result === 'failed';
    const amountPaid = paymentStatus?.amount ?? payment.pledge?.amount;

    return (
      <Screen>
        <Card style={{ padding: 22, alignItems: 'center' }}>
          <Text style={{ fontSize: 46 }}>{paid ? '🎉' : failed ? '⚠️' : '⏳'}</Text>
          <Text style={{ fontSize: 20, fontWeight: '900', marginTop: 8 }}>
            {paid ? 'Tài trợ thành công!' : failed ? 'Thanh toán chưa hoàn tất' : 'Đang chờ thanh toán'}
          </Text>
          <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 4 }}>
            {paid
              ? `VNPay đã xác nhận khoản tài trợ ${vnd(amountPaid)} cho “${project.title}”.`
              : failed
                ? 'Giao dịch đã bị huỷ hoặc không thành công. Bạn chưa bị trừ tiền.'
                : 'Hoàn tất thanh toán trên VNPay rồi bấm “Kiểm tra trạng thái”.'}
          </Text>
          {preset ? (
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 4 }}>
              Gói tri ân: <Text style={{ fontWeight: '700' }}>{preset.title}</Text>
            </Text>
          ) : null}
          <View style={{ backgroundColor: colors.slateSoft, borderRadius: 12, padding: 12, marginTop: 12, width: '100%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Số tiền</Text>
              <Text style={{ fontSize: 12, fontWeight: '700' }}>{vnd(amountPaid)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Mã giao dịch</Text>
              <Text style={{ fontSize: 11, fontWeight: '700' }} selectable>{payment.txn_ref}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Trạng thái</Text>
              <Text style={{ fontSize: 12, fontWeight: '700', color: paid ? colors.primary : failed ? '#b91c1c' : colors.amber }}>
                {paid ? 'Đã thanh toán' : failed ? 'Chưa thanh toán' : 'Chờ xác nhận'}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', marginTop: 14, width: '100%' }}>
            <Button title="Về dự án" variant="ghost" onPress={() => navigation.goBack()} style={{ flex: 1, marginRight: 6 }} />
            <Button
              title="Mở lại VNPay"
              variant="ghost"
              onPress={() => Linking.openURL(payment.payment_url).catch(() => setError('Không mở được cổng thanh toán.'))}
              style={{ flex: 1 }}
            />
          </View>

          {!paid ? (
            <Button
              title={checking ? 'Đang kiểm tra…' : 'Kiểm tra trạng thái'}
              onPress={checkPayment}
              loading={checking}
              style={{ marginTop: 10, width: '100%' }}
            />
          ) : (
            <Button
              title="Xem lịch sử đóng góp"
              onPress={() => navigation.navigate('MainTabs', { screen: 'ProfileTab' })}
              style={{ marginTop: 10, width: '100%' }}
            />
          )}

          {failed ? (
            <Pressable
              onPress={() => {
                setStep(1);
                setPayment(null);
                setPaymentStatus(null);
                setError('');
              }}
              style={{ marginTop: 10 }}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>Thử lại với số tiền khác</Text>
            </Pressable>
          ) : null}
        </Card>

        {error ? (
          <View style={{ backgroundColor: colors.redSoft, borderRadius: 10, padding: 10, marginTop: 10 }}>
            <Text style={{ fontSize: 12, color: '#991b1b' }}>{error}</Text>
          </View>
        ) : null}

        {paid ? (
          <AIBox variant="success" title="KHOẢN TÀI TRỢ ĐÃ ĐƯỢC GHI NHẬN">
            <Text style={{ fontSize: 12, color: '#334155' }}>
              Hệ thống đã cập nhật số tiền của dự án và gửi thông báo cho chủ dự án.
            </Text>
          </AIBox>
        ) : (
          <AIBox variant="info" title="KIỂM TRA LẠI SAU KHI THANH TOÁN">
            <Text style={{ fontSize: 12, color: '#334155' }}>
              Hệ thống chỉ cộng tiền sau khi nhận được xác nhận chính thức từ VNPay. Nếu đã thanh toán thành công,
              hãy đợi vài giây rồi bấm “Kiểm tra trạng thái”.
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
        method: 'VNPay',
      });
      if (!data?.payment_url) throw new Error('Không nhận được liên kết thanh toán VNPay.');

      setPayment(data);
      setPaymentStatus(null);
      setStep(3);
      toast('Đang chuyển đến cổng thanh toán VNPay…', 'info');

      try {
        await Linking.openURL(data.payment_url);
      } catch {
        setError('Không mở được cổng thanh toán. Bấm “Mở lại VNPay” để thử lại.');
      }
    } catch (err) {
      setError(err.message);
      toast(err.message, 'error');
      setStep(2);
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
                  : project.status === 'suspended'
                    ? ' vì dự án đang tạm ngưng do chủ dự án bị khóa tài khoản.'
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
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderWidth: 1,
                borderColor: colors.primary,
                backgroundColor: colors.primaryPale,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                marginBottom: 6,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.primaryDark }}>VNPay</Text>
                <Text style={{ fontSize: 10, color: colors.muted, marginTop: 1 }}>
                  Thẻ ATM, Internet Banking, QR, thẻ quốc tế
                </Text>
              </View>
              <Badge label="Đã chọn" tone="emerald" />
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.slateSoft,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                marginBottom: 8,
              }}
            >
              <Text style={{ fontSize: 12, color: colors.muted }}>Ví MoMo · Thẻ quốc tế nhập trực tiếp</Text>
              <Badge label="Sắp hỗ trợ" tone="slate" />
            </View>
            <Text style={{ fontSize: 11, color: colors.muted, lineHeight: 16, marginBottom: 10 }}>
              Bạn sẽ được chuyển đến cổng thanh toán VNPay. Khoản tài trợ chỉ được ghi nhận sau khi VNPay xác nhận thành công.
            </Text>

            <AIBox variant={amountNumber >= 5000000 ? 'warn' : 'info'} title="KIỂM TRA RỦI RO TỰ ĐỘNG">
              <Text style={{ fontSize: 12, color: '#334155', lineHeight: 18 }}>
                Giao dịch được kiểm tra rủi ro tự động trước khi chuyển sang VNPay.
                {amountNumber >= 5000000
                  ? ' Khoản tài trợ lớn có thể được gắn cờ để quản trị viên xem xét.'
                  : ' Sau khi thanh toán xong, hệ thống mới cập nhật tiến độ dự án.'}
              </Text>
            </AIBox>

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
                title={busy ? 'Đang chuyển…' : `Thanh toán ${vnd(amountNumber)}`}
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
