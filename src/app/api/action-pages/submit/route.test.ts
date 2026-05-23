import { describe, expect, it, vi, beforeEach } from 'vitest'
import { buildDeeplinkParams } from '@/lib/action-pages/signing'
import { POST } from './route'

const mocks = vi.hoisted(() => ({
  admin: null as unknown,
  decryptToken: vi.fn((token: string) => `decrypted:${token}`),
  sendMessengerText: vi.fn(async () => ({ message_id: 'mid.echo.1' })),
  sendOutbound: vi.fn(async () => ({ sent: true, messageId: 'mid.outbound.1' })),
  dispatchCapiEvent: vi.fn(async () => undefined),
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

vi.mock('@/lib/messenger/outbound', () => ({
  sendOutbound: mocks.sendOutbound,
}))

vi.mock('@/lib/action-pages/urls', () => ({
  deeplinkActionPageUrl: vi.fn(() => 'https://app.test/a/book-call?p=signed'),
}))

vi.mock('@/lib/facebook/capi', () => ({
  dispatchCapiEvent: mocks.dispatchCapiEvent,
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
      const threadData = { id: 'thread_1', lead_id: 'lead_1', last_inbound_at: new Date().toISOString() }
      const maybeSingleFn = vi.fn(async () => ({ data: threadData, error: null }))
      const innerEq = vi.fn(() => ({ maybeSingle: maybeSingleFn }))
      const outerEq = vi.fn(() => ({ eq: innerEq, maybeSingle: maybeSingleFn }))
      return {
        select: vi.fn(() => ({ eq: outerEq })),
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

    if (table === 'pipeline_stages') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({ data: null, error: null })),
                })),
              })),
            })),
          })),
        })),
      }
    }

    throw new Error(`unexpected table ${table}`)
  })

  const rpc = vi.fn(async () => ({ data: true, error: null }))
  return { admin: { from, rpc }, inserts, updates }
}

