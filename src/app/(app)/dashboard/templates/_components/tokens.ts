// Shared design tokens for the Templates screen + its sub-components, so the
// palette stops being copy-pasted. Matches the rest of the dashboard's
// editorial/serif aesthetic.
export const S = {
  serif: 'var(--font-instrument-serif)',
  mono: 'var(--font-geist-mono)',
  ink: '#1A1915',
  ink2: '#3F3D36',
  ink3: '#6B6960',
  ink4: '#9C9A90',
  border: '#E8E6DE',
  accent: '#1F7A4D',
  accentInk: '#0F4A30',
  accentSoft: '#F2F8F4',
  surface: '#FFFFFF',
  surface2: '#F6F5F1',
  danger: '#B91C1C',
  dangerSoft: '#FEF2F2',
  warn: '#92400E',
  warnSoft: '#FFFBEB',
} as const

export const inputStyle: React.CSSProperties = {
  border: `1px solid ${S.border}`,
  background: S.surface,
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 13,
  color: S.ink,
  outline: 'none',
  width: '100%',
}

export const btnPrimary: React.CSSProperties = {
  background: S.accent,
  color: '#fff',
  border: `1px solid ${S.accent}`,
  padding: '8px 16px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
}

export const btnSecondary: React.CSSProperties = {
  background: S.surface,
  color: S.ink2,
  border: `1px solid ${S.border}`,
  padding: '8px 14px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
}
