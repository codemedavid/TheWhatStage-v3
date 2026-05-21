import { describe, expect, it, vi, beforeEach } from 'vitest'

const { getUserMock, supabaseFromMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  supabaseFromMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: supabaseFromMock,
  }),
}))

import { GET, PUT } from './route'

beforeEach(() => {
  getUserMock.mockReset()
  supabaseFromMock.mockReset()
})

describe('GET /api/chatbot/takeover-settings', () => {
  it('returns 401 without a session', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns default 60 when no chatbot_configs row exists', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }))
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ human_takeover_minutes: 60 })
  })

  it('returns saved value when present', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { human_takeover_minutes: 30 }, error: null }) }),
      }),
    }))
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ human_takeover_minutes: 30 })
  })
})

describe('PUT /api/chatbot/takeover-settings', () => {
  function makeReq(body: unknown): Request {
    return new Request('http://x/api/chatbot/takeover-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('returns 401 without a session', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await PUT(makeReq({ human_takeover_minutes: 30 }))
    expect(res.status).toBe(401)
  })

  it('rejects negative values', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const res = await PUT(makeReq({ human_takeover_minutes: -1 }))
    expect(res.status).toBe(400)
  })

  it('rejects non-integer values', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const res = await PUT(makeReq({ human_takeover_minutes: 12.5 }))
    expect(res.status).toBe(400)
  })

  it('rejects values above 1440', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const res = await PUT(makeReq({ human_takeover_minutes: 1441 }))
    expect(res.status).toBe(400)
  })

  it('upserts on valid input', async () => {
    let upsertedRow: Record<string, unknown> | undefined
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    supabaseFromMock.mockImplementation(() => ({
      upsert: async (row: Record<string, unknown>) => {
        upsertedRow = row
        return { error: null }
      },
    }))
    const res = await PUT(makeReq({ human_takeover_minutes: 30 }))
    expect(res.status).toBe(200)
    expect(upsertedRow).toEqual({ user_id: 'u1', human_takeover_minutes: 30 })
  })

  it('accepts 0 (disables auto-takeover)', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    supabaseFromMock.mockImplementation(() => ({
      upsert: async () => ({ error: null }),
    }))
    const res = await PUT(makeReq({ human_takeover_minutes: 0 }))
    expect(res.status).toBe(200)
  })
})
