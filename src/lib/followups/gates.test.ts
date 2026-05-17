import { describe, expect, it, vi } from 'vitest'
import { shouldSeed } from './gates'

// Minimal admin-client stub: each .from(table) returns a chainable query
// whose terminal call resolves with the canned value. The factory inside the
// test wires the canned values per case.
function makeAdmin(tables: Record<string, { count?: number; rows?: unknown[] }>) {
  return {
    from(table: string) {
      const canned = tables[table] ?? {}
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: (resolve: (r: { data: unknown[] | null; count: number | null; error: null }) => void) =>
          resolve({ data: canned.rows ?? [], count: canned.count ?? 0, error: null }),
      }
      return query
    },
  } as never
}

describe('shouldSeed', () => {
  it('passes when inbound count is 14 and no completed action', async () => {
    const admin = makeAdmin({
      messenger_messages: { count: 14 },
      action_page_submissions: { rows: [] },
    })
    const r = await shouldSeed(admin, { threadId: 't1', leadId: 'l1' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.inboundCount).toBe(14)
  })

  it('fails when inbound count is 15', async () => {
    const admin = makeAdmin({
      messenger_messages: { count: 15 },
      action_page_submissions: { rows: [] },
    })
    const r = await shouldSeed(admin, { threadId: 't1', leadId: 'l1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('inbound_count_15')
  })

  it('fails when lead has a completed page action', async () => {
    const admin = makeAdmin({
      messenger_messages: { count: 3 },
      action_page_submissions: { rows: [{ id: 's1' }] },
    })
    const r = await shouldSeed(admin, { threadId: 't1', leadId: 'l1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('page_action_completed')
  })
})
