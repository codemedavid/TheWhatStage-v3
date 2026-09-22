// WhatStage mobile design tokens. Mirrors DESIGN.md: light-first, warm
// off-white ground, emerald as the single interactive accent, zinc text scale.

export const colors = {
  page: '#F9FAFB',
  card: '#FFFFFF',
  elevated: '#FFFFFF',
  border: '#E5E7EB',
  borderSubtle: '#F3F4F6',
  borderStrong: '#D1D5DB',

  ink: '#111827',
  body: '#374151',
  tertiary: '#6B7280',
  muted: '#9CA3AF',
  faint: '#D1D5DB',

  accent: '#059669',
  accentDeep: '#047857',
  accentLight: '#D1FAE5',
  accentSubtle: 'rgba(5, 150, 105, 0.08)',
  accentGlow: '#34D399',

  // Chat bubbles
  bubbleOut: '#059669',
  bubbleOutText: '#FFFFFF',
  bubbleIn: '#F3F4F6',
  bubbleInText: '#111827',
  bubbleBot: '#EEF2FF',
  bubbleBotText: '#1E1B4B',
  bubbleBotAccent: '#4F46E5',

  warning: '#D97706',
  warningLight: '#FEF3C7',
  danger: '#DC2626',
  dangerLight: '#FEE2E2',
  info: '#2563EB',
  infoLight: '#DBEAFE',
  success: '#059669',
  successLight: '#D1FAE5',

  overlay: 'rgba(17, 24, 39, 0.45)',
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 9999,
} as const

export const type = {
  display: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.6, color: colors.ink },
  title: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.3, color: colors.ink },
  heading: { fontSize: 17, fontWeight: '600' as const, color: colors.ink },
  body: { fontSize: 15, fontWeight: '400' as const, color: colors.body, lineHeight: 21 },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const, color: colors.ink },
  small: { fontSize: 13, fontWeight: '400' as const, color: colors.tertiary },
  caption: { fontSize: 11, fontWeight: '500' as const, color: colors.muted, letterSpacing: 0.2 },
  label: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: colors.tertiary,
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
  },
} as const

export const shadow = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  sheet: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
  },
  fab: {
    shadowColor: '#059669',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const

// Deterministic avatar tint for contacts without a picture. Kept muted so the
// emerald accent stays the only "interactive" colour on screen.
export const AVATAR_TINTS = [
  { bg: '#E0F2FE', fg: '#0369A1' },
  { bg: '#FCE7F3', fg: '#9D174D' },
  { bg: '#FEF3C7', fg: '#92400E' },
  { bg: '#EDE9FE', fg: '#5B21B6' },
  { bg: '#D1FAE5', fg: '#065F46' },
  { bg: '#FFE4E6', fg: '#9F1239' },
  { bg: '#E0E7FF', fg: '#3730A3' },
  { bg: '#F3F4F6', fg: '#374151' },
] as const

// Stage kind → tiny chromatic hint (dot colour). Status comes from typography
// and position; these dots are the only colour on a stage chip.
export const STAGE_KIND_COLORS: Record<string, string> = {
  entry: '#2563EB',
  qualifying: '#7C3AED',
  nurture: '#0891B2',
  decision: '#D97706',
  won: '#059669',
  lost: '#DC2626',
  dormant: '#9CA3AF',
  objection: '#EA580C',
  open: '#2563EB',
}
