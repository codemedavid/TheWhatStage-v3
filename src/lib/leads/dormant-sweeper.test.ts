import { describe, it, expect, vi } from 'vitest'
import { computeDormantMoves } from './dormant-sweeper'

const now = new Date('2026-05-14T00:00:00Z')

const stages = [
  { id: 'new', kind: 'entry', name: 'New', position: 0 },
  { id: 'eng', kind: 'nurture', name: 'Engaged', position: 1 },
  { id: 'won', kind: 'won', name: 'Won', position: 6 },
  { id: 'dor', kind: 'dormant', name: 'Dormant', position: 8 },
]

describe('computeDormantMoves', () => {
  it('marks leads inactive >14d in Engaged as Dormant', () => {
    const leads = [
      { id: 'L1', stage_id: 'eng', last_inbound_at: '2026-04-20T00:00:00Z' }, // 24d
      { id: 'L2', stage_id: 'eng', last_inbound_at: '2026-05-10T00:00:00Z' }, // 4d
    ]
    const moves = computeDormantMoves(leads, stages, now)
    expect(moves).toEqual([{ leadId: 'L1', toStageId: 'dor', fromStageId: 'eng' }])
  })

  it('skips terminal stages', () => {
    const leads = [{ id: 'L1', stage_id: 'won', last_inbound_at: '2026-01-01T00:00:00Z' }]
    expect(computeDormantMoves(leads, stages, now)).toEqual([])
  })

  it('skips New Lead (kind=entry) — only Engaged or further qualifies for Dormant', () => {
    const leads = [{ id: 'L1', stage_id: 'new', last_inbound_at: null }]
    expect(computeDormantMoves(leads, stages, now)).toEqual([])
  })

  it('returns empty when no Dormant stage exists for the user', () => {
    const noDormant = stages.filter((s) => s.kind !== 'dormant')
    const leads = [{ id: 'L1', stage_id: 'eng', last_inbound_at: '2026-04-01T00:00:00Z' }]
    expect(computeDormantMoves(leads, noDormant, now)).toEqual([])
  })
})
