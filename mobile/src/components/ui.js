import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../context/AppContext';
import { asArray, daysLeft, parseJson, percent, statusVi, vnd } from '../lib/format';
import { colors, radius, shadow, statusTone } from '../theme';

export function Screen({
  children,
  scroll = true,
  topInset = false,
  refreshing = false,
  onRefresh,
  contentStyle,
  style,
}) {
  const insets = useSafeAreaInsets();
  const paddingTop = topInset ? insets.top : 0;
  const body = scroll ? (
    <ScrollView
      style={[{ flex: 1, backgroundColor: colors.bg }, style]}
      contentContainerStyle={[
        { padding: 16, paddingTop: paddingTop + 16, paddingBottom: 40 },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, backgroundColor: colors.bg, paddingTop }, style]}>{children}</View>
  );
  return body;
}

export function Card({ children, style, onPress }) {
  const content = <View style={[styles.card, style]}>{children}</View>;
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.85 }}>
      {content}
    </Pressable>
  );
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 12 }} />;
}

export function Row({ children, style }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

export function SectionHeader({ title, subtitle, action }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  style,
  textStyle,
}) {
  const isDisabled = disabled || loading;
  const palette = {
    primary: { bg: colors.primary, fg: colors.white, border: colors.primary },
    ghost: { bg: colors.white, fg: colors.text, border: colors.border },
    soft: { bg: colors.primaryPale, fg: colors.primaryDark, border: colors.primarySoft },
    danger: { bg: colors.redSoft, fg: colors.red, border: '#fecaca' },
    dark: { bg: '#1e293b', fg: colors.white, border: '#1e293b' },
  }[variant] || { bg: colors.primary, fg: colors.white, border: colors.primary };

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border },
        isDisabled && { opacity: 0.55 },
        pressed && !isDisabled && { opacity: 0.85 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={17} color={palette.fg} style={{ marginRight: 6 }} /> : null}
          <Text style={[styles.buttonText, { color: palette.fg }, textStyle]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Input({
  label,
  error,
  hint,
  style,
  inputStyle,
  multiline = false,
  ...props
}) {
  return (
    <View style={[{ marginBottom: 12 }, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.soft}
        multiline={multiline}
        style={[
          styles.input,
          multiline && { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 },
          error && { borderColor: colors.red },
          inputStyle,
        ]}
        {...props}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {hint && !error ? <Text style={styles.hintText}>{hint}</Text> : null}
    </View>
  );
}

export function Badge({ label, tone = 'slate', style }) {
  const palette = {
    slate: { bg: colors.slateSoft, fg: '#475569' },
    emerald: { bg: colors.primarySoft, fg: colors.primaryDark },
    amber: { bg: colors.amberSoft, fg: colors.amber },
    red: { bg: colors.redSoft, fg: colors.red },
    blue: { bg: colors.blueSoft, fg: colors.blue },
    indigo: { bg: colors.indigoSoft, fg: colors.indigo },
  }[tone] || { bg: colors.slateSoft, fg: '#475569' };
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }, style]}>
      <Text style={[styles.badgeText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

export function StatusBadge({ status }) {
  const tone = statusTone[status] || statusTone.draft;
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.badgeText, { color: tone.fg }]}>{statusVi[status] || status}</Text>
    </View>
  );
}

export function Chip({ label, active, onPress, style }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: colors.primary, borderColor: colors.primary },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      <Text style={[styles.chipText, active && { color: colors.white }]}>{label}</Text>
    </Pressable>
  );
}

export function Avatar({ name, size = 44 }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.primarySoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: colors.primaryDark, fontWeight: '800', fontSize: size * 0.4 }}>
        {name?.charAt(0)?.toUpperCase() || '?'}
      </Text>
    </View>
  );
}

export function StatTile({ label, value, hint, tone = colors.text }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color: tone }]}>{value}</Text>
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </View>
  );
}

