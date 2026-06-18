import { describe, it, expect } from 'vitest'
import { nextSequenceState } from './advance'

describe('nextSequenceState', () => {
  const started = '2026-06-18T00:00:00.000Z'

  it('reports done when on the last step', () => {
    const steps = [{ delay_minutes: 0 }, { delay_minutes: 60 }]
    expect(nextSequenceState(started, steps, 1)).toEqual({ done: true })
  })

  it('reports done when the index is past the last step', () => {
    expect(nextSequenceState(started, [{ delay_minutes: 0 }], 5)).toEqual({ done: true })
  })

  it('reports done for a single-step sequence after step 0', () => {
    expect(nextSequenceState(started, [{ delay_minutes: 0 }], 0)).toEqual({ done: true })
  })

  it('advances and anchors next_run_at to started_at + the next step delay', () => {
    const steps = [{ delay_minutes: 0 }, { delay_minutes: 60 }, { delay_minutes: 1440 }]
    expect(nextSequenceState(started, steps, 0)).toEqual({
      done: false,
      nextStepIdx: 1,
      nextRunAt: '2026-06-18T01:00:00.000Z',
    })
  })

  it('uses the next step delay from the anchor, not cumulatively from the previous step', () => {
    const steps = [{ delay_minutes: 0 }, { delay_minutes: 60 }, { delay_minutes: 1440 }]
    // 1440 minutes = 24h measured from started_at, not from step 1.
    expect(nextSequenceState(started, steps, 1)).toEqual({
      done: false,
      nextStepIdx: 2,
      nextRunAt: '2026-06-19T00:00:00.000Z',
    })
  })
})
