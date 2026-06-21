import { describe, it, expect } from 'vitest'
import { computeProjectStats } from './stats'
import type { ProjectCardRow } from './queries'
import type { ProjectStageRow } from '@/lib/projects/types'

function stage(id: string, name: string, kind: ProjectStageRow['kind']): ProjectStageRow {
  return { id, name, description: null, position: 0, is_default: false, kind, color: null }
}

function card(over: Partial<ProjectCardRow>): ProjectCardRow {
  return {
    id: 'p', user_id: 'u', lead_id: 'l', origin_submission_id: null,
    stage_id: 's-open', title: 't', description: null, value: null,
    currency: 'PHP', ai_instructions: null, notes: null, position: 0,
    archived_at: null, created_at: '2026-06-01', updated_at: '2026-06-01',
    lead_name: null, lead_email: null, lead_phone: null, lead_company: null,
    lead_picture_url: null, stage_name: null, stage_kind: 'open',
    origin_submission_kind: null, unread_count: 0, missed_count: 0,
    is_archived: false,
    ...over,
  }
}

const STAGES: ProjectStageRow[] = [
  stage('s-open', 'New', 'open'),
  stage('s-won', 'Won', 'won'),
  stage('s-lost', 'Lost', 'lost'),
]

describe('computeProjectStats', () => {
  it('returns zeroed stats for an empty board', () => {
    const s = computeProjectStats([], STAGES)
    expect(s.total).toBe(0)
    expect(s.open).toBe(0)
    expect(s.won).toBe(0)
    expect(s.lost).toBe(0)
    expect(s.openValue).toBe(0)
    expect(s.wonValue).toBe(0)
    expect(s.unread).toBe(0)
    expect(s.missed).toBe(0)
    expect(s.perStage).toHaveLength(3)
    expect(s.perStage.every((p) => p.count === 0 && p.subtotal === 0)).toBe(true)
  })

  it('counts projects by outcome from stage_kind', () => {
    const rows = [
      card({ id: '1', stage_id: 's-open', stage_kind: 'open' }),
      card({ id: '2', stage_id: 's-open', stage_kind: 'open' }),
      card({ id: '3', stage_id: 's-won', stage_kind: 'won' }),
      card({ id: '4', stage_id: 's-lost', stage_kind: 'lost' }),
    ]
    const s = computeProjectStats(rows, STAGES)
    expect(s.total).toBe(4)
    expect(s.open).toBe(2)
    expect(s.won).toBe(1)
    expect(s.lost).toBe(1)
  })

  it('treats a null stage_kind as open', () => {
    const s = computeProjectStats([card({ stage_kind: null })], STAGES)
    expect(s.open).toBe(1)
    expect(s.won).toBe(0)
    expect(s.lost).toBe(0)
  })

  it('sums open pipeline value and won value separately', () => {
    const rows = [
      card({ id: '1', stage_kind: 'open', value: 1000 }),
      card({ id: '2', stage_kind: 'open', value: 500 }),
      card({ id: '3', stage_kind: 'won', value: 2000 }),
      card({ id: '4', stage_kind: 'lost', value: 9999 }), // excluded from both
      card({ id: '5', stage_kind: 'open', value: null }), // null ignored
    ]
    const s = computeProjectStats(rows, STAGES)
    expect(s.openValue).toBe(1500)
    expect(s.wonValue).toBe(2000)
  })

  it('sums unread and missed counts across all rows', () => {
    const rows = [
      card({ id: '1', unread_count: 3, missed_count: 1 }),
      card({ id: '2', unread_count: 2, missed_count: 4 }),
    ]
    const s = computeProjectStats(rows, STAGES)
    expect(s.unread).toBe(5)
    expect(s.missed).toBe(5)
  })

  it('builds a per-stage breakdown in stage order with counts and value subtotals', () => {
    const rows = [
      card({ id: '1', stage_id: 's-open', value: 100 }),
      card({ id: '2', stage_id: 's-open', value: 200 }),
      card({ id: '3', stage_id: 's-won', stage_kind: 'won', value: 1000 }),
    ]
    const s = computeProjectStats(rows, STAGES)
    expect(s.perStage.map((p) => p.stageId)).toEqual(['s-open', 's-won', 's-lost'])
    expect(s.perStage[0]).toMatchObject({ name: 'New', count: 2, subtotal: 300 })
    expect(s.perStage[1]).toMatchObject({ name: 'Won', count: 1, subtotal: 1000 })
    expect(s.perStage[2]).toMatchObject({ name: 'Lost', count: 0, subtotal: 0 })
  })

  it('picks the currency from the first row, falling back to PHP', () => {
    expect(computeProjectStats([card({ currency: 'USD' })], STAGES).currency).toBe('USD')
    expect(computeProjectStats([], STAGES).currency).toBe('PHP')
  })

  it('still counts archived cards in stage and KPI totals (they are only hidden from the board)', () => {
    const rows = [
      card({ id: '1', stage_id: 's-open', value: 100, is_archived: false, archived_at: null }),
      card({ id: '2', stage_id: 's-open', value: 400, is_archived: true, archived_at: '2026-06-10' }),
    ]
    const s = computeProjectStats(rows, STAGES)
    expect(s.total).toBe(2)
    expect(s.open).toBe(2)
    expect(s.openValue).toBe(500)
    expect(s.perStage[0]).toMatchObject({ name: 'New', count: 2, subtotal: 500 })
  })
})
