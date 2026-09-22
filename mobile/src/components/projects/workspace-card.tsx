import { Ionicons } from '@expo/vector-icons'
import { memo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Workspace } from '@/data/types'
import { money } from '@/lib/format'
import { colors, radius, shadow, spacing, type } from '@/theme/tokens'

export interface WorkspaceStats {
  active: number
  totalValue: number
}

interface Props {
  workspace: Workspace
  stats: WorkspaceStats
  /** Takes the workspace so the list can pass one stable handler per card. */
  onPress: (workspace: Workspace) => void
}

function WorkspaceCardInner({ workspace, stats, onPress }: Props) {
  const swatch = workspace.color ?? colors.accent
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress(workspace)}
      style={({ pressed }) => [styles.card, shadow.card, pressed && { opacity: 0.9 }]}
    >
      <View style={[styles.swatch, { backgroundColor: swatch }]} />
      <View style={{ flex: 1 }}>
        <View style={styles.titleRow}>
          <Text style={[type.heading, { flexShrink: 1 }]} numberOfLines={1}>
            {workspace.name}
          </Text>
          {workspace.is_default && <Text style={type.caption}>Default</Text>}
        </View>
        {workspace.description ? (
          <Text style={[type.small, { marginTop: 2 }]} numberOfLines={2}>
            {workspace.description}
          </Text>
        ) : null}
        <View style={styles.statsRow}>
          <Text style={type.small}>
            {stats.active} {stats.active === 1 ? 'project' : 'projects'}
          </Text>
          {stats.totalValue > 0 && (
            <>
              <Text style={[type.small, { color: colors.faint }]}>·</Text>
              <Text style={[type.small, { color: colors.ink, fontWeight: '600' }]}>
                {money(stats.totalValue)}
              </Text>
            </>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  )
}

export const WorkspaceCard = memo(WorkspaceCardInner)

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  swatch: { width: 6, alignSelf: 'stretch', borderRadius: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'space-between' },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
})
