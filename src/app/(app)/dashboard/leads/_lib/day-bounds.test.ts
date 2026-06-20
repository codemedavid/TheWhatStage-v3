import { describe, it, expect } from 'vitest'
import { manilaDayStartIso, manilaDayEndIso } from './day-bounds'

// Asia/Manila is a fixed UTC+8 offset (no DST), so a Manila calendar day maps
// to a deterministic UTC instant window: [day 00:00+08:00, day 23:59:59.999+08:00].
describe('manilaDayStartIso', () => {
  it('maps Manila midnight to the previous-day 16:00 UTC instant', () => {
    expect(manilaDayStartIso('2026-06-20')).toBe('2026-06-19T16:00:00.000Z')
  })

  it('handles month boundaries', () => {
    expect(manilaDayStartIso('2026-07-01')).toBe('2026-06-30T16:00:00.000Z')
  })
})

describe('manilaDayEndIso', () => {
  it('maps Manila end-of-day to the same-day 15:59:59.999 UTC instant', () => {
    expect(manilaDayEndIso('2026-06-20')).toBe('2026-06-20T15:59:59.999Z')
  })
})
