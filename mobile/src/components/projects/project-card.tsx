import * as Haptics from 'expo-haptics'
import { memo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/primitives'
import { one, type ProjectRow } from '@/data/types'
import { money, relativeTime } from '@/lib/format'
import { colors, radius, spacing, type } from '@/theme/tokens'

interface Props {
  project: ProjectRow
  /** Takes the project so the board can pass one stable handler per card. */
  onPress: (project: ProjectRow) => void
  onLongPress: (project: ProjectRow) => void
}

function ProjectCardInner({ project, onPress, onLongPress }: Props) {
  const lead = one(project.leads)
  const thread = one(lead?.messenger_threads)
  const unread = (thread?.unread_count ?? 0) + (thread?.missed_count ?? 0)
  const value = money(project.value, project.currency)

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress(project)}
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
        onLongPress(project)
      }}
      delayLongPress={300}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
    >
      <Text style={type.bodyStrong} numberOfLines={2}>
        {project.title}
      </Text>
      {lead && (
        <View style={styles.leadRow}>
          <Avatar name={lead.name} uri={thread?.picture_url} size={24} />
          <Text style={[type.small, { flex: 1 }]} numberOfLines={1}>
            {lead.name}
          </Text>
          <Badge count={unread} />
        </View>
      )}
      <View style={styles.footer}>
        <Text style={[type.small, { color: value ? colors.ink : colors.muted, fontWeight: '600' }]}>
          {value || 'No value'}
        </Text>
        <Text style={type.caption}>{relativeTime(project.updated_at)}</Text>
      </View>
    </Pressable>
  )
}

export const ProjectCard = memo(ProjectCardInner)

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 8,
  },
  leadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
})
