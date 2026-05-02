import { describe, expect, it, vi, beforeEach } from 'vitest'
import { buildDeeplinkParams } from '@/lib/action-pages/signing'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  admin: null as unknown,
  decryptToken: vi.fn((token: string) => `decrypted:${token}`),
  sendMessengerText: vi.fn(async () => ({ message_id: 'mid.echo.1' })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mocks.admin,
}))

vi.mock('@/lib/facebook/crypto', () => ({
  decryptToken: mocks.decryptToken,
}))

vi.mock('@/lib/facebook/messenger', () => ({
  sendMessengerText: mocks.sendMessengerText,
}))

function makeActionPageConfig() {
  return {
    theme: {
      background_color: '#ffffff',
      accent_color: '#059669',
      button_text_color: '#ffffff',
    },
    branding: {},
    blocks: [],
    submit_button_label: 'Submit',
    success_message: 'Thanks',
  }
}

function makeJsonRequest(body: Record<string, unknown>): Request {
  return new Request('https://app.test/api/action-pages/submit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'vitest',
      'x-forwarded-for': '203.0.113.10',
    },
    body: JSON.stringify(body),
  })
}

function makeAdminMock() {
  const inserts: Record<string, unknown[]> = {}
  const updates: Record<string, unknown[]> = {}

  const from = vi.fn((table: string) => {
    if (table === 'action_pages') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: {
                id: 'ap_1',
                user_id: 'user_1',
                kind: 'form',
                slug: 'welcome-form',
                status: 'published',
                config: makeActionPageConfig(),
                pipeline_rules: [],
                notification_template: { text: 'Thanks, we received it.' },
                signing_secret: 'secret',
              },
              error: null,
            })),
          })),
        })),
      }
    }

    if (table === 'messenger_threads') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { id: 'thread_1', lead_id: 'lead_1' },
                error: null,
              })),
            })),
          })),
        })),
        update: vi.fn((payload) => {
          updates[table] = [...(updates[table] ?? []), payload]
          return {
            eq: vi.fn(async () => ({ error: null })),
          }
        }),
      }
    }

    if (table === 'funnels') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: {
                  id: 'funnel_1',
                  action_page_id: 'ap_1',
                  next_funnel_id: 'funnel_2',
                },
                error: null,
              })),
            })),
          })),
        })),
      }
    }

    if (table === 'leads') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { current_funnel_id: 'funnel_1' },
                error: null,
              })),
            })),
          })),
        })),
        update: vi.fn((payload) => {
          updates[table] = [...(updates[table] ?? []), payload]
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(async () => ({ error: null })),
            })),
          }
        }),
      }
    }

    if (table === 'action_page_submissions') {
      return {
        insert: vi.fn((payload) => {
          inserts[table] = [...(inserts[table] ?? []), payload]
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: { id: 'sub_1' },
                error: null,
              })),
            })),
          }
        }),
      }
    }

    if (table === 'facebook_pages') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { page_access_token: 'encrypted-page-token' },
              error: null,
            })),
          })),
        })),
      }
    }

    if (table === 'messenger_messages') {
      return {
        insert: vi.fn(async (payload) => {
          inserts[table] = [...(inserts[table] ?? []), payload]
          return { error: null }
        }),
      }
    }

    throw new Error(`unexpected table ${table}`)
  })

  return { admin: { from }, inserts, updates }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/action-pages/submit', () => {
  it('records a successful Messenger completion echo in the local thread', async () => {
    const { admin, inserts, updates } = makeAdminMock()
    mocks.admin = admin

    const params = buildDeeplinkParams('secret', {
      slug: 'welcome-form',
      psid: 'psid_1',
      pageId: 'fb_page_1',
      exp: Math.floor(Date.now() / 1000) + 60,
    })

    const res = await POST(
      makeJsonRequest({
        slug: 'welcome-form',
        data: {},
        p: params.get('p'),
        g: params.get('g'),
        e: params.get('e'),
        t: params.get('t'),
      }) as Parameters<typeof POST>[0],
    )

    expect(res.status).toBe(200)
    expect(mocks.sendMessengerText).toHaveBeenCalledWith({
      pageAccessToken: 'decrypted:encrypted-page-token',
      recipientPsid: 'psid_1',
      text: 'Thanks, we received it.',
    })
    expect(inserts.messenger_messages).toEqual([
      {
        thread_id: 'thread_1',
        user_id: 'user_1',
        direction: 'outbound',
        sender: 'bot',
        fb_message_id: 'mid.echo.1',
        body: 'Thanks, we received it.',
      },
    ])
    expect(updates.messenger_threads).toEqual([
      expect.objectContaining({
        last_message_preview: 'Thanks, we received it.',
      }),
    ])
  })

  it('does not send a Messenger completion echo for standalone submissions', async () => {
    const { admin, inserts } = makeAdminMock()
    mocks.admin = admin

    const res = await POST(
      makeJsonRequest({
        slug: 'welcome-form',
        data: {},
      }) as Parameters<typeof POST>[0],
    )

    expect(res.status).toBe(200)
    expect(mocks.sendMessengerText).not.toHaveBeenCalled()
    expect(inserts.messenger_messages).toBeUndefined()
  })

  it('advances the lead to the next funnel when the current funnel action page is submitted', async () => {
    const { admin, updates } = makeAdminMock()
    mocks.admin = admin

    const params = buildDeeplinkParams('secret', {
      slug: 'welcome-form',
      psid: 'psid_1',
      pageId: 'fb_page_1',
      exp: Math.floor(Date.now() / 1000) + 60,
    })

    const res = await POST(
      makeJsonRequest({
        slug: 'welcome-form',
        data: {},
        p: params.get('p'),
        g: params.get('g'),
        e: params.get('e'),
        t: params.get('t'),
      }) as Parameters<typeof POST>[0],
    )

    expect(res.status).toBe(200)
    expect(updates.leads).toContainEqual({ current_funnel_id: 'funnel_2' })
  })
})
