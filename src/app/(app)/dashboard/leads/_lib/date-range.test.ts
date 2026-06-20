import { describe, it, expect } from 'vitest'
import { resolveDateRange } from './date-range'
import { LeadsQuery } from './schemas'

// A fixed absolute instant: 2026-06-17 06:30 UTC == 2026-06-17 14:30 Asia/Manila
// (Wednesday). Presets are anchored to the Manila calendar regardless of where
// the server (or CI) runs.
const NOW = new Date('2026-06-17T06:30:00.000Z')

function query(overrides: Partial<LeadsQuery> = {}): LeadsQuery {
  return LeadsQuery.parse(overrides)
}

describe('resolveDateRange', () => {
  it('defaults to today (both bounds = current Manila day)', () => {
    const out = resolveDateRange(query(), NOW)
    expect(out.from).toBe('2026-06-17')
    expect(out.to).toBe('2026-06-17')
  })

  it('anchors "today" to the Manila calendar day, not the UTC day', () => {
    // 2026-06-19 16:30 UTC is already 2026-06-20 00:30 in Manila.
    const lateNight = new Date('2026-06-19T16:30:00.000Z')
    const out = resolveDateRange(query(), lateNight)
    expect(out.from).toBe('2026-06-20')
    expect(out.to).toBe('2026-06-20')
  })

  it('week spans Monday of the current Manila week through today', () => {
    const out = resolveDateRange(query({ range: 'week' }), NOW)
    expect(out.from).toBe('2026-06-15') // Monday
    expect(out.to).toBe('2026-06-17')
  })

  it('month spans the 1st through today', () => {
    const out = resolveDateRange(query({ range: 'month' }), NOW)
    expect(out.from).toBe('2026-06-01')
    expect(out.to).toBe('2026-06-17')
  })

  it('all clears both bounds', () => {
    const out = resolveDateRange(query({ range: 'all', from: '2020-01-01', to: '2020-02-01' }), NOW)
    expect(out.from).toBeUndefined()
    expect(out.to).toBeUndefined()
  })

  it('custom passes explicit bounds through unchanged', () => {
    const out = resolveDateRange(query({ range: 'custom', from: '2026-01-01', to: '2026-03-01' }), NOW)
    expect(out.from).toBe('2026-01-01')
    expect(out.to).toBe('2026-03-01')
  })

  it('does not mutate the input params', () => {
    const input = query({ range: 'today' })
    resolveDateRange(input, NOW)
    expect(input.from).toBeUndefined()
    expect(input.to).toBeUndefined()
  })
})
