import { describe, it, expect } from 'vitest'
import { coercePauseDecision, computePauseUntil } from './pause'

describe('coercePauseDecision', () => {
  it('accepts an object with a non-empty reason and trims it', () => {
    expect(coercePauseDecision({ reason: '  customer asked for a human  ' })).toEqual({
      reason: 'customer asked for a human',
    })
  })

  it('caps an overly long reason', () => {
    const long = 'x'.repeat(500)
    const out = coercePauseDecision({ reason: long })
    expect(out).not.toBeNull()
    expect(out!.reason.length).toBeLessThanOrEqual(280)
  })

  it('returns null for null / undefined', () => {
    expect(coercePauseDecision(null)).toBeNull()
    expect(coercePauseDecision(undefined)).toBeNull()
  })

  it('returns null for non-object scalars', () => {
    expect(coercePauseDecision('pause')).toBeNull()
    expect(coercePauseDecision(true)).toBeNull()
    expect(coercePauseDecision(42)).toBeNull()
  })

  it('returns null when reason is missing, empty, or not a string', () => {
    expect(coercePauseDecision({})).toBeNull()
    expect(coercePauseDecision({ reason: '' })).toBeNull()
    expect(coercePauseDecision({ reason: '   ' })).toBeNull()
    expect(coercePauseDecision({ reason: 123 })).toBeNull()
  })
})

describe('computePauseUntil', () => {
  const now = new Date('2026-06-17T00:00:00.000Z')

  it('returns an ISO timestamp of now + minutes for a positive duration', () => {
    expect(computePauseUntil(now, 60)).toBe('2026-06-17T01:00:00.000Z')
    expect(computePauseUntil(now, 30)).toBe('2026-06-17T00:30:00.000Z')
  })

  it('returns null for zero, negative, or non-finite minutes', () => {
    expect(computePauseUntil(now, 0)).toBeNull()
    expect(computePauseUntil(now, -5)).toBeNull()
    expect(computePauseUntil(now, Number.NaN)).toBeNull()
    expect(computePauseUntil(now, Number.POSITIVE_INFINITY)).toBeNull()
  })
})