export function ProjectCover({ project, height = 140, style }) {
  const [broken, setBroken] = useState(false);
  const showImage = project?.cover_image_url && !broken;
  return (
    <View style={[{ height, borderRadius: radius.lg, overflow: 'hidden' }, style]}>
      {showImage ? (
        <Image
          source={{ uri: project.cover_image_url }}
          style={{ width: '100%', height: '100%' }}
          onError={() => setBroken(true)}
        />
      ) : (
        <LinearGradient
          colors={['#d1fae5', '#f0fdfa', '#fef3c7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontSize: height > 100 ? 56 : 32 }}>{project?.cover_emoji || '🌱'}</Text>
        </LinearGradient>
      )}
    </View>
  );
}

export function ProgressBar({ project, compact = false }) {
  const pct = percent(project);
  return (
    <View>
      <View style={[styles.progressTrack, { height: compact ? 6 : 9 }]}>
        <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, pct))}%` }]} />
      </View>
      <Row style={{ justifyContent: 'space-between', marginTop: 5 }}>
        <Text style={{ color: colors.primary, fontWeight: '800', fontSize: compact ? 11 : 13 }}>
          {pct}%
        </Text>
        <Text style={{ color: colors.muted, fontSize: compact ? 11 : 12 }}>
          {vnd(project?.current_amount)} / {vnd(project?.goal_amount)}
        </Text>
      </Row>
    </View>
  );
}

export function ProjectCard({ project, onPress, onFollow, followBusy = false }) {
  return (
    <Card style={{ marginBottom: 14 }} onPress={onPress}>
      <ProjectCover project={project} height={132} />
      <View style={{ padding: 14 }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <Badge label={project.category_name || 'Dự án'} tone="slate" />
          <Text style={{ fontSize: 11, color: colors.muted }}>{daysLeft(project.end_date)}</Text>
        </Row>
        <Text style={styles.projectTitle} numberOfLines={2}>
          {project.title}
        </Text>
        <Row style={{ flexWrap: 'wrap', marginTop: 8 }}>
          <StatusBadge status={project.status} />
          {Number(project.fraud_risk_score) < 30 ? (
            <Badge label="✓ Không có tín hiệu bất thường" tone="emerald" style={{ marginLeft: 6 }} />
          ) : null}
        </Row>
        <View style={{ marginTop: 10 }}>
          <ProgressBar project={project} />
        </View>
        <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
          <Text style={{ fontSize: 12, color: colors.muted }}>
            AI dự đoán:{' '}
            <Text style={{ color: colors.amber, fontWeight: '800' }}>
              {Math.round(Number(project.ai_success_score || 0))}%
            </Text>
          </Text>
          {onFollow ? (
            <Pressable onPress={onFollow} disabled={followBusy} hitSlop={8}>
              <Ionicons
                name={project.is_following ? 'star' : 'star-outline'}
                size={22}
                color={project.is_following ? '#f59e0b' : colors.soft}
              />
            </Pressable>
          ) : null}
        </Row>
      </View>
    </Card>
  );
}

export function Loading({ text = 'Đang tải dữ liệu…' }) {
  return (
    <View style={styles.centerBox}>
      <ActivityIndicator color={colors.primary} />
      <Text style={{ color: colors.muted, marginTop: 8 }}>{text}</Text>
    </View>
  );
}

export function EmptyState({ icon = '📭', title = 'Chưa có dữ liệu', children, action }) {
  return (
    <Card style={{ alignItems: 'center', padding: 26 }}>
      <Text style={{ fontSize: 38 }}>{icon}</Text>
      <Text style={{ fontWeight: '800', marginTop: 8, textAlign: 'center' }}>{title}</Text>
      {children ? (
        <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 5, lineHeight: 20 }}>
          {children}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: 12 }}>{action}</View> : null}
    </Card>
  );
}

export function ErrorState({ message = 'Có lỗi xảy ra.', onRetry }) {
  return (
    <Card style={{ alignItems: 'center', padding: 22 }}>
      <Text style={{ fontSize: 32 }}>⚠️</Text>
      <Text style={{ fontWeight: '800', color: colors.red, marginTop: 6 }}>
        Không tải được dữ liệu
      </Text>
      <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 4 }}>{message}</Text>
      {onRetry ? (
        <Button title="Thử lại" variant="ghost" onPress={onRetry} style={{ marginTop: 12 }} />
      ) : null}
    </Card>
  );
}

export function AIBox({ children, variant = 'info', title = '✨ AI HỖ TRỢ' }) {
  const palette = {
    info: { border: '#fbbf24', bg: '#fffbeb', fg: colors.amber },
    warn: { border: '#f87171', bg: '#fef2f2', fg: colors.red },
    success: { border: '#34d399', bg: '#ecfdf5', fg: colors.primaryDark },
  }[variant] || { border: '#fbbf24', bg: '#fffbeb', fg: colors.amber };
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.bg, borderLeftWidth: 4, borderLeftColor: palette.border, padding: 14 },
      ]}
    >
      <Text style={{ fontSize: 11, fontWeight: '900', color: palette.fg, marginBottom: 6 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function predictionLabel(score) {
  if (score >= 65) return 'Có khả năng thành công';
  if (score <= 35) return 'Rủi ro không đạt mục tiêu';
  return 'Kết quả chưa rõ ràng';
}

const METRIC_LABELS = {
  auc: 'AUC',
  accuracy: 'Accuracy',
  precision: 'Precision',
  recall: 'Recall',
  f1: 'F1',
  brier: 'Brier',
};

export function PredictionExplain({ prediction, fallbackScore = null, compact = false }) {
  if (!prediction && fallbackScore === null) return null;
  const rawScore = prediction?.score ?? prediction?.success_probability ?? fallbackScore;
  const score = Math.round(Number(rawScore ?? 0));
  const label = prediction?.label_text || predictionLabel(score);
  const confidence = Number(prediction?.confidence ?? 0);
  const modelVersion = prediction?.model?.version || prediction?.model_version || null;
  const metrics = parseJson(prediction?.model?.metrics ?? prediction?.model_metrics, {});
  const contributions = asArray(prediction?.contributions);
  const sorted = [...contributions].sort(
    (a, b) => Math.abs(Number(b.effect_pp || 0)) - Math.abs(Number(a.effect_pp || 0)),
  );
  const top = sorted.slice(0, compact ? 3 : 5);
  const maxAbs = Math.max(1, ...top.map((item) => Math.abs(Number(item.effect_pp || 0))));
  const variant = score >= 65 ? 'success' : score <= 35 ? 'warn' : 'info';
  const summary =
    prediction?.summary ||
    (score >= 65
      ? 'Mô hình nghiêng về khả năng thành công dựa trên các tín hiệu có sẵn trước khi chiến dịch chạy.'
      : score <= 35
        ? 'Mô hình đánh giá hồ sơ có rủi ro không đạt mục tiêu. Nên cải thiện các tín hiệu yếu trước khi công khai.'
        : 'Các tín hiệu đang trái chiều, mô hình chưa đủ chắc chắn về kết quả.');

  return (
    <AIBox variant={variant} title="MÔ HÌNH DỰ ĐOÁN THÀNH CÔNG">
      <Row style={{ flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 26, fontWeight: '900', color: colors.text }}>{score}%</Text>
        <Text style={{ fontWeight: '700', marginLeft: 8 }}>{label}</Text>
        {confidence > 0 ? (
          <Text style={{ fontSize: 11, color: colors.muted, marginLeft: 8 }}>
            Độ tin cậy {confidence}%
          </Text>
        ) : null}
      </Row>
      {modelVersion ? (
        <Badge label={modelVersion} tone="slate" style={{ marginTop: 6, alignSelf: 'flex-start' }} />
      ) : null}
      <Text style={{ color: '#334155', lineHeight: 20, marginTop: 6 }}>{summary}</Text>

      {top.length > 0 ? (
        <View style={{ marginTop: 10 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: '#475569', marginBottom: 6 }}>
            Tín hiệu đóng góp chính
          </Text>
          {top.map((item) => {
            const effect = Number(item.effect_pp || 0);
            const positive = effect >= 0;
            return (
              <View
                key={item.key}
                style={{ backgroundColor: 'rgba(255,255,255,0.75)', borderRadius: 10, padding: 8, marginBottom: 6 }}
              >
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', flex: 1 }}>{item.label}</Text>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: positive ? colors.primary : colors.red }}>
                    {positive ? '+' : ''}
                    {effect.toFixed(1)} điểm
                  </Text>
                </Row>
                <View style={[styles.progressTrack, { height: 5, marginTop: 5 }]}>
                  <View
                    style={{
                      height: '100%',
                      borderRadius: 99,
                      backgroundColor: positive ? colors.primary : '#f87171',
                      width: `${Math.max(4, (Math.abs(effect) / maxAbs) * 100)}%`,
                    }}
                  />
                </View>
                <Text style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>
                  {item.explanation ||
                    `Tín hiệu này ${positive ? 'làm tăng' : 'làm giảm'} ${Math.abs(effect).toFixed(1)} điểm.`}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {!compact && metrics.n ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
          {Object.entries(METRIC_LABELS).map(([key, text]) =>
            metrics[key] !== undefined && metrics[key] !== null ? (
              <View key={key} style={{ width: '25%', padding: 3 }}>
                <Text style={{ fontSize: 9, color: colors.soft, textTransform: 'uppercase' }}>{text}</Text>
                <Text style={{ fontSize: 12, fontWeight: '700' }}>{metrics[key]}</Text>
              </View>
            ) : null,
          )}
        </View>
      ) : null}
    </AIBox>
  );
}

export function RecommendationBreakdown({ item }) {
  const components = Array.isArray(item?.score_breakdown?.components)
    ? item.score_breakdown.components
    : [];
  const top = components
    .filter((c) => c.available && Number(c.contribution) > 0)
    .sort((a, b) => Number(b.contribution) - Number(a.contribution))
    .slice(0, 3);
  return (
    <View style={{ marginTop: 4 }}>
      {item?.reason ? (
        <Text style={{ fontSize: 11, color: colors.muted, lineHeight: 16 }}>{item.reason}</Text>
      ) : null}
      {top.length > 0 ? (
        <Row style={{ flexWrap: 'wrap', marginTop: 4 }}>
          {top.map((c) => (
            <Badge
              key={c.key}
              label={`${c.label} +${Math.round(Number(c.contribution) * 100)}%`}
              tone="slate"
              style={{ marginRight: 4, marginBottom: 4 }}
            />
          ))}
        </Row>
      ) : null}
    </View>
  );
}

const SEVERITY_TONE = {
  critical: 'red',
  high: 'red',
  medium: 'amber',
  low: 'slate',
};

export function FraudRiskCard({ flags = [], riskScore = null, threshold = 60, title = 'Kiểm chứng gian lận' }) {
  const list = asArray(flags);
  const score =
    riskScore !== null && riskScore !== undefined
      ? Math.round(Number(riskScore))
      : list.length
        ? Math.round(Number(list[0].risk_score || 0))
        : 0;
  const level = score >= 80 ? 'critical' : score >= threshold ? 'high' : score >= 35 ? 'medium' : 'low';
  return (
    <Card style={{ padding: 16 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '800' }}>{title}</Text>
        <Badge label={`Rủi ro ${score}%`} tone={SEVERITY_TONE[level] || 'slate'} />
      </Row>
      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4, lineHeight: 16 }}>
        Hệ thống chấm điểm từ các tín hiệu độc lập; cảnh báo được tạo khi điểm đạt ngưỡng {threshold}%.
      </Text>
      {list.length === 0 ? (
        <View style={{ backgroundColor: colors.primaryPale, padding: 10, borderRadius: 10, marginTop: 8 }}>
          <Text style={{ fontSize: 12, color: colors.primaryDark }}>
            Chưa có cảnh báo vượt ngưỡng. Điểm rủi ro hiện tại {score}% — vẫn được theo dõi khi có giao dịch mới.
          </Text>
        </View>
      ) : (
        list.map((flag) => {
          const evidence = parseJson(flag.evidence, {});
          const signals = Array.isArray(evidence?.signals) ? evidence.signals : [];
          return (
            <View
              key={flag.id || `${flag.entity_id}-${flag.flagged_at}`}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, marginTop: 8 }}
            >
              <Row style={{ flexWrap: 'wrap' }}>
                <Badge label={`Rủi ro ${Math.round(Number(flag.risk_score ?? score))}%`} tone="red" />
                <Text style={{ fontSize: 11, color: colors.muted, marginLeft: 6 }}>
                  {flag.review_status === 'pending'
                    ? 'Chờ xử lý'
                    : flag.review_status === 'confirmed'
                      ? 'Đã xác nhận'
                      : 'Báo nhầm'}
                </Text>
              </Row>
              <Text style={{ fontSize: 12, color: '#334155', marginTop: 5 }}>
                {flag.reason || evidence.summary}
              </Text>
              {signals.map((signal) => (
                <View
                  key={`${signal.code}-${signal.points}`}
                  style={{ backgroundColor: colors.slateSoft, borderRadius: 8, padding: 8, marginTop: 6 }}
                >
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', flex: 1 }}>{signal.label}</Text>
                    <Text style={{ fontSize: 11, fontWeight: '800' }}>
                      {signal.points > 0 ? '+' : ''}
                      {signal.points} điểm
                    </Text>
                  </Row>
                  <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>{signal.evidence}</Text>
                </View>
              ))}
            </View>
          );
        })
      )}
    </Card>
  );
}

export function ModalSheet({ open, title, onClose, children, footer }) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.modalSheet}>
          <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ fontSize: 17, fontWeight: '800', flex: 1 }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.muted} />
            </Pressable>
          </Row>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
          {footer ? <View style={{ marginTop: 12 }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

const TOAST_TONE = {
  info: { bg: '#ffffff', border: colors.primarySoft, fg: colors.text },
  success: { bg: colors.primaryPale, border: '#6ee7b7', fg: colors.primaryDark },
  error: { bg: colors.redSoft, border: '#fca5a5', fg: '#991b1b' },
  warning: { bg: colors.amberSoft, border: '#fcd34d', fg: '#92400e' },
};

export function ToastHost() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;
  return (
    <View pointerEvents="box-none" style={styles.toastHost}>
      {toasts.map((t) => {
        const tone = TOAST_TONE[t.type] || TOAST_TONE.info;
        return (
          <Pressable
            key={t.id}
            onPress={() => dismissToast(t.id)}
            style={[styles.toast, { backgroundColor: tone.bg, borderColor: tone.border }]}
          >
            <Text style={{ color: tone.fg, flex: 1, fontSize: 13, lineHeight: 19 }}>{t.message}</Text>
            <Ionicons name="close" size={16} color={tone.fg} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Alert trên native, window.confirm trên web để nút xác nhận hoạt động đúng. */
export function confirmAction(title, message, onConfirm) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Hủy', style: 'cancel' },
    { text: 'Đồng ý', style: 'destructive', onPress: onConfirm },
  ]);
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  button: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 14, fontWeight: '800' },
  label: { fontSize: 12, fontWeight: '700', color: '#334155', marginBottom: 6 },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: colors.text,
  },
  errorText: { color: colors.red, fontSize: 11, marginTop: 4 },
  hintText: { color: colors.muted, fontSize: 11, marginTop: 4 },
  badge: {
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 10, fontWeight: '800' },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    borderRadius: 99,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 6,
    marginBottom: 6,
  },
  chipText: { fontSize: 12, color: '#475569', fontWeight: '600' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 4,
  },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  sectionSubtitle: { fontSize: 12, color: colors.muted, marginTop: 2 },
  statTile: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  statLabel: { fontSize: 11, color: colors.muted },
  statValue: { fontSize: 19, fontWeight: '900', marginTop: 3 },
  statHint: { fontSize: 10, color: colors.soft, marginTop: 2 },
  progressTrack: { backgroundColor: '#e2e8f0', borderRadius: 99, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 99 },
  projectTitle: { fontSize: 15, fontWeight: '800', color: colors.text, lineHeight: 21 },
  centerBox: { alignItems: 'center', justifyContent: 'center', padding: 28 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    maxHeight: '86%',
  },
  toastHost: { position: 'absolute', left: 12, right: 12, bottom: 78 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    ...shadow,
  },
});
