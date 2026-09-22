import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { useRouter } from 'expo-router'
import { memo, useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { BoardView, type BoardColumn } from '@/components/board/board-view'
import { DateFilterBar } from '@/components/board/date-filter'
import { Avatar } from '@/components/ui/avatar'
import { Badge, EmptyState, Skeleton } from '@/components/ui/primitives'
import { StagePickerSheet } from '@/components/ui/stage-picker-sheet'
import { useLeadBoard, useMoveLead, useStages } from '@/data/leads'
import { one, type LeadRow } from '@/data/types'
import { DEFAULT_DATE_FILTER, inRange, resolveRange, type DateBasis, type DateFilter } from '@/lib/date-range'
import { money, relativeTime } from '@/lib/format'
import { colors, radius, shadow, spacing, type } from '@/theme/tokens'

const leadKey = (lead: LeadRow) => lead.id

const BASIS_FIELD: Record<DateBasis, keyof Pick<LeadRow, 'last_activity_at' | 'created_at' | 'entered_stage_at'>> = {
  activity: 'last_activity_at',
  created: 'created_at',
  stage: 'entered_stage_at',
}

interface LeadCardProps {
  lead: LeadRow
  /** Takes the lead so the parent can pass one stable handler for every card. */
  onPress: (lead: LeadRow) => void
  onMove: (lead: LeadRow) => void
}

function LeadCardInner({ lead, onPress, onMove }: LeadCardProps) {
  const thread = one(lead.messenger_threads)
  const unread = thread?.unread_count ?? 0
  const value = lead.estimated_value != null && lead.estimated_value !== '' ? money(lead.estimated_value) : ''
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Lead ${lead.name}`}
      onPress={() => onPress(lead)}
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
        onMove(lead)
      }}
      delayLongPress={280}
      style={({ pressed }) => [styles.card, shadow.card, pressed && { opacity: 0.9 }]}
    >
      <View style={styles.cardRow}>
        <Avatar name={lead.name} uri={thread?.picture_url} size={38} dot={unread > 0} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.bodyStrong} numberOfLines={1}>
            {lead.name}
          </Text>
          <Text style={type.small} numberOfLines={1}>
            {lead.company || `Active ${relativeTime(lead.last_activity_at)}`}
          </Text>
        </View>
        <Badge count={unread} />
      </View>
      {value ? (
        <View style={styles.cardFoot}>
          <Ionicons name="cash-outline" size={13} color={colors.tertiary} />
          <Text style={styles.value}>{value}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

const LeadCard = memo(LeadCardInner)

export function LeadBoard() {
  const router = useRouter()
  const stages = useStages()
  const board = useLeadBoard()
  const move = useMoveLead()
  const [moving, setMoving] = useState<LeadRow | null>(null)
  const [dateFilter, setDateFilter] = useState<DateFilter>(DEFAULT_DATE_FILTER)

  const refetchBoard = board.refetch
  const refreshBoard = useCallback(() => {
    refetchBoard()
  }, [refetchBoard])
  const openLead = useCallback((lead: LeadRow) => router.push(`/lead/${lead.id}`), [router])
  const startMove = useCallback((lead: LeadRow) => setMoving(lead), [])
  const renderCard = useCallback(
    (lead: LeadRow) => <LeadCard lead={lead} onPress={openLead} onMove={startMove} />,
    [openLead, startMove],
  )

  const columns = useMemo<BoardColumn<LeadRow>[]>(() => {
    const range = resolveRange(dateFilter)
    const field = BASIS_FIELD[dateFilter.basis]
    const leads = (board.data ?? []).filter((l) => inRange(l[field], range))
    return (stages.data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      items: leads.filter((l) => l.stage_id === s.id),
    }))
  }, [stages.data, board.data, dateFilter])

  if (stages.isLoading || board.isLoading) {
    return (
      <View style={{ padding: spacing.lg, gap: 10 }}>
        <Skeleton height={34} width="60%" round />
        <Skeleton height={320} />
      </View>
    )
  }
  if (stages.isError || board.isError) {
    return <EmptyState icon="cloud-offline-outline" title="Couldn't load the board" body="Pull to refresh or check your connection." />
  }
  if (columns.length === 0) {
    return <EmptyState icon="albums-outline" title="No stages yet" body="Create pipeline stages in the dashboard to see your board here." />
  }

  const isFiltered = dateFilter.preset !== 'all'

  return (
    <>
      <DateFilterBar value={dateFilter} onChange={setDateFilter} />
      <BoardView
        columns={columns}
        keyExtractor={leadKey}
        emptyLabel={isFiltered ? 'No leads in this range' : 'No leads in this stage'}
        refreshing={board.isRefetching}
        onRefresh={refreshBoard}
        renderCard={renderCard}
      />
      <StagePickerSheet
        visible={!!moving}
        onClose={() => setMoving(null)}
        stages={columns.map((c) => ({ id: c.id, name: c.name, kind: c.kind, count: c.items.length }))}
        currentId={moving?.stage_id}
        onPick={(toStageId) => {
          if (moving) move.mutate({ leadId: moving.id, toStageId })
        }}
      />
    </>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 48 },
  value: { fontSize: 12, fontWeight: '600', color: colors.body },
})
