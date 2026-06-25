import { describe, it, expect, vi, beforeEach } from 'vitest'

// usage-alerts raises Sentry warnings on anomaly; mute the SDK so tests assert
// on the returned metrics, not on Sentry transport.
const captureMessage = vi.fn()
vi.mock('@sentry/nextjs', () => ({ captureMessage: (...a: unknown[]) => captureMessage(...a) }))

import { checkUsageHealth } from './usage-alerts'

type Row = { prompt_tokens: number | null; cached_prompt_tokens: number | null; cost_micros: number | null }

/**
 * Minimal stand-in for the Supabase query builder. `checkUsageHealth` issues two
 * queries: (1) `.from().select().gte()` for the recent window, (2)
 * `.from().select().gte().lt()` for the 7-day baseline. Each `from()` dequeues
 * the next configured result; the builder is awaitable at any chain depth.
 */
function makeAdmin(results: Array<{ data: unknown; error: unknown }>) {
  let call = 0
  const build = (result: { data: unknown; error: unknown }) => {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.gte = () => b
    b.lt = () => b
    b.then = (resolve: (v: unknown) => void) => resolve(result)
    return b
  }
  return { from: () => build(results[call++]) } as never
}

const recent = (rows: Row[]) => ({ data: rows, error: null })
const noBaseline = { data: [], error: null }

beforeEach(() => captureMessage.mockReset())

describe('checkUsageHealth — cache-hit denominator', () => {
  it('excludes UNKNOWN (null cached) rows from the cache-hit rate', async () => {
    // One KNOWN row at 90% hit, plus a large UNKNOWN row (provider reported no
    // cache field). The honest rate is 90% (known-only); counting the UNKNOWN
    // row's prompt tokens in the denominator would crush it to ~21% and page.
    const rows: Row[] = [
      { prompt_tokens: 6000, cached_prompt_tokens: 5400, cost_micros: 100 },
      { prompt_tokens: 20000, cached_prompt_tokens: null, cost_micros: 100 },
    ]
    const health = await checkUsageHealth(makeAdmin([recent(rows), noBaseline]))

    expect(health.cacheHitRate).toBeCloseTo(0.9, 3)
    expect(health.alerts.some((a) => a.includes('cache-hit rate'))).toBe(false)
  })

  it('fires when the KNOWN-row hit rate is below the floor', async () => {
    const rows: Row[] = [{ prompt_tokens: 6000, cached_prompt_tokens: 1200, cost_micros: 100 }]
    const health = await checkUsageHealth(makeAdmin([recent(rows), noBaseline]))

    expect(health.cacheHitRate).toBeCloseTo(0.2, 3)
    expect(health.alerts.some((a) => a.includes('cache-hit rate'))).toBe(true)
  })
})

describe('checkUsageHealth — floor calibrated to 0.30', () => {
  it('does NOT fire at 32% (above the 30% floor)', async () => {
    const rows: Row[] = [{ prompt_tokens: 10000, cached_prompt_tokens: 3200, cost_micros: 100 }]
    const health = await checkUsageHealth(makeAdmin([recent(rows), noBaseline]))

    expect(health.alerts.some((a) => a.includes('cache-hit rate'))).toBe(false)
  })

  it('fires at 28% (below the 30% floor)', async () => {
    const rows: Row[] = [{ prompt_tokens: 10000, cached_prompt_tokens: 2800, cost_micros: 100 }]
    const health = await checkUsageHealth(makeAdmin([recent(rows), noBaseline]))

    expect(health.alerts.some((a) => a.includes('cache-hit rate'))).toBe(true)
  })
})
