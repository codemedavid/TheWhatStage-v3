import { describe, it, expect } from 'vitest'
import { DEFAULT_STAGES } from './defaults'

describe('DEFAULT_STAGES', () => {
  it('contains exactly 9 stages in canonical order', () => {
    expect(DEFAULT_STAGES.map((s) => s.name)).toEqual([
      'New Lead',
      'Engaged',
      'Interested',
      'Qualified',
      'Objection',
      'Proposal / Booked',
      'Won',
      'Lost',
      'Dormant',
    ])
  })

  it('every non-terminal stage has entry_signals populated', () => {
    for (const s of DEFAULT_STAGES) {
      if (s.kind === 'won' || s.kind === 'lost') continue
      expect(s.entry_signals.length, `stage "${s.name}" missing entry_signals`).toBeGreaterThan(0)
    }
  })

  it('Objection stage uses kind="objection"', () => {
    expect(DEFAULT_STAGES.find((s) => s.name === 'Objection')?.kind).toBe('objection')
  })

  it('first stage is the entry kind', () => {
    expect(DEFAULT_STAGES[0].kind).toBe('entry')
    expect(DEFAULT_STAGES[0].isDefault).toBe(true)
  })
})
