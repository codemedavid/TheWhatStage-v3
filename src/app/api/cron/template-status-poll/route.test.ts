import { describe, expect, it, vi, beforeEach } from 'vitest'

const adminFromMock = vi.hoisted(() => vi.fn())
const resolveTargetPageMock = vi.hoisted(() => vi.fn())
const fetchAllMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: adminFromMock }),
}))
vi.mock('@/lib/facebook/crypto', () => ({
  decryptToken: (t: string) => t,
}))
vi.mock('@/lib/facebook/templates-page-resolver', () => ({
  resolveTargetPage: resolveTargetPageMock,
}))
vi.mock('@/lib/facebook/messenger-templates', () => ({
  fetchAllMessengerTemplates: fetchAllMock,
}))

import { GET } from './route'

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('CRON_SECRET', 'secret')
  adminFromMock.mockReset()
  resolveTargetPageMock.mockReset()
  fetchAllMock.mockReset()
})

function mockAdmin(pending: unknown[], updates: unknown[]) {
  adminFromMock.mockImplementation(() => {
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.or = () => chain
    chain.order = () => chain
    chain.limit = () => Promise.resolve({ data: pending, error: null })
    chain.update = (v: unknown) => ({
      eq: (_col: string, id: string) => {
        updates.push({ id, v })
        return Promise.resolve({ error: null })
      },
    })
    return chain
  })
}

describe('template-status-poll cron', () => {
  it('rejects unauthorized requests in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await GET(new Request('http://x/api/cron/template-status-poll'))
    expect(res.status).toBe(401)
  })

  it('flips approved rows, backfills ids, and survives a failing page', async () => {
    const pending = [
      { id: 'r1', user_id: 'u1', page_id: null, name: 'a', language: 'en_US', meta_status: 'pending', meta_template_id: null },
      { id: 'r2', user_id: 'u1', page_id: null, name: 'b', language: 'en_US', meta_status: 'pending', meta_template_id: null },
      { id: 'r3', user_id: 'u2', page_id: null, name: 'c', language: 'en_US', meta_status: 'pending', meta_template_id: null },
    ]
    const updates: Array<{ id: string; v: Record<string, unknown> }> = []
    mockAdmin(pending, updates)

    resolveTargetPageMock.mockImplementation((_admin: unknown, userId: string) =>
      userId === 'u1'
        ? { id: 'pg1', fb_page_id: 'fb1', page_access_token: 'enc1' }
        : { id: 'pg2', fb_page_id: 'fb2', page_access_token: 'enc2' },
    )
    fetchAllMock.mockImplementation((args: { fbPageId: string }) => {
      if (args.fbPageId === 'fb1') {
        return Promise.resolve([
          { id: 'm_a', name: 'a', language: 'en_US', status: 'APPROVED', rejected_reason: null },
          { id: 'm_b', name: 'b', language: 'en_US', status: 'PENDING', rejected_reason: null },
        ])
      }
      return Promise.reject(new Error('bad token'))
    })

    const req = new Request('http://x/api/cron/template-status-poll', {
      headers: { authorization: 'Bearer secret' },
    })
    const res = await GET(req)
    const json = (await res.json()) as { checked: number; flipped: number }

    expect(json.checked).toBe(3)
    expect(json.flipped).toBe(1) // only r1 (PENDING -> APPROVED) is a status change

    // fb1 fetched once (r1 + r2 share the page), fb2 once (then throws)
    expect(fetchAllMock).toHaveBeenCalledTimes(2)

    // r1 written as approved; r2 written to backfill its meta_template_id
    const r1 = updates.find((u) => u.id === 'r1')
    expect(r1?.v.meta_status).toBe('approved')
    expect(r1?.v.meta_template_id).toBe('m_a')
    const r2 = updates.find((u) => u.id === 'r2')
    expect(r2?.v.meta_template_id).toBe('m_b')
    // r3's page failed — no update, but the pass still completed
    expect(updates.find((u) => u.id === 'r3')).toBeUndefined()
  })
})
