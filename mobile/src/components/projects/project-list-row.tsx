import { Ionicons } from '@expo/vector-icons'
import { memo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { StageChip } from '@/components/ui/primitives'
import { one, type ProjectRow, type ProjectStage } from '@/data/types'
import { money } from '@/lib/format'
import { colors, spacing, type } from '@/theme/tokens'

interface Props {
  project: ProjectRow
  stage: ProjectStage | undefined
  /** Takes the project so the list can pass one stable handler per row. */
  onPress: (project: ProjectRow) => void
}

function ProjectListRowInner({ project, stage, onPress }: Props) {
  const lead = one(project.leads)
  const value = money(project.value, project.currency)
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress(project)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.borderSubtle }]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={type.bodyStrong} numberOfLines={1}>
          {project.title}
        </Text>
        <Text style={type.small} numberOfLines={1}>
          {lead?.name ?? 'No lead'}
        </Text>
        {stage && <StageChip name={stage.name} kind={stage.kind} color={stage.color} />}
      </View>
      <View style={styles.right}>
        {value ? <Text style={[type.small, { color: colors.ink, fontWeight: '600' }]}>{value}</Text> : null}
        <Ionicons name="chevron-forward" size={16} color={colors.muted} />
      </View>
    </Pressable>
  )
}

export const ProjectListRow = memo(ProjectListRowInner)

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6 },
})
