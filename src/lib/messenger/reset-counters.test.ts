import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildCounterResetPatch, resetThreadCountersByLead } from './reset-counters'

describe('buildCounterResetPatch', () => {
  const NOW = '2026-06-19T12:00:00.000Z'

  it('clears unread and stamps last_read_at but leaves missed alone on a passive view', () => {
    const patch = buildCounterResetPatch({ resetMissed: false }, NOW)
    expect(patch).toEqual({ unread_count: 0, last_read_at: NOW })
    expect('missed_count' in patch).toBe(false)
  })

  it('also clears missed on an explicit mark-as-read', () => {
    const patch = buildCounterResetPatch({ resetMissed: true }, NOW)
    expect(patch).toEqual({ unread_count: 0, missed_count: 0, last_read_at: NOW })
  })
})

describe('resetThreadCountersByLead', () => {
  function fakeSupabase(result: { error: unknown }) {
    const capture: { table?: string; patch?: unknown; col?: string; val?: unknown } = {}
    const builder = {
      update: (patch: unknown) => {
        capture.patch = patch
        return builder
      },
      eq: (col: string, val: unknown) => {
        capture.col = col
        capture.val = val
        return Promise.resolve(result)
      },
    }
    const client = { from: (t: string) => ((capture.table = t), builder) } as unknown as SupabaseClient
    return { client, capture }
  }

  it('updates messenger_threads for the lead, clearing unread only', async () => {
    const { client, capture } = fakeSupabase({ error: null })
    await resetThreadCountersByLead(client, 'lead-1', { resetMissed: false })
    expect(capture.table).toBe('messenger_threads')
    expect(capture.col).toBe('lead_id')
    expect(capture.val).toBe('lead-1')
    expect(capture.patch).toMatchObject({ unread_count: 0 })
    expect('missed_count' in (capture.patch as object)).toBe(false)
  })

  it('clears both counters when resetMissed is true', async () => {
    const { client, capture } = fakeSupabase({ error: null })
    await resetThreadCountersByLead(client, 'lead-2', { resetMissed: true })
    expect(capture.patch).toMatchObject({ unread_count: 0, missed_count: 0 })
  })

  it('throws a labelled error when the update fails', async () => {
    const { client } = fakeSupabase({ error: { message: 'nope' } })
    await expect(
      resetThreadCountersByLead(client, 'lead-3', { resetMissed: true }),
    ).rejects.toThrow('resetThreadCounters: nope')
  })
})
