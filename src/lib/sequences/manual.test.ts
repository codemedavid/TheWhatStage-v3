// Spec for the manual-override layer on follow-up steps. A step is fundamentally
// an AI touch with an optional MANUAL override: when an operator types their own
// message, it is sent VERBATIM (no LLM); when the override is blank, the step
// falls back to the normal AI draft path. These two pure helpers encode that
// rule and are shared by the firing worker and the no-send preview.

import { describe, expect, it } from 'vitest'
import { manualOverride, aiDraftSteps } from './manual'

describe('manualOverride', () => {
  it('returns the trimmed message when one is provided', () => {
    expect(manualOverride('  Send this exact text.  ')).toBe('Send this exact text.')
  })

  it('returns null for a blank, whitespace, null, or undefined message', () => {
    expect(manualOverride('')).toBeNull()
    expect(manualOverride('   ')).toBeNull()
    expect(manualOverride(null)).toBeNull()
    expect(manualOverride(undefined)).toBeNull()
  })

  it('preserves internal whitespace and newlines, trimming only the ends', () => {
    expect(manualOverride('  Line one\nLine two  ')).toBe('Line one\nLine two')
  })
})

describe('aiDraftSteps', () => {
  const steps = [
    { position: 0, manual_message: null, instruction: 'Check in.' },
    { position: 1, manual_message: 'Verbatim nudge.', instruction: 'Share value.' },
    { position: 2, manual_message: '   ', instruction: 'Final nudge.' },
  ]

  it('keeps only steps without a manual override', () => {
    expect(aiDraftSteps(steps).map((s) => s.position)).toEqual([0, 2])
  })

  it('preserves each kept step’s original position (filters, never re-indexes)', () => {
    const withGap = [
      { position: 0, manual_message: 'Manual first.' },
      { position: 1, manual_message: null },
      { position: 2, manual_message: null },
    ]
    expect(aiDraftSteps(withGap).map((s) => s.position)).toEqual([1, 2])
  })

  it('returns an empty array when every step is manual', () => {
    expect(aiDraftSteps([{ position: 0, manual_message: 'a' }, { position: 1, manual_message: 'b' }])).toEqual([])
  })
})
