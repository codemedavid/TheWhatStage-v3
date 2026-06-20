import type { ProjectStageRow } from '@/lib/projects/types'
import type { ProjectCardRow } from './queries'

export type StageBreakdown = {
  stageId: string
  name: string
  count: number
  subtotal: number
}

export type ProjectStats = {
  total: number
  open: number
  won: number
  lost: number
  /** Sum of `value` for open projects (null/`open` kind). */
  openValue: number
  /** Sum of `value` for won projects. */
  wonValue: number
  currency: string
  unread: number
  missed: number
  perStage: StageBreakdown[]
}

/**
 * Aggregate board-level statistics from the set of project cards currently in
 * view. Pure and order-independent so the same numbers can be asserted in tests
 * and reflect whatever filter the board applied. A null `stage_kind` counts as
 * open, matching how default stages are seeded.
 */
export function computeProjectStats(
  rows: ProjectCardRow[],
  stages: ProjectStageRow[],
): ProjectStats {
  const counts = new Map<string, { count: number; subtotal: number }>()
  for (const stage of stages) counts.set(stage.id, { count: 0, subtotal: 0 })

  let open = 0
  let won = 0
  let lost = 0
  let openValue = 0
  let wonValue = 0
  let unread = 0
  let missed = 0

  for (const row of rows) {
    const value = row.value ?? 0
    if (row.stage_kind === 'won') {
      won += 1
      wonValue += value
    } else if (row.stage_kind === 'lost') {
      lost += 1
    } else {
      open += 1
      openValue += value
    }
    unread += row.unread_count
    missed += row.missed_count

    const bucket = counts.get(row.stage_id)
    if (bucket) {
      bucket.count += 1
      bucket.subtotal += value
    }
  }

  return {
    total: rows.length,
    open,
    won,
    lost,
    openValue,
    wonValue,
    currency: rows[0]?.currency ?? 'PHP',
    unread,
    missed,
    perStage: stages.map((stage) => {
      const bucket = counts.get(stage.id) ?? { count: 0, subtotal: 0 }
      return { stageId: stage.id, name: stage.name, count: bucket.count, subtotal: bucket.subtotal }
    }),
  }
}
