import { describe, it, expect } from 'vitest'
import { matchStage, planUpgrade } from './upgrade'
import { DEFAULT_STAGES } from '@/app/(app)/dashboard/leads/_lib/defaults'

const existingClassic = [
  { id: 'A', name: 'New Lead', kind: 'entry', position: 0, entry_signals: null },
  { id: 'B', name: 'Contacted', kind: 'nurture', position: 1, entry_signals: null },
  { id: 'C', name: 'Qualified', kind: 'qualifying', position: 2, entry_signals: null },
  { id: 'D', name: 'Won', kind: 'won', position: 5, entry_signals: null },
  { id: 'E', name: 'Lost', kind: 'lost', position: 6, entry_signals: null },
  { id: 'X', name: 'Follow-Up', kind: 'nurture', position: 7, entry_signals: null },
]

describe('matchStage', () => {
  it('matches Contacted to the canonical Engaged slot via kind=nurture pos=1', () => {
    const m = matchStage(existingClassic[1], DEFAULT_STAGES)
    expect(m?.name).toBe('Engaged')
  })

  it('returns null for user-renamed custom stage Follow-Up', () => {
    const m = matchStage(existingClassic[5], DEFAULT_STAGES)
    // We do NOT auto-match custom user-created stages onto defaults.
    expect(m).toBeNull()
  })
})

describe('planUpgrade', () => {
  it('produces enrich + add operations and zero lead moves', () => {
    const plan = planUpgrade(existingClassic, DEFAULT_STAGES)
    const enrich = plan.operations.filter((op) => op.kind === 'enrich')
    const add = plan.operations.filter((op) => op.kind === 'add')
    expect(enrich.length).toBeGreaterThan(0)
    expect(add.length).toBeGreaterThan(0)
    expect(plan.leadsMoved).toBe(0)
    // Custom stage Follow-Up is preserved untouched.
    expect(plan.preservedCustomStageIds).toContain('X')
  })

  it('reports needsUpgrade=false when entry_signals already populated', () => {
    const stages = existingClassic.map((s) => ({ ...s, entry_signals: ['x'] }))
    const plan = planUpgrade(stages, DEFAULT_STAGES)
    expect(plan.needsUpgrade).toBe(false)
  })
})
