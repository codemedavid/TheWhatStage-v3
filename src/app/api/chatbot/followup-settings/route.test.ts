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
    const upsertSpy = vi.fn(async () => ({ error: null }))
    supabaseFromMock.mockImplementation(() => ({ upsert: upsertSpy }))

    const desired = { ...DEFAULT_FOLLOWUP_SETTINGS, enabled: false }
    const putRes = await PUT(makeReq({ settings: desired }))
    expect(putRes.status).toBe(200)
    expect(await asJson(putRes)).toEqual({ settings: desired })
    expect(upsertSpy).toHaveBeenCalledWith(
      { user_id: 'u1', followup_settings: desired },
      { onConflict: 'user_id' },
    )
  })

  it('accepts payloads missing the instruction field and defaults to ""', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    let captured: unknown = null
    const upsertSpy = vi.fn(async (row: unknown) => {
      captured = row
      return { error: null }
    })
    supabaseFromMock.mockImplementation(() => ({ upsert: upsertSpy }))

    const legacyPayload = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t) => ({
        enabled: t.enabled,
        offset_ms: t.offset_ms,
      })),
    }
    const res = await PUT(makeReq({ settings: legacyPayload }))
    expect(res.status).toBe(200)
    const stored = (captured as { user_id: string; followup_settings: { touchpoints: Array<{ instruction: string }> } })
      .followup_settings
    for (const tp of stored.touchpoints) {
      expect(tp.instruction).toBe('')
    }
  })

  it('round-trips a payload with instructions set', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const upsertSpy = vi.fn(async () => ({ error: null }))
    supabaseFromMock.mockImplementation(() => ({ upsert: upsertSpy }))

    const withInstrs = {
      ...DEFAULT_FOLLOWUP_SETTINGS,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        ...t,
        instruction: `step ${i + 1} guide`,
      })),
    }
    const res = await PUT(makeReq({ settings: withInstrs }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { settings: typeof withInstrs }
    expect(body.settings.touchpoints.map((t) => t.instruction)).toEqual([
      'step 1 guide', 'step 2 guide', 'step 3 guide', 'step 4 guide',
      'step 5 guide', 'step 6 guide', 'step 7 guide',
    ])
  })

  it('rejects an instruction longer than 200 chars with 400', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const bad = {
      ...DEFAULT_FOLLOWUP_SETTINGS,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        ...t,
        instruction: i === 0 ? 'x'.repeat(201) : '',
      })),
    }
    const res = await PUT(makeReq({ settings: bad }))
    expect(res.status).toBe(400)
  })
})
