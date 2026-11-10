import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { colors, radius } from '../theme';
import { Button, Card, Input, Screen } from '../components/ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function AuthScreen({ navigation, route }) {
  const { login, register, resendVerification, toast } = useApp();
  const [mode, setMode] = useState(route.params?.mode === 'register' ? 'register' : 'login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(null);
  const [resendBusy, setResendBusy] = useState(false);

  const switchMode = (next) => {
    setMode(next);
    setError('');
  };

  const submit = async () => {
    const trimmedEmail = email.trim();
    if (mode === 'register' && fullName.trim().length < 2) {
      setError('Họ tên tối thiểu 2 ký tự.');
      return;
    }
    if (!trimmedEmail) {
      setError('Vui lòng nhập email.');
      return;
    }
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError('Email không hợp lệ.');
      return;
    }
    if (!password) {
      setError('Vui lòng nhập mật khẩu.');
      return;
    }
    if (mode === 'register' && password.length < 8) {
      setError('Mật khẩu tối thiểu 8 ký tự.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      if (mode === 'login') {
        const user = await login(trimmedEmail, password);
        toast(`Chào mừng ${user.full_name}!`, 'success');
        if (user.role === 'admin') navigation.replace('Admin');
        else navigation.navigate('MainTabs');
      } else {
        const result = await register({ full_name: fullName.trim(), email: trimmedEmail, password });
        setPending({ ...result, email: trimmedEmail, full_name: fullName.trim() });
        setPassword('');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!pending?.email) return;
    setResendBusy(true);
    try {
      await resendVerification(pending.email);
      toast('Nếu email hợp lệ, hướng dẫn xác thực đã được gửi lại.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setResendBusy(false);
    }
  };

  if (pending) {
    return (
      <Screen>
        <Card style={{ padding: 22, alignItems: 'center' }}>
          <Text style={{ fontSize: 44 }}>📬</Text>
          <Text style={{ fontSize: 20, fontWeight: '900', marginTop: 8 }}>Kiểm tra email của bạn</Text>
          <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 20 }}>
            Chúng tôi đã gửi hướng dẫn tiếp theo tới <Text style={{ fontWeight: '800', color: colors.text }}>{pending.email}</Text>.
            Nếu đây là email mới, hãy bấm liên kết xác thực để kích hoạt tài khoản. Nếu email đã có tài khoản, bạn sẽ nhận
            hướng dẫn đăng nhập hoặc đặt lại mật khẩu.
          </Text>
          {pending.delivery === 'console' ? (
            <View style={{ backgroundColor: colors.amberSoft, borderRadius: 10, padding: 10, marginTop: 12 }}>
              <Text style={{ fontSize: 11, color: colors.amber }}>
                Chế độ dev: backend chưa cấu hình email nên nội dung được in ở console backend.
              </Text>
            </View>
          ) : null}
          {pending.dev_verification_url ? (
            <View style={{ backgroundColor: colors.slateSoft, borderRadius: 10, padding: 10, marginTop: 10 }}>
              <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>Liên kết dev:</Text>
              <Text style={{ fontSize: 10, color: colors.primary }} selectable>{pending.dev_verification_url}</Text>
            </View>
          ) : null}
          <Button
            title="Gửi lại email xác thực"
            variant="ghost"
            loading={resendBusy}
            onPress={resend}
            style={{ marginTop: 14, width: '100%' }}
          />
          <Button
            title="Đã xác thực — Đăng nhập"
            onPress={() => {
              setPending(null);
              setMode('login');
              setError('');
            }}
            style={{ marginTop: 8, width: '100%' }}
          />
        </Card>
        <Text style={{ textAlign: 'center', fontSize: 12, color: colors.muted, marginTop: 12 }}>
          Không nhận được email? Kiểm tra mục Spam hoặc thử lại sau ít phút.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ alignItems: 'center', marginBottom: 16 }}>
        <View
          style={{
            width: 60,
            height: 60,
            borderRadius: 18,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 30 }}>🤝</Text>
        </View>
        <Text style={{ fontSize: 24, fontWeight: '900', color: colors.text, marginTop: 10 }}>GâyQuỹ+</Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 3 }}>Cùng lan toả điều tốt đẹp</Text>
      </View>

      <Card style={{ padding: 18 }}>
        <View style={{ flexDirection: 'row', backgroundColor: colors.slateSoft, borderRadius: 10, padding: 3, marginBottom: 14 }}>
          {[
            ['login', 'Đăng nhập'],
            ['register', 'Đăng ký'],
          ].map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => switchMode(key)}
              style={{
                flex: 1,
                backgroundColor: mode === key ? colors.white : 'transparent',
                borderRadius: 8,
                paddingVertical: 8,
                alignItems: 'center',
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '800', color: mode === key ? colors.text : colors.muted }}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {mode === 'register' ? (
          <Input label="Họ và tên" value={fullName} onChangeText={setFullName} placeholder="Nguyễn Văn A" autoCapitalize="words" />
        ) : null}
        <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="ban@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Input
          label="Mật khẩu"
          value={password}
          onChangeText={setPassword}
          placeholder={mode === 'register' ? 'Tối thiểu 8 ký tự' : 'Nhập mật khẩu'}
          secureTextEntry
          hint={mode === 'register' ? 'Mật khẩu tối thiểu 8 ký tự.' : undefined}
        />

        {error ? (
          <View style={{ backgroundColor: colors.redSoft, borderRadius: 10, padding: 10, marginBottom: 10 }}>
            <Text style={{ fontSize: 12, color: '#991b1b' }}>{error}</Text>
          </View>
        ) : null}

        <Button
          title={mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
          onPress={submit}
          loading={busy}
          style={{ marginTop: 2 }}
        />

        {mode === 'login' ? (
          <Pressable onPress={() => navigation.navigate('ForgotPassword')} style={{ marginTop: 12, alignItems: 'center' }}>
            <Text style={{ fontSize: 12, color: colors.primary, fontWeight: '700' }}>Quên mật khẩu?</Text>
          </Pressable>
        ) : (
          <Text style={{ fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 10, lineHeight: 16 }}>
            Sau khi đăng ký, bạn sẽ nhận email hướng dẫn xác thực. Tài khoản đã tồn tại sẽ nhận hướng dẫn đăng nhập thay vì
            tạo trùng.
          </Text>
        )}
      </Card>

      <Pressable
        onPress={() => navigation.navigate('MainTabs')}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 16 }}
      >
        <Ionicons name="arrow-back" size={14} color={colors.muted} />
        <Text style={{ fontSize: 12, color: colors.muted, marginLeft: 4 }}>Tiếp tục khám phá không cần đăng nhập</Text>
      </Pressable>
    </Screen>
  );
}
