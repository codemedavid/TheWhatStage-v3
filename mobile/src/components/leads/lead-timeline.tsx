import { StyleSheet, Text, View } from 'react-native'
import { Card, SectionLabel } from '@/components/ui/primitives'
import type { LeadStageEvent, PipelineStage } from '@/data/types'
import { relativeTime } from '@/lib/format'
import { colors, spacing, STAGE_KIND_COLORS, type } from '@/theme/tokens'

interface Props {
  events: LeadStageEvent[]
  stages: PipelineStage[]
}

export function LeadTimeline({ events, stages }: Props) {
  const byId = new Map(stages.map((s) => [s.id, s]))
  const nameOf = (id: string | null) => (id ? byId.get(id)?.name ?? 'Unknown stage' : null)

  return (
    <View>
      <SectionLabel>Stage history</SectionLabel>
      <Card style={{ paddingVertical: spacing.sm }}>
        {events.length === 0 ? (
          <Text style={[type.small, { paddingVertical: spacing.sm }]}>No stage changes yet</Text>
        ) : (
          events.map((e, i) => {
            const to = byId.get(e.to_stage_id)
            const from = nameOf(e.from_stage_id)
            const dot = STAGE_KIND_COLORS[to?.kind ?? ''] ?? colors.muted
            return (
              <View key={e.id} style={[styles.item, i === events.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={[styles.dot, { backgroundColor: dot }]} />
                <View style={{ flex: 1 }}>
                  <Text style={type.body}>
                    <Text style={{ fontWeight: '600', color: colors.ink }}>Moved to {to?.name ?? 'Unknown stage'}</Text>
                    {from ? ` from ${from}` : ''}
                  </Text>
                  <Text style={[type.caption, { marginTop: 2 }]}>
                    {e.source.replace(/[_-]/g, ' ')} · {relativeTime(e.created_at)}
                    {e.reason ? ` · ${e.reason}` : ''}
                  </Text>
                </View>
              </View>
            )
          })
        )}
      </Card>
    </View>
  )
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  dot: { width: 9, height: 9, borderRadius: 5, marginTop: 6 },
})
