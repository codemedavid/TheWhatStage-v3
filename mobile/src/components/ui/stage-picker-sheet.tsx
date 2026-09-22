import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Sheet } from './sheet'
import { colors, radius, spacing, STAGE_KIND_COLORS, type } from '@/theme/tokens'

export interface PickableStage {
  id: string
  name: string
  kind?: string | null
  color?: string | null
  count?: number
}

interface Props {
  visible: boolean
  onClose: () => void
  stages: PickableStage[]
  currentId: string | null | undefined
  onPick: (stageId: string) => void
  title?: string
}

/** Shared "Move to stage" sheet for leads and projects. */
export function StagePickerSheet({ visible, onClose, stages, currentId, onPick, title = 'Move to stage' }: Props) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle="Tap a stage to move">
      <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 6, paddingBottom: spacing.sm }}>
        {stages.map((s) => {
          const active = s.id === currentId
          const dot = s.color ?? STAGE_KIND_COLORS[s.kind ?? ''] ?? colors.muted
          return (
            <Pressable
              key={s.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => {
                if (active) return onClose()
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
                onPick(s.id)
                onClose()
              }}
              style={({ pressed }) => [styles.row, active && styles.rowActive, pressed && { opacity: 0.85 }]}
            >
              <View style={[styles.dot, { backgroundColor: dot }]} />
              <Text style={[type.bodyStrong, { flex: 1 }]} numberOfLines={1}>
                {s.name}
              </Text>
              {typeof s.count === 'number' && <Text style={type.small}>{s.count}</Text>}
              {active && <Ionicons name="checkmark-circle" size={20} color={colors.accent} />}
            </Pressable>
          )
        })}
      </ScrollView>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  rowActive: { backgroundColor: colors.accentSubtle, borderColor: colors.accentLight },
  dot: { width: 10, height: 10, borderRadius: 5 },
})
