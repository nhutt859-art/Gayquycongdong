import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useApp } from '../context/AppContext';
import { colors } from '../theme';
import { Button, Card, Input, Screen } from '../components/ui';

export default function ForgotPasswordScreen({ navigation }) {
  const { forgotPassword, resetPassword, toast } = useApp();
  const [step, setStep] = useState('request');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [devOtp, setDevOtp] = useState('');

  const sendOtp = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Vui lòng nhập email.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await forgotPassword(trimmed);
      setInfo(data?.message || 'Nếu email hợp lệ, mã OTP đã được gửi. Vui lòng kiểm tra hộp thư (cả mục Spam).');
      if (data?.dev_otp) setDevOtp(data.dev_otp);
      setStep('verify');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!otp.trim()) {
      setError('Vui lòng nhập mã OTP.');
      return;
    }
    if (password.length < 8) {
      setError('Mật khẩu mới tối thiểu 8 ký tự.');
      return;
    }
    if (password !== confirm) {
      setError('Mật khẩu nhập lại không khớp.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await resetPassword({ email: email.trim(), token: otp.trim(), password });
      setStep('done');
      toast('Đặt lại mật khẩu thành công, hãy đăng nhập lại.', 'success');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card style={{ padding: 18 }}>
        {step === 'done' ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 46 }}>✅</Text>
            <Text style={{ fontSize: 20, fontWeight: '900', marginTop: 8 }}>Đặt lại mật khẩu thành công</Text>
            <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 19 }}>
              Mật khẩu đã được cập nhật. Mọi phiên đăng nhập cũ đã bị vô hiệu hoá để bảo vệ tài khoản.
            </Text>
            <Button
              title="Về trang đăng nhập"
              onPress={() => navigation.replace('Auth')}
              style={{ marginTop: 16, width: '100%' }}
            />
          </View>
        ) : (
          <>
            <Text style={{ fontSize: 20, fontWeight: '900' }}>Quên mật khẩu</Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4, lineHeight: 18 }}>
              {step === 'request'
                ? 'Nhập email đã đăng ký. Chúng tôi sẽ gửi mã OTP 6 chữ số để đặt lại mật khẩu.'
                : 'Nhập mã OTP trong email và mật khẩu mới của bạn.'}
            </Text>

            <View style={{ height: 14 }} />

            {step === 'request' ? (
              <>
                <Input
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="ban@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {error ? <ErrorBox message={error} /> : null}
                <Button title="Gửi mã OTP" onPress={sendOtp} loading={busy} />
              </>
            ) : (
              <>
                <View style={{ backgroundColor: colors.primaryPale, borderRadius: 10, padding: 10, marginBottom: 12 }}>
                  <Text style={{ fontSize: 12, color: colors.primaryDark, lineHeight: 18 }}>
                    {info || 'Nếu email hợp lệ, mã OTP đã được gửi. Vui lòng kiểm tra hộp thư (cả mục Spam).'}
                  </Text>
                  {devOtp ? (
                    <Text style={{ fontSize: 11, color: colors.amber, marginTop: 4 }}>
                      OTP dev: <Text style={{ fontWeight: '900' }}>{devOtp}</Text>
                    </Text>
                  ) : null}
                </View>
                <Input
                  label="Mã OTP"
                  value={otp}
                  onChangeText={(v) => setOtp(v.replace(/[^0-9]/g, '').slice(0, 6))}
                  placeholder="6 chữ số"
                  keyboardType="number-pad"
                  maxLength={6}
                />
                <Input
                  label="Mật khẩu mới"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Tối thiểu 8 ký tự"
                  secureTextEntry
                  hint="Mật khẩu mới tối thiểu 8 ký tự."
                />
                <Input
                  label="Nhập lại mật khẩu mới"
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="Nhập lại mật khẩu"
                  secureTextEntry
                />
                {error ? <ErrorBox message={error} /> : null}
                <Button title="Đặt lại mật khẩu" onPress={reset} loading={busy} />
                <Button
                  title="Gửi lại mã OTP"
                  variant="ghost"
                  onPress={sendOtp}
                  loading={busy}
                  style={{ marginTop: 8 }}
                />
                <Pressable onPress={() => setStep('request')} style={{ marginTop: 12, alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>← Đổi email khác</Text>
                </Pressable>
              </>
            )}
          </>
        )}
      </Card>
    </Screen>
  );
}

function ErrorBox({ message }) {
  return (
    <View style={{ backgroundColor: colors.redSoft, borderRadius: 10, padding: 10, marginBottom: 10 }}>
      <Text style={{ fontSize: 12, color: '#991b1b' }}>{message}</Text>
    </View>
  );
}
