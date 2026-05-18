import { describe, expect, it } from 'vitest'
import {
  SEQUENCE_OFFSETS_DAYS,
  SEQUENCE_LENGTH,
  scheduledAtForPosition,
  roleForPosition,
} from './sequence'

describe('SEQUENCE_OFFSETS_DAYS', () => {
  it('contains exactly the 7 expected offsets', () => {
    expect(Array.from(SEQUENCE_OFFSETS_DAYS)).toEqual([0, 1, 2, 3, 5, 8, 13])
    expect(SEQUENCE_LENGTH).toBe(7)
  })
})

describe('scheduledAtForPosition', () => {
  const anchor = new Date('2026-08-12T06:00:00.000Z') // Wed 2pm Manila

  it('returns anchor itself for position 0', () => {
    expect(scheduledAtForPosition(anchor, 0).toISOString()).toBe(anchor.toISOString())
  })

  it('adds N days for positions 1..6', () => {
    const dayMs = 86_400_000
    expect(scheduledAtForPosition(anchor, 1).getTime()).toBe(anchor.getTime() + 1 * dayMs)
    expect(scheduledAtForPosition(anchor, 3).getTime()).toBe(anchor.getTime() + 3 * dayMs)
    expect(scheduledAtForPosition(anchor, 6).getTime()).toBe(anchor.getTime() + 13 * dayMs)
  })

  it('throws on out-of-range position', () => {
    expect(() => scheduledAtForPosition(anchor, -1)).toThrow()
    expect(() => scheduledAtForPosition(anchor, 7)).toThrow()
  })
})

describe('roleForPosition', () => {
  it('returns a distinct, non-empty role string for each of the 7 positions', () => {
    const roles = new Set<string>()
    for (let i = 0; i < 7; i++) {
      const r = roleForPosition(i)
      expect(r.length).toBeGreaterThan(10)
      roles.add(r)
    }
    expect(roles.size).toBe(7)
  })

  it('throws on out-of-range position', () => {
    expect(() => roleForPosition(7)).toThrow()
  })
})
