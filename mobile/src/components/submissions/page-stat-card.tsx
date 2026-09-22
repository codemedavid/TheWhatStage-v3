import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { ActionPageStat } from '@/data/types'
import { relativeTime } from '@/lib/format'
import { colors, radius, spacing, type } from '@/theme/tokens'

/** Shared page-kind iconography — also used by the chat action-page picker. */
export const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  form: 'document-text-outline',
  booking: 'calendar-outline',
  qualification: 'help-circle-outline',
  sales: 'cart-outline',
  catalog: 'cart-outline',
  realestate: 'home-outline',
}

interface Props {
  stat: ActionPageStat
  selected?: boolean
  onPress: () => void
}

/** One action page's fill rollup for the selected range. */
export function PageStatCard({ stat, selected, onPress }: Props) {
  const filled = Number(stat.filled)
  const implied = Number(stat.submissions) - filled
  const people = Number(stat.people)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${stat.title}, ${filled} filled in`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, selected && styles.cardSelected, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.head}>
        <View style={styles.icon}>
          <Ionicons name={KIND_ICON[stat.kind] ?? 'link-outline'} size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.bodyStrong} numberOfLines={1}>
            {stat.title}
          </Text>
          <Text style={type.caption}>
            {stat.status === 'published' ? 'Published' : stat.status === 'draft' ? 'Draft' : 'Archived'}
            {stat.last_at ? ` · last fill ${relativeTime(stat.last_at)}` : ' · no fills yet'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.muted} />
      </View>

      <View style={styles.stats}>
        <Stat value={filled} label="filled in" strong />
        <Stat value={people} label="people" />
        <Stat value={implied} label="chat-implied" />
      </View>
    </Pressable>
  )
}

function Stat({ value, label, strong }: { value: number; label: string; strong?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, strong && { color: colors.accentDeep }]}>{value}</Text>
      <Text style={type.caption}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardSelected: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stats: { flexDirection: 'row', gap: spacing.xl },
  stat: { gap: 1 },
  statValue: { fontSize: 18, fontWeight: '700', color: colors.ink },
})
