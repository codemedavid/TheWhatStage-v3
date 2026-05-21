import { describe, it, expect } from 'vitest'
import { isBotPaused } from './takeover'

describe('isBotPaused', () => {
  const now = new Date('2026-05-21T12:00:00Z')

  it('returns false when bot_paused_until is null', () => {
    expect(isBotPaused(null, now)).toBe(false)
  })

  it('returns false when bot_paused_until is in the past', () => {
    expect(isBotPaused('2026-05-21T11:00:00Z', now)).toBe(false)
  })

  it('returns false when bot_paused_until equals now', () => {
    expect(isBotPaused('2026-05-21T12:00:00Z', now)).toBe(false)
  })

  it('returns true when bot_paused_until is in the future', () => {
    expect(isBotPaused('2026-05-21T12:30:00Z', now)).toBe(true)
  })

  it('returns false on malformed timestamp', () => {
    expect(isBotPaused('not-a-date', now)).toBe(false)
  })

  it('uses Date.now() when no `now` argument passed', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    expect(isBotPaused(future)).toBe(true)
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(isBotPaused(past)).toBe(false)
  })
})
