import { describe, expect, it, vi, beforeEach } from 'vitest'

const adminFromMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: adminFromMock }),
}))

import { GET } from './route'

beforeEach(() => {
  process.env.NODE_ENV = 'test'
  process.env.CRON_SECRET = 'secret'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost'
  process.env.MESSENGER_WORKER_SECRET = 'wsecret'
  adminFromMock.mockReset()
})

describe('followups-tick route', () => {
  it('rejects unauthorized requests in production', async () => {
    process.env.NODE_ENV = 'production'
    const res = await GET(new Request('http://x/api/cron/followups-tick'))
    expect(res.status).toBe(401)
  })

  it('enqueues a messenger_jobs row for each due schedule', async () => {
    const due = [
      { id: 's1', user_id: 'u1', thread_id: 't1' },
      { id: 's2', user_id: 'u1', thread_id: 't2' },
    ]
    const inserts: unknown[] = []
    const updates: unknown[] = []
    adminFromMock.mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.is = () => chain
      chain.lte = () => chain
      chain.limit = () =>
        table === 'lead_followup_schedules'
          ? Promise.resolve({ data: due, error: null })
          : chain
      chain.insert = (v: unknown) => {
        inserts.push({ table, v })
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: `job-${inserts.length}` }, error: null }),
          }),
        }
      }
      chain.update = (v: unknown) => {
        updates.push({ table, v })
        chain.eq = () => Promise.resolve({ error: null }) as never
        return chain
      }
      return chain
    })

    const req = new Request('http://x/api/cron/followups-tick', {
      headers: { authorization: 'Bearer secret' },
    })
    const res = await GET(req)
    const json = (await res.json()) as { enqueued: number }
    expect(json.enqueued).toBe(2)
    const jobInserts = inserts.filter((i) => (i as { table: string }).table === 'messenger_jobs')
    expect(jobInserts).toHaveLength(2)
    for (const j of jobInserts) {
      expect((j as { v: Record<string, unknown> }).v.kind).toBe('followup_send')
    }
  })
})
