import { Ionicons } from '@expo/vector-icons'
import { memo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/primitives'
import { one, type ThreadRow as ThreadRowData } from '@/data/types'
import { relativeTime, truncate } from '@/lib/format'
import { colors, spacing } from '@/theme/tokens'

interface Props {
  thread: ThreadRowData
  /** Takes the thread so the list can pass one stable handler for every row. */
  onPress: (thread: ThreadRowData) => void
  onLongPress: (thread: ThreadRowData) => void
}

export function threadDisplayName(thread: ThreadRowData): string {
  return one(thread.leads)?.name || thread.full_name || 'Unknown contact'
}

export function isTakenOver(thread: Pick<ThreadRowData, 'bot_paused_until'>, now = Date.now()): boolean {
  return !!thread.bot_paused_until && new Date(thread.bot_paused_until).getTime() > now
}

function ThreadRowInner({ thread, onPress, onLongPress }: Props) {
  const unread = thread.unread_count > 0
  const name = threadDisplayName(thread)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Chat with ${name}`}
      onPress={() => onPress(thread)}
      onLongPress={() => onLongPress(thread)}
      delayLongPress={300}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Avatar name={name} uri={thread.picture_url} size={52} ring={isTakenOver(thread)} dot={unread} />
      <View style={styles.middle}>
        <View style={styles.nameLine}>
          {thread.is_important && <Ionicons name="star" size={13} color={colors.warning} />}
          <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={2}>
          {truncate(thread.last_message_preview, 90) || 'No messages yet'}
        </Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.time, unread && { color: colors.accent }]}>{relativeTime(thread.last_message_at)}</Text>
        {unread ? (
          <Badge count={thread.unread_count} />
        ) : thread.missed_count > 0 ? (
          <View style={styles.missed}>
            <Text style={styles.missedText}>missed</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  )
}

export const ThreadRow = memo(ThreadRowInner)

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    backgroundColor: colors.page,
  },
  pressed: { backgroundColor: colors.borderSubtle },
  middle: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { fontSize: 16, fontWeight: '500', color: colors.ink, flexShrink: 1 },
  nameUnread: { fontWeight: '700' },
  preview: { fontSize: 14, color: colors.tertiary, lineHeight: 19 },
  previewUnread: { color: colors.ink, fontWeight: '500' },
  right: { alignItems: 'flex-end', gap: 6, minWidth: 40 },
  time: { fontSize: 12, color: colors.muted, fontWeight: '500' },
  missed: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.borderSubtle,
  },
  missedText: { fontSize: 10, fontWeight: '600', color: colors.tertiary },
})
