import { describe, expect, it } from 'vitest'
import { shouldRollSummary } from './answer'

describe('shouldRollSummary', () => {
  // window=12, interval=8 — matches the production constants in route.ts.
  // The trigger fires every `interval` turns once history exceeds the
  // window, so long Messenger threads keep a fresh summary instead of
  // freezing at one snapshot once we cross HISTORY_LIMIT.
  const window = 12
  const interval = 8

  it('does not fire while history fits in the LLM window', () => {
    expect(shouldRollSummary(0, window, interval)).toBe(false)
    expect(shouldRollSummary(11, window, interval)).toBe(false)
    expect(shouldRollSummary(12, window, interval)).toBe(false)
  })

  it('fires at each interval crossing past the window', () => {
    // overflow=8 → history=20, first refresh
    expect(shouldRollSummary(20, window, interval)).toBe(true)
    // overflow=16 → history=28, second refresh
    expect(shouldRollSummary(28, window, interval)).toBe(true)
    // overflow=24 → history=36, third refresh
    expect(shouldRollSummary(36, window, interval)).toBe(true)
  })

  it('does not fire between interval boundaries', () => {
    expect(shouldRollSummary(13, window, interval)).toBe(false)
    expect(shouldRollSummary(19, window, interval)).toBe(false)
    expect(shouldRollSummary(27, window, interval)).toBe(false)
    expect(shouldRollSummary(35, window, interval)).toBe(false)
  })
})
