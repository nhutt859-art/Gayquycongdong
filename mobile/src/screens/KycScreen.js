import { useEffect, useRef, useState } from 'react';
import { Image, Linking, Pressable, Text, View } from 'react-native';
import { api } from '../lib/api';
import { useApp } from '../context/AppContext';
import { formatDate } from '../lib/format';
import {
  KYC_DOCUMENT_TYPES,
  KYC_SCAN_FIELD_LABELS,
  KYC_SCAN_FIELDS,
  kycErrorMessage,
  preferScannedName,
  validateKycDraft,
} from '../lib/kyc';
import { pickDocumentImage } from '../lib/images';
import { PHONE_HINT, isValidVietnamesePhone } from '../lib/phone';
import { colors } from '../theme';
import { Badge, Button, Card, Input, Screen, SectionHeader } from '../components/ui';

function initialForm(user) {
  return {
    full_name: user?.full_name || '',
    dob: '',
    phone: user?.phone || '',
    email: user?.email || '',
    address: '',
    document_type: 'cccd',
    document_number: '',
    front_image: '',
    back_image: '',
  };
}

export default function KycScreen({ navigation }) {
  const { currentUser, refreshSession, updateCurrentUser, toast } = useApp();
  const [form, setForm] = useState(() => initialForm(currentUser));
  const [kyc, setKyc] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [devUrl, setDevUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [scanNote, setScanNote] = useState('');
  const [scanTone, setScanTone] = useState('info');
  const scanSeq = useRef(0);
  const [resendBusy, setResendBusy] = useState(false);

  useEffect(() => {
    if (!currentUser) return undefined;
    let alive = true;
    (async () => {
      try {
        const data = await api.get('/me');
        if (!alive) return;
        setKyc(data?.kyc || null);
        if (data?.kyc) {
          setForm((value) => ({
            ...value,
            full_name: data.kyc.full_name || value.full_name,
            dob: data.kyc.dob ? String(data.kyc.dob).slice(0, 10) : value.dob,
            phone: data.kyc.phone || value.phone,
            email: data.kyc.email || value.email,
            address: data.kyc.address || value.address,
            document_type: data.kyc.document_type || value.document_type,
            // Không điền lại số giấy tờ vì API chỉ trả về dạng che ký tự cuối.
          }));
        }
      } catch {
        // Không chặn biểu mẫu nếu chưa tải được tóm tắt KYC.
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  const documentType = KYC_DOCUMENT_TYPES[form.document_type] || KYC_DOCUMENT_TYPES.cccd;
  const phoneValue = form.phone.trim();
  const phoneInvalid = Boolean(phoneValue) && !isValidVietnamesePhone(phoneValue);

  const setField = (key, value) => {
    setForm((value2) => ({ ...value2, [key]: value }));
    setFieldErrors((errors) => ({ ...errors, [key]: '' }));
  };

  const chooseDocumentType = (key) => {
    if (key !== form.document_type) {
      scanSeq.current += 1;
      setScanBusy(false);
      setScanNote('');
    }
    setForm((value) => ({ ...value, document_type: key }));
    setFieldErrors((errors) => ({ ...errors, document_number: '', back_image: '' }));
  };

  const applyScannedFields = (fields) => {
    if (!fields) return [];
    const filled = KYC_SCAN_FIELDS.filter((key) => fields[key]);
    if (!filled.length) return [];

    setForm((value) => {
      const next = { ...value };
      for (const key of filled) {
        next[key] = key === 'full_name' ? preferScannedName(value.full_name, fields[key]) : fields[key];
      }
      return next;
    });
    setFieldErrors((errors) => {
      const next = { ...errors };
      for (const key of filled) next[key] = '';
      return next;
    });
    return filled;
  };

  const pickImage = async (side) => {
    const label = side === 'front' ? `Ảnh mặt trước ${documentType.short}` : `Ảnh mặt sau ${documentType.short}`;
    setImageBusy(side);
    try {
      const dataUrl = await pickDocumentImage(label);
      if (!dataUrl) return;

      const seq = side === 'front' ? scanSeq.current + 1 : scanSeq.current;
      if (side === 'front') scanSeq.current = seq;
      setField(`${side}_image`, dataUrl);

      if (side !== 'front') return;

      setScanBusy(true);
      setScanTone('info');
      setScanNote('Đang đọc thông tin trên ảnh…');
      try {
        const scan = await api.post('/me/kyc/scan', {
          document_type: form.document_type,
          image: dataUrl,
        });
        if (seq !== scanSeq.current) return;

        const filled = applyScannedFields(scan?.fields || {});
        if (filled.length) {
          const labels = filled.map((key) => KYC_SCAN_FIELD_LABELS[key]).filter(Boolean);
          const missing = (scan?.missing || []).map((key) => KYC_SCAN_FIELD_LABELS[key]).filter(Boolean);
          setScanTone('success');
          setScanNote(
            `Đã tự điền ${labels.join(', ')} từ ảnh. Vui lòng kiểm tra lại.${missing.length ? ` Chưa đọc được: ${missing.join(', ')}.` : ''}`,
          );
        } else {
          setScanTone('warn');
          setScanNote(
            scan?.message ||
              'Ảnh đã được tải lên nhưng chưa đọc được thông tin. Vui lòng nhập tay hoặc chọn ảnh rõ hơn.',
          );
        }
      } catch (err) {
        if (seq !== scanSeq.current) return;
        setScanTone('warn');
        setScanNote(`${err.message} Ảnh vẫn được giữ — bạn có thể nhập tay hoặc chọn ảnh khác.`);
      } finally {
        if (seq === scanSeq.current) setScanBusy(false);
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setImageBusy('');
    }
  };

  const clearImage = (side) => {
    if (side === 'front') {
      scanSeq.current += 1;
      setScanBusy(false);
      setScanNote('');
    }
    setField(`${side}_image`, '');
  };

  const reloadSummary = async () => {
    try {
      const data = await api.get('/me');
      setKyc(data?.kyc || null);
    } catch {
      // Bỏ qua, trạng thái chính vẫn lấy từ currentUser.
    }
  };

  const submit = async () => {
    const errors = validateKycDraft(form);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setError('Vui lòng kiểm tra các trường được đánh dấu bên dưới.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    setDevUrl('');
    try {
      const payload = {
        full_name: form.full_name.trim().replace(/\s+/g, ' '),
        dob: form.dob.trim(),
        phone: form.phone.trim(),
        email: form.email.trim().toLowerCase(),
        address: form.address.trim().replace(/\s+/g, ' '),
        document_type: form.document_type,
        document_number: form.document_number.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
        front_image: form.front_image,
        back_image: form.back_image || null,
      };
      const data = await api.post('/me/kyc', payload);
      if (data?.user) updateCurrentUser(data.user);
      setMessage(data?.message || 'Hồ sơ KYC đã được tiếp nhận.');
      setDevUrl(data?.dev_verification_url || '');
      toast(data?.message || 'Đã gửi hồ sơ xác thực danh tính.', 'success');
      await refreshSession();
      await reloadSummary();
    } catch (err) {
      setError(kycErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setResendBusy(true);
    setError('');
    try {
      const data = await api.post('/me/kyc/resend');
      if (data?.user) updateCurrentUser(data.user);
      setMessage(data?.message || 'Đã gửi lại email xác thực KYC.');
      setDevUrl(data?.dev_verification_url || '');
      toast('Đã gửi lại email xác thực KYC.', 'success');
      await refreshSession();
    } catch (err) {
      setError(kycErrorMessage(err));
    } finally {
      setResendBusy(false);
    }
  };

  if (!currentUser) {
    return (
      <Screen>
        <Card style={{ padding: 22, alignItems: 'center' }}>
          <Text style={{ fontSize: 42 }}>🪪</Text>
          <Text style={{ fontSize: 19, fontWeight: '900', marginTop: 8 }}>Đăng nhập để xác thực danh tính</Text>
          <Button title="Đăng nhập" onPress={() => navigation.navigate('Auth')} style={{ marginTop: 14, width: '100%' }} />
        </Card>
      </Screen>
    );
  }

  if (currentUser.kyc_status === 'verified') {
    return (
      <Screen>
        <Card style={{ padding: 22, alignItems: 'center' }}>
          <Text style={{ fontSize: 46 }}>✅</Text>
          <Text style={{ fontSize: 20, fontWeight: '900', marginTop: 8, color: colors.primaryDark }}>
            Danh tính đã được xác thực
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 18 }}>
            Tài khoản của bạn đã hoàn tất KYC{kyc?.verified_at ? ` vào ${formatDate(kyc.verified_at)}` : ''}. Bạn có thể tạo
            dự án gây quỹ và nhận huy hiệu tin cậy.
          </Text>
          {kyc?.document_type ? (
            <View style={{ marginTop: 10 }}>
              <Badge
                label={`${KYC_DOCUMENT_TYPES[kyc.document_type]?.label || 'Giấy tờ'} · ${kyc.document_number || ''}`}
                tone="emerald"
              />
            </View>
          ) : null}
          <Button
            title="Về trang cá nhân"
            onPress={() => navigation.navigate('MainTabs', { screen: 'ProfileTab' })}
            style={{ marginTop: 16, width: '100%' }}
          />
        </Card>
      </Screen>
    );
  }

  const pending = currentUser.kyc_status === 'pending';

  return (
    <Screen>
      <SectionHeader
        title="Xác thực danh tính (KYC)"
        subtitle="CCCD hoặc hộ chiếu · đối chiếu OCR · xác thực qua email"
      />

      {pending ? (
        <Card style={{ padding: 14, marginBottom: 12, backgroundColor: colors.amberSoft, borderColor: '#fcd34d' }}>
          <Text style={{ fontWeight: '800', color: '#92400e' }}>⏳ Hồ sơ đang chờ xác thực email</Text>
          <Text style={{ fontSize: 12, color: '#92400e', lineHeight: 18, marginTop: 4 }}>
            Hồ sơ đã được tiếp nhận{kyc?.submitted_at ? ` ngày ${formatDate(kyc.submitted_at)}` : ''}. Mở liên kết
            xác thực trong email đã gửi để hoàn tất. Nếu không thấy email, hãy kiểm tra mục Spam hoặc gửi lại.
          </Text>
          <Button
            title="Gửi lại email xác thực KYC"
            variant="ghost"
            loading={resendBusy}
            onPress={resend}
            style={{ marginTop: 10 }}
          />
        </Card>
      ) : null}

      {message ? (
        <Card style={{ padding: 14, marginBottom: 12, backgroundColor: colors.primaryPale, borderColor: '#6ee7b7' }}>
          <Text style={{ fontSize: 12, color: colors.primaryDark, lineHeight: 18 }}>{message}</Text>
          {devUrl ? (
            <Pressable onPress={() => Linking.openURL(devUrl)} style={{ marginTop: 6 }}>
              <Text style={{ fontSize: 11, color: colors.primary, fontWeight: '800', textDecorationLine: 'underline' }}>
                Mở liên kết xác thực KYC (dev) →
              </Text>
            </Pressable>
          ) : null}
        </Card>
      ) : null}

      <Card style={{ padding: 14, marginBottom: 12 }}>
        <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 18 }}>
          Hệ thống tự động đọc thông tin trên ảnh giấy tờ để điền vào biểu mẫu, kiểm tra số giấy tờ trùng lặp, sau đó gửi
          liên kết xác thực tới email liên hệ để hoàn tất KYC. Ảnh dọc hoặc ngang đều được, miễn là đủ sáng và rõ nét.
        </Text>
      </Card>

      <Card style={{ padding: 14 }}>
        <Text style={{ fontSize: 12, fontWeight: '800', color: '#334155', marginBottom: 6 }}>Loại giấy tờ</Text>
        <View style={{ flexDirection: 'row', marginBottom: 12 }}>
          {Object.entries(KYC_DOCUMENT_TYPES).map(([key, meta]) => (
            <Pressable
              key={key}
              onPress={() => chooseDocumentType(key)}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: form.document_type === key ? colors.primary : colors.border,
                backgroundColor: form.document_type === key ? colors.primaryPale : colors.white,
                borderRadius: 10,
                padding: 10,
                marginRight: key === 'cccd' ? 6 : 0,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: '800',
                  color: form.document_type === key ? colors.primaryDark : '#475569',
                }}
              >
                {meta.label}
              </Text>
              <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>
                {meta.backRequired ? 'Cần ảnh 2 mặt' : 'Cần ảnh mặt trước'}
              </Text>
            </Pressable>
          ))}
        </View>

        <Input
          label="Họ và tên trên giấy tờ *"
          value={form.full_name}
          onChangeText={(v) => setField('full_name', v)}
          placeholder="Nguyễn Văn A"
          autoCapitalize="words"
          error={fieldErrors.full_name}
        />
        <Input
          label="Ngày sinh *"
          value={form.dob}
          onChangeText={(v) => setField('dob', v)}
          placeholder="YYYY-MM-DD"
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          hint="Ví dụ 1995-08-20. Phải khớp ngày sinh trên giấy tờ."
          error={fieldErrors.dob}
        />
        <Input
          label="Số điện thoại *"
          value={form.phone}
          onChangeText={(v) => setField('phone', v)}
          keyboardType="phone-pad"
          placeholder="09xxxxxxxx"
          hint={phoneValue && !phoneInvalid ? '✓ Số điện thoại hợp lệ.' : PHONE_HINT}
          error={fieldErrors.phone || (phoneInvalid ? 'Số điện thoại chưa hợp lệ.' : '')}
        />
        <Input
          label="Email liên hệ *"
          value={form.email}
          onChangeText={(v) => setField('email', v)}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="email@example.com"
          hint="Liên kết xác thực KYC sẽ được gửi tới email này."
          error={fieldErrors.email}
        />
        <Input
          label="Địa chỉ thường trú *"
          value={form.address}
          onChangeText={(v) => setField('address', v)}
          placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành"
          multiline
          error={fieldErrors.address}
        />
        <Input
          label={`${documentType.numberLabel} *`}
          value={form.document_number}
          onChangeText={(v) => setField('document_number', v.toUpperCase())}
          placeholder={documentType.numberPlaceholder}
          autoCapitalize="characters"
          autoCorrect={false}
          hint={`${documentType.numberHint} Số giấy tờ phải khớp với ảnh tải lên.`}
          error={fieldErrors.document_number}
        />

        <Text style={{ fontSize: 12, fontWeight: '800', color: '#334155', marginBottom: 6 }}>
          Ảnh mặt trước {documentType.short} *
        </Text>
        {form.front_image ? (
          <View style={{ marginBottom: 10 }}>
            <Image
              source={{ uri: form.front_image }}
              style={{ width: '100%', height: 170, borderRadius: 10, backgroundColor: colors.slateSoft }}
              resizeMode="contain"
            />
            <View style={{ flexDirection: 'row', marginTop: 6 }}>
              <Button
                title="Chọn ảnh khác"
                variant="ghost"
                icon="camera-outline"
                loading={imageBusy === 'front'}
                onPress={() => pickImage('front')}
                style={{ flex: 1, marginRight: 6 }}
              />
              <Button
                title="Xóa"
                variant="danger"
                onPress={() => clearImage('front')}
                style={{ width: 90 }}
              />
            </View>
          </View>
        ) : (
          <Button
            title="Tải ảnh mặt trước"
            variant="soft"
            icon="camera-outline"
            loading={imageBusy === 'front'}
            onPress={() => pickImage('front')}
            style={{ marginBottom: 10 }}
          />
        )}
        {fieldErrors.front_image ? (
          <Text style={{ fontSize: 11, color: colors.red, marginBottom: 8 }}>{fieldErrors.front_image}</Text>
        ) : null}

        <Text style={{ fontSize: 12, fontWeight: '800', color: '#334155', marginBottom: 6 }}>
          Ảnh mặt sau {documentType.backRequired ? `${documentType.short} *` : '(không bắt buộc)'}
        </Text>
        {form.back_image ? (
          <View style={{ marginBottom: 10 }}>
            <Image
              source={{ uri: form.back_image }}
              style={{ width: '100%', height: 170, borderRadius: 10, backgroundColor: colors.slateSoft }}
              resizeMode="contain"
            />
            <View style={{ flexDirection: 'row', marginTop: 6 }}>
              <Button
                title="Chọn ảnh khác"
                variant="ghost"
                icon="camera-outline"
                loading={imageBusy === 'back'}
                onPress={() => pickImage('back')}
                style={{ flex: 1, marginRight: 6 }}
              />
              <Button title="Xóa" variant="danger" onPress={() => clearImage('back')} style={{ width: 90 }} />
            </View>
          </View>
        ) : (
          <Button
            title={documentType.backRequired ? 'Tải ảnh mặt sau' : 'Bổ sung ảnh mặt sau (tùy chọn)'}
            variant="soft"
            icon="camera-outline"
            loading={imageBusy === 'back'}
            onPress={() => pickImage('back')}
            style={{ marginBottom: 10 }}
          />
        )}
        {fieldErrors.back_image ? (
          <Text style={{ fontSize: 11, color: colors.red, marginBottom: 8 }}>{fieldErrors.back_image}</Text>
        ) : null}

        {scanNote ? (
          <View
            style={{
              backgroundColor:
                scanTone === 'success' ? colors.primaryPale : scanTone === 'warn' ? colors.amberSoft : colors.blueSoft,
              borderRadius: 10,
              padding: 10,
              marginBottom: 10,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                lineHeight: 18,
                color: scanTone === 'success' ? colors.primaryDark : scanTone === 'warn' ? '#92400e' : colors.blue,
              }}
            >
              {scanNote}
            </Text>
          </View>
        ) : null}

        {error ? (
          <View style={{ backgroundColor: colors.redSoft, borderRadius: 10, padding: 10, marginBottom: 10 }}>
            <Text style={{ fontSize: 12, color: '#991b1b', lineHeight: 18 }}>{error}</Text>
          </View>
        ) : null}

        <Button
          title={scanBusy ? 'Đang đọc thông tin trên ảnh…' : pending ? 'Cập nhật hồ sơ xác thực' : 'Gửi hồ sơ xác thực'}
          icon="shield-checkmark-outline"
          loading={busy}
          disabled={Boolean(imageBusy) || scanBusy}
          onPress={submit}
        />
        {busy ? (
          <Text style={{ fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 6 }}>
            Hệ thống đang đối chiếu OCR ảnh giấy tờ, quá trình này có thể mất 10–30 giây…
          </Text>
        ) : null}
      </Card>

      <Pressable onPress={() => navigation.goBack()} style={{ alignItems: 'center', marginTop: 14 }}>
        <Text style={{ fontSize: 12, color: colors.muted }}>← Quay lại</Text>
      </Pressable>
    </Screen>
  );
}
