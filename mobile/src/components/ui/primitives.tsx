import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { colors, radius, spacing, STAGE_KIND_COLORS, type } from '@/theme/tokens'

/** Tiny kind-tinted dot + name. The only colour a stage gets. */
export function StageChip({
  name,
  kind,
  color,
  onPress,
  style,
}: {
  name: string
  kind?: string | null
  color?: string | null
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}) {
  const dot = color ?? STAGE_KIND_COLORS[kind ?? ''] ?? colors.muted
  const body = (
    <View style={[styles.chip, style]}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={styles.chipText} numberOfLines={1}>
        {name}
      </Text>
      {onPress && <Ionicons name="chevron-down" size={12} color={colors.muted} />}
    </View>
  )
  if (!onPress) return body
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={6}>
      {body}
    </Pressable>
  )
}

export function Badge({ count, tone = 'accent' }: { count: number; tone?: 'accent' | 'muted' | 'warning' }) {
  if (count <= 0) return null
  const bg = { accent: colors.accent, muted: colors.faint, warning: colors.warning }[tone]
  const fg = tone === 'muted' ? colors.ink : '#fff'
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 11, fontWeight: '700' }}>{count > 99 ? '99+' : count}</Text>
    </View>
  )
}

export function Pill({
  label,
  active,
  onPress,
  icon,
}: {
  label: string
  active?: boolean
  onPress?: () => void
  icon?: React.ReactNode
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={[styles.pill, active && styles.pillActive]}
    >
      {icon}
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </Pressable>
  )
}

export function EmptyState({
  icon = 'chatbubbles-outline',
  title,
  body,
  action,
}: {
  icon?: keyof typeof Ionicons.glyphMap
  title: string
  body?: string
  action?: React.ReactNode
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.accent} />
      </View>
      <Text style={[type.heading, { textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[type.small, { textAlign: 'center', marginTop: 4, maxWidth: 280 }]}>{body}</Text> : null}
      {action ? <View style={{ marginTop: spacing.lg }}>{action}</View> : null}
    </View>
  )
}

export function Skeleton({ width = '100%', height = 14, round = false, style }: {
  width?: number | `${number}%`
  height?: number
  round?: boolean
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View
      style={[
        { width, height, borderRadius: round ? 999 : 6, backgroundColor: colors.borderSubtle },
        style,
      ]}
    />
  )
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>
}

export function Row({
  icon,
  label,
  value,
  onPress,
  right,
}: {
  icon?: keyof typeof Ionicons.glyphMap
  label: string
  value?: string | null
  onPress?: () => void
  right?: React.ReactNode
}) {
  const inner = (
    <View style={styles.row}>
      {icon && <Ionicons name={icon} size={18} color={colors.tertiary} style={{ width: 24 }} />}
      <View style={{ flex: 1 }}>
        <Text style={type.caption}>{label}</Text>
        <Text style={[type.body, { color: value ? colors.ink : colors.muted }]} numberOfLines={2}>
          {value || '—'}
        </Text>
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={colors.muted} /> : null)}
    </View>
  )
  return onPress ? <Pressable onPress={onPress}>{inner}</Pressable> : inner
}

export function SectionLabel({ children, right }: { children: string; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={type.label}>{children}</Text>
      {right}
    </View>
  )
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'flex-start',
    maxWidth: 200,
  },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.body, flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  pillText: { fontSize: 13, fontWeight: '600', color: colors.body },
  pillTextActive: { color: '#fff' },
  empty: { alignItems: 'center', paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
  },
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
})
