import { describe, it, expect, vi, beforeEach } from 'vitest'

// admin-usage wrappers call the RLS session client via createClient(). Mock it so
// each test can drive what the gated RPC returns: a row set, or an {error}
// (e.g. the `forbidden: superadmin only` raised by the current_role() gate).
const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc }),
}))

import {
  getUsageTotals,
  getUsageTrend,
  getUsageByScopeModel,
  getUsageByTenant,
} from './admin-usage'

beforeEach(() => {
  rpc.mockReset()
})

describe('admin-usage RPC wrappers — error surfacing', () => {
  // The root cause of the "admin shows zero usage" bug: the gate RPC raised
  // `forbidden` and the wrapper silently returned zeros, so a hard failure was
  // indistinguishable from genuinely-zero usage. The wrapper MUST throw.
  const forbidden = { data: null, error: { message: 'forbidden: superadmin only', code: '42501' } }

  it('getUsageTotals throws when the RPC returns an error', async () => {
    rpc.mockResolvedValue(forbidden)
    await expect(getUsageTotals('2026-06-01', '2026-06-19')).rejects.toThrow(/forbidden/)
  })

  it('getUsageTrend throws when the RPC returns an error', async () => {
    rpc.mockResolvedValue(forbidden)
    await expect(getUsageTrend('2026-06-01', '2026-06-19')).rejects.toThrow(/forbidden/)
  })

  it('getUsageByScopeModel throws when the RPC returns an error', async () => {
    rpc.mockResolvedValue(forbidden)
    await expect(getUsageByScopeModel('2026-06-01', '2026-06-19')).rejects.toThrow(/forbidden/)
  })

  it('getUsageByTenant throws when the RPC returns an error', async () => {
    rpc.mockResolvedValue(forbidden)
    await expect(getUsageByTenant('2026-06-01', '2026-06-19')).rejects.toThrow(/forbidden/)
  })
})

describe('admin-usage RPC wrappers — mapping', () => {
  it('getUsageTotals maps the single returned row, coercing nulls to 0', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          total_tokens: 22706207,
          prompt_tokens: 21302011,
          cached_prompt_tokens: 8599172,
          completion_tokens: 1404196,
          cost_micros: 2074872,
          event_count: 3624,
          active_tenants: 3,
        },
      ],
      error: null,
    })
    const totals = await getUsageTotals('2026-06-01', '2026-06-19')
    expect(totals).toEqual({
      totalTokens: 22706207,
      promptTokens: 21302011,
      cachedPromptTokens: 8599172,
      completionTokens: 1404196,
      costMicros: 2074872,
      eventCount: 3624,
      activeTenants: 3,
    })
  })

  it('getUsageTotals returns zeros (not a throw) when the RPC yields no rows', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    const totals = await getUsageTotals('2026-06-01', '2026-06-19')
    expect(totals.totalTokens).toBe(0)
    expect(totals.costMicros).toBe(0)
  })

  it('getUsageByTenant maps rows including cost and effective tokens', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          user_id: 'u1',
          email: 'a@b.c',
          full_name: 'Tenant A',
          tier: 'pro',
          included_tokens: 1000000,
          total_tokens: 500000,
          adj_tokens: 0,
          effective_tokens: 500000,
          cost_micros: 65000,
          event_count: 120,
          last_active_day: '2026-06-19',
        },
      ],
      error: null,
    })
    const rows = await getUsageByTenant('2026-06-01', '2026-06-19')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: 'u1', tier: 'pro', costMicros: 65000, effectiveTokens: 500000 })
  })
})
