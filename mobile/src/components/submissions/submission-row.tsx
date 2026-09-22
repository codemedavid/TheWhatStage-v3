import { Ionicons } from '@expo/vector-icons'
import { memo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Avatar } from '@/components/ui/avatar'
import { one, type SubmissionRow as Row } from '@/data/types'
import { relativeTime } from '@/lib/format'
import { isImplied, outcomeLabel } from '@/lib/submission-data'
import { colors, radius, spacing, type } from '@/theme/tokens'

/** Name to show for a submission — anonymous web fills have no lead. */
export function submissionName(row: Row): string {
  return one(row.leads)?.name?.trim() || (row.lead_id ? 'Unknown lead' : 'Anonymous')
}

export function submissionPageTitle(row: Row): string {
  return one(row.action_pages)?.title ?? 'Action page'
}

interface Props {
  row: Row
  onPress: (row: Row) => void
  /** Hide the page title when the list is already scoped to one page. */
  hidePage?: boolean
}

function SubmissionRowInner({ row, onPress, hidePage }: Props) {
  const name = submissionName(row)
  const implied = isImplied(row.outcome)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${outcomeLabel(row.outcome)}`}
      onPress={() => onPress(row)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.accentSubtle }]}
    >
      <Avatar name={name} size={40} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.head}>
          <Text style={[type.bodyStrong, { flexShrink: 1 }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.time}>{relativeTime(row.created_at)}</Text>
        </View>
        <View style={styles.meta}>
          <OutcomeTag outcome={row.outcome} />
          {!hidePage && (
            <Text style={type.small} numberOfLines={1}>
              {submissionPageTitle(row)}
            </Text>
          )}
        </View>
      </View>
      <Ionicons
        name={implied ? 'chatbubble-ellipses-outline' : 'chevron-forward'}
        size={16}
        color={colors.muted}
      />
    </Pressable>
  )
}

/** Filled-in rows read as a win; chat-implied rows are clearly marked apart. */
export function OutcomeTag({ outcome }: { outcome: string | null }) {
  const implied = isImplied(outcome)
  return (
    <View style={[styles.tag, implied ? styles.tagImplied : styles.tagFilled]}>
      <Text style={[styles.tagText, { color: implied ? colors.warning : colors.accentDeep }]}>
        {outcomeLabel(outcome)}
      </Text>
    </View>
  )
}

export const SubmissionListRow = memo(SubmissionRowInner, (a, b) => a.row === b.row && a.hidePage === b.hidePage)

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.card,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  time: { ...type.caption, marginLeft: 'auto' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  tagFilled: { backgroundColor: colors.accentLight },
  tagImplied: { backgroundColor: colors.warningLight },
  tagText: { fontSize: 11, fontWeight: '700' },
})
