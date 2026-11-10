import { Platform } from 'react-native';

export const colors = {
  bg: '#f8fafc',
  card: '#ffffff',
  text: '#0f172a',
  muted: '#64748b',
  soft: '#94a3b8',
  border: '#e2e8f0',
  primary: '#047857',
  primaryDark: '#065f46',
  primarySoft: '#d1fae5',
  primaryPale: '#ecfdf5',
  amber: '#b45309',
  amberSoft: '#fef3c7',
  red: '#dc2626',
  redSoft: '#fee2e2',
  blue: '#1d4ed8',
  blueSoft: '#dbeafe',
  indigo: '#4338ca',
  indigoSoft: '#e0e7ff',
  slateSoft: '#f1f5f9',
  white: '#ffffff',
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
};

export const shadow = Platform.select({
  ios: {
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  android: { elevation: 2 },
  default: { boxShadow: '0 4px 12px rgba(15,23,42,0.08)' },
});

export const statusTone = {
  draft: { bg: '#e2e8f0', fg: '#475569' },
  pending_review: { bg: colors.amberSoft, fg: colors.amber },
  active: { bg: colors.primarySoft, fg: colors.primaryDark },
  successful: { bg: colors.blueSoft, fg: colors.blue },
  failed: { bg: colors.redSoft, fg: colors.red },
  canceled: { bg: '#e2e8f0', fg: '#475569' },
};