function makeQualificationAdminMock() {
  const inserts: Record<string, unknown[]> = {}
  const rpc = vi.fn(async () => ({ data: true, error: null }))
  const pageRows: Record<string, Record<string, unknown>> = {
    qualify: {
      id: '00000000-0000-0000-0000-000000000010',
      user_id: 'user_1',
      kind: 'qualification',
      slug: 'qualify',
      status: 'published',
      config: {
        theme: {
          background_color: '#FFFFFF',
          accent_color: '#059669',
          button_text_color: '#FFFFFF',
        },
        progress_bar: true,
        questions: [
          {
            id: 'budget',
            prompt: 'Budget?',
            kind: 'single_choice',
            required: true,
            weight: 1,
            options: [{ label: 'Ready', value: 'ready', score: 5 }],
          },
        ],
        scoring: { mode: 'rule_based', threshold: 5 },
        outcomes: [
          {
            id: 'qualified',
            label: 'Qualified',
            outcome: 'qualified',
            match: { kind: 'score_at_least', value: 5 },
            to_stage_id: null,
            messenger_text: 'You qualify. Book the next step.',
            attach_action_page_id: '00000000-0000-0000-0000-000000000020',
            attach_cta_label: 'Book now',
            public_message: 'You qualify. We sent the next step in Messenger.',
          },
        ],
      },
      pipeline_rules: [],
      notification_template: { text: 'Global fallback' },
      signing_secret: 'secret',
    },
    booking: {
      id: '00000000-0000-0000-0000-000000000020',
      user_id: 'user_1',
      kind: 'booking',
      slug: 'book-call',
      title: 'Book a call',
      status: 'published',
      config: {},
      pipeline_rules: [],
      notification_template: null,
      cta_label: 'Book call',
      signing_secret: 'booking-secret',
    },
  }

  const from = vi.fn((table: string) => {
    if (table === 'action_pages') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((col: string, value: string) => ({
            maybeSingle: vi.fn(async () => {
              if (col === 'slug') return { data: pageRows[value], error: null }
              if (col === 'id') return { data: pageRows.booking, error: null }
              return { data: null, error: null }
            }),
          })),
        })),
      }
    }
    if (table === 'messenger_threads') {
      const threadRow = { id: 'thread_1', lead_id: 'lead_1', last_inbound_at: new Date().toISOString() }
      const maybeSingleFn = vi.fn(async () => ({ data: threadRow, error: null }))
      const innerEq = vi.fn(() => ({ maybeSingle: maybeSingleFn }))
      const outerEq = vi.fn(() => ({ eq: innerEq, maybeSingle: maybeSingleFn }))
      return {
        select: vi.fn(() => ({ eq: outerEq })),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      }
    }
    if (table === 'action_page_submissions') {
      return {
        insert: vi.fn((payload) => {
          inserts[table] = [...(inserts[table] ?? []), payload]
          return { select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: 'sub_1' }, error: null })) })) }
        }),
      }
    }
    if (table === 'pipeline_stages') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: { id: '00000000-0000-0000-0000-000000000030' },
                    error: null,
                  })),
                })),
              })),
            })),
          })),
        })),
      }
    }
    if (table === 'facebook_pages') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { page_access_token: 'encrypted-page-token' }, error: null })),
          })),
        })),
      }
    }
    if (table === 'messenger_messages') {
      return { insert: vi.fn(async (payload) => {
        inserts[table] = [...(inserts[table] ?? []), payload]
        return { error: null }
      }) }
    }
    if (table === 'leads') {
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })) })),
      }
    }
    if (table === 'funnels') {
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })) })),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })

  return { admin: { from, rpc }, inserts, rpc }
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
    expect(mocks.sendOutbound).toHaveBeenCalledWith(expect.objectContaining({
      payload: { kind: 'text', text: 'Thanks, we received it.' },
      kind: 'submission_echo',
    }))
    expect(inserts.messenger_messages).toEqual([
      {
        thread_id: 'thread_1',
        user_id: 'user_1',
        direction: 'outbound',
        sender: 'bot',
        fb_message_id: 'mid.outbound.1',
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
    expect(mocks.sendOutbound).not.toHaveBeenCalled()
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

  it('calls dispatchCapiEvent with the submission context when CAPI plumbing is reachable', async () => {
    const { admin } = makeAdminMock()
    mocks.admin = admin
    mocks.dispatchCapiEvent.mockClear()
    const deeplinkParams = buildDeeplinkParams('secret', {
      slug: 'welcome-form',
      psid: 'PSID42',
      pageId: 'page-1',
      exp: Math.floor(Date.now() / 1000) + 60,
    })
    const req = makeJsonRequest({
      slug: 'welcome-form',
      data: { full_name: 'Ada Lovelace', email: 'ada@example.com' },
      p: deeplinkParams.get('p'),
      g: deeplinkParams.get('g'),
      e: deeplinkParams.get('e'),
      t: deeplinkParams.get('t'),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(mocks.dispatchCapiEvent).toHaveBeenCalledTimes(1)
    const call = mocks.dispatchCapiEvent.mock.calls[0][0]
    expect(call).toMatchObject({
      userId: 'user_1',
      actionPageKind: 'form',
      actionPageSlug: 'welcome-form',
      outcome: 'submitted',
      psid: 'PSID42',
      pageRowId: 'page-1',
    })
  })

  it('moves by default stage and sends outcome message plus attached action page', async () => {
    const { admin, rpc } = makeQualificationAdminMock()
    mocks.admin = admin

    const params = buildDeeplinkParams('secret', {
      slug: 'qualify',
      psid: 'psid_1',
      pageId: 'fb_page_1',
      exp: Math.floor(Date.now() / 1000) + 60,
    })

    const res = await POST(
      makeJsonRequest({
        slug: 'qualify',
        data: { answers: JSON.stringify({ budget: 'ready' }) },
        p: params.get('p'),
        g: params.get('g'),
        e: params.get('e'),
        t: params.get('t'),
      }) as Parameters<typeof POST>[0],
    )

    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('set_lead_stage', expect.objectContaining({
      p_to_stage_id: '00000000-0000-0000-0000-000000000030',
      p_reason: 'outcome: qualified',
    }))
    expect(mocks.sendOutbound).toHaveBeenCalledWith(expect.objectContaining({
      payload: { kind: 'text', text: 'You qualify. Book the next step.' },
      kind: 'submission_echo',
    }))
    expect(mocks.sendOutbound).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        kind: 'button',
        text: 'Book a call',
        ctaLabel: 'Book now',
      }),
      kind: 'submission_echo',
    }))
  })
})
