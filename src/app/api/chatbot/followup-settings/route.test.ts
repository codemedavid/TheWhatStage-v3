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
import { DEFAULT_FOLLOWUP_SETTINGS } from '@/lib/followups/settings'

function asJson(res: Response) {
  return res.json()
}

beforeEach(() => {
  getUserMock.mockReset()
  supabaseFromMock.mockReset()
})

describe('GET /api/chatbot/followup-settings', () => {
  it('returns 401 without a session', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await GET(new Request('http://x/api/chatbot/followup-settings'))
    expect(res.status).toBe(401)
  })

  it('returns defaults when no chatbot_configs row exists', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }))
    const res = await GET(new Request('http://x/api/chatbot/followup-settings'))
    expect(res.status).toBe(200)
    expect(await asJson(res)).toEqual({ settings: DEFAULT_FOLLOWUP_SETTINGS })
  })

  it('returns saved settings when present', async () => {
    const stored = { ...DEFAULT_FOLLOWUP_SETTINGS, enabled: false }
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { followup_settings: stored }, error: null }),
        }),
      }),
    }))
    const res = await GET(new Request('http://x/api/chatbot/followup-settings'))
    expect(res.status).toBe(200)
    expect(await asJson(res)).toEqual({ settings: stored })
  })
})

describe('PUT /api/chatbot/followup-settings', () => {
  function makeReq(body: unknown): Request {
    return new Request('http://x/api/chatbot/followup-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('returns 401 without a session', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await PUT(makeReq({ settings: DEFAULT_FOLLOWUP_SETTINGS }))
    expect(res.status).toBe(401)
  })

  it('returns 400 on invalid shape', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const res = await PUT(makeReq({ settings: { enabled: 'yes', touchpoints: [] } }))
    expect(res.status).toBe(400)
    const body = (await asJson(res)) as { error: string }
    expect(body.error).toBeTruthy()
  })

  it('saves valid settings and returns them', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    supabaseFromMock.mockImplementation(() => ({
      upsert: vi.fn(async () => ({ error: null })),
    }))

    const desired = { ...DEFAULT_FOLLOWUP_SETTINGS, enabled: false }
    const putRes = await PUT(makeReq({ settings: desired }))
    expect(putRes.status).toBe(200)
    expect(await asJson(putRes)).toEqual({ settings: desired })
  })
})
