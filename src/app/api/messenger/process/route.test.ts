import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.FB_TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64')
process.env.MESSENGER_WORKER_SECRET ??= 'test-secret'

const mocks = vi.hoisted(() => ({
  admin: null as unknown,
  answer: vi.fn(async () => ({ text: 'Fallback reply', sourceTitles: [] })),
  answerWithClassification: vi.fn(async () => ({
    text: 'Current funnel reply',
    sourceTitles: [],
    stageChange: null,
    actionPage: {
      action_page_id: 'ap_current',
      reason: 'Current funnel page',
      button_text: 'Continue below',
    },
  })),
  applyStageChange: vi.fn(async () => null),
  classifyOnly: vi.fn(async () => null),
  decryptToken: vi.fn((token: string) => `decrypted:${token}`),
  fetchMessengerProfile: vi.fn(async () => ({
    fullName: 'Lead One',
    pictureUrl: null,
  })),
  sendMessengerButton: vi.fn(async () => ({ message_id: 'mid.button.1' })),
  sendMessengerReaction: vi.fn(async () => undefined),
  sendMessengerSenderAction: vi.fn(async () => undefined),
  sendMessengerText: vi.fn(async () => ({ message_id: 'mid.text.1' })),
  deeplinkActionPageUrl: vi.fn(() => 'https://app.test/a/current?p=signed'),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mocks.admin,
}))

vi.mock('@/lib/chatbot/answer', () => ({
  answer: mocks.answer,
}))

vi.mock('@/lib/chatbot/classify', () => ({
  answerWithClassification: mocks.answerWithClassification,
  applyStageChange: mocks.applyStageChange,
  classifyOnly: mocks.classifyOnly,
}))

vi.mock('@/lib/facebook/crypto', () => ({
  decryptToken: mocks.decryptToken,
}))

vi.mock('@/lib/facebook/messenger', () => ({
  fetchMessengerProfile: mocks.fetchMessengerProfile,
  sendMessengerButton: mocks.sendMessengerButton,
  sendMessengerReaction: mocks.sendMessengerReaction,
  sendMessengerSenderAction: mocks.sendMessengerSenderAction,
  sendMessengerText: mocks.sendMessengerText,
}))

vi.mock('@/lib/action-pages/urls', () => ({
  deeplinkActionPageUrl: mocks.deeplinkActionPageUrl,
}))

const { resolveCommentBridgesForThread } = await import('./route')
const { POST } = await import('./route')

beforeEach(() => {
  vi.clearAllMocks()
})

function makeWorkerRequest(): Request {
  return new Request('https://app.test/api/messenger/process', {
    method: 'POST',
    headers: { 'x-worker-secret': 'test-secret' },
  })
}

function makeWorkerAdminMock() {
  let claimCount = 0
  const inserts: Record<string, unknown[]> = {}
  const updates: Record<string, unknown[]> = {}

  class Query {
    private filters: Record<string, unknown> = {}
    private updatePayload: unknown = null
    private insertPayload: unknown = null

    constructor(private table: string) {}

    select() { return this }
    eq(key: string, value: unknown) {
      this.filters[key] = value
      return this
    }
    neq() { return this }
    not() { return this }
    is() { return this }
    gt() { return this }
    order() { return this }
    limit() { return this }
    update(payload: unknown) {
      this.updatePayload = payload
      updates[this.table] = [...(updates[this.table] ?? []), payload]
      return this
    }
    insert(payload: unknown) {
      this.insertPayload = payload
      inserts[this.table] = [...(inserts[this.table] ?? []), payload]
      return {
        error: null,
        select: () => ({
          single: async () => ({ data: { id: 'inserted-id' }, error: null }),
        }),
      }
    }
    async single() {
      return this.resolveSingle()
    }
    async maybeSingle() {
      return this.resolveSingle()
    }
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return this.resolveMany().then(onfulfilled, onrejected)
    }

    private async resolveSingle() {
      if (this.updatePayload) return { data: null, error: null }

      if (this.table === 'messenger_messages') {
        return {
          data: {
            body: 'I want to continue',
            fb_message_id: 'mid.inbound.1',
            messenger_threads: {
              id: 'thread_1',
              user_id: 'user_1',
              page_id: 'fb_page_1',
              psid: 'psid_1',
              lead_id: 'lead_1',
              full_name: 'Lead One',
              auto_reply_enabled: true,
              inbound_since_classify: 0,
            },
          },
          error: null,
        }
      }

      if (this.table === 'facebook_pages') {
        return {
          data: {
            id: 'fb_page_1',
            page_access_token: 'encrypted-page-token',
            name: 'Page One',
          },
          error: null,
        }
      }

      if (this.table === 'chatbot_configs') {
        return { data: { auto_classify_enabled: true }, error: null }
      }

      if (this.table === 'leads') {
        return {
          data: {
            stage_id: 'stage_current',
            campaign_id: 'campaign_1',
            current_funnel_id: 'funnel_current',
          },
          error: null,
        }
      }

      if (this.table === 'campaigns') {
        return {
          data: {
            id: 'campaign_1',
            personality_mode: 'custom',
            persona: 'Campaign persona',
            do_rules: ['campaign do'],
            dont_rules: ['campaign dont'],
            goal_action_page_id: 'ap_goal',
          },
          error: null,
        }
      }

      return { data: null, error: null }
    }

    private async resolveMany() {
      if (this.updatePayload) return { data: null, error: null }

      if (this.table === 'messenger_messages') {
        return { data: [], error: null }
      }

      if (this.table === 'pipeline_stages') {
        return {
          data: [
            { id: 'stage_current', name: 'Current', description: 'Current stage' },
            { id: 'stage_next', name: 'Next', description: 'Next stage' },
          ],
          error: null,
        }
      }

      if (this.table === 'funnels') {
        return {
          data: [
            {
              id: 'funnel_current',
              position: 0,
              instruction: 'Current funnel instructions',
              rules: [{ kind: 'do', text: 'current do' }],
              action_page_id: 'ap_current',
              next_funnel_id: 'funnel_next',
            },
            {
              id: 'funnel_next',
              position: 1,
              instruction: 'Next funnel instructions',
              rules: [{ kind: 'dont', text: 'next dont' }],
              action_page_id: 'ap_next',
              next_funnel_id: null,
            },
          ],
          error: null,
        }
      }

      if (this.table === 'action_pages') {
        const pages = [
          {
            id: 'ap_current',
            slug: 'current',
            title: 'Current action page',
            cta_label: 'Continue',
            bot_send_instructions: 'Send for current funnel only',
            signing_secret: 'secret-current',
          },
          {
            id: 'ap_goal',
            slug: 'goal',
            title: 'Campaign goal page',
            cta_label: 'Goal',
            bot_send_instructions: 'Send for campaign goal',
            signing_secret: 'secret-goal',
          },
        ]
        return {
          data: this.filters.id ? pages.filter((p) => p.id === this.filters.id) : pages,
          error: null,
        }
      }

      return { data: [], error: null }
    }
  }

  const admin = {
    rpc: vi.fn(async (name: string) => {
      if (name !== 'claim_messenger_jobs') throw new Error(name)
      claimCount += 1
      return {
        data:
          claimCount === 1
            ? [
                {
                  id: 'job_1',
                  thread_id: 'thread_1',
                  inbound_msg_id: 'msg_inbound_1',
                  user_id: 'user_1',
                  attempts: 0,
                  outbound_text_fb_id: null,
                  outbound_button_fb_id: null,
                },
              ]
            : [],
        error: null,
      }
    }),
    from: vi.fn((table: string) => new Query(table)),
  }

  return { admin, inserts, updates }
}

describe('resolveCommentBridgesForThread', () => {
  it('links unresolved same-page bridge rows to an existing lead', async () => {
    const updates: unknown[] = []
    const admin = {
      from: vi.fn((table: string) => {
        if (table === 'facebook_comment_bridges') {
          return {
            update: (payload: unknown) => {
              updates.push(payload)
              return {
                eq: () => ({
                  eq: () => ({
                    is: () => ({ gt: async () => ({ error: null }) }),
                  }),
                }),
              }
            },
          }
        }
        throw new Error(table)
      }),
    }

    await resolveCommentBridgesForThread(admin as never, {
      pageId: 'page-1',
      psid: 'psid-1',
      leadId: 'lead-1',
    })

    expect(updates).toEqual([{ lead_id: 'lead-1', resolved_at: expect.any(String) }])
  })

  it('does nothing when leadId is null', async () => {
    const admin = { from: vi.fn() }
    await resolveCommentBridgesForThread(admin as never, {
      pageId: 'page-1',
      psid: 'psid-1',
      leadId: null,
    })
    expect(admin.from).not.toHaveBeenCalled()
  })
})

describe('POST /api/messenger/process', () => {
  it('prioritizes the lead current funnel instructions and action page', async () => {
    const { admin } = makeWorkerAdminMock()
    mocks.admin = admin

    const res = await POST(makeWorkerRequest() as Parameters<typeof POST>[0])

    expect(res.status).toBe(200)
    expect(mocks.answerWithClassification).toHaveBeenCalledTimes(1)
    const options = (mocks.answerWithClassification.mock.calls[0] as unknown[])[6]
    expect(options).toMatchObject({
      actionPages: [
        {
          id: 'ap_current',
          title: 'Current action page',
          cta_label: 'Continue',
          bot_send_instructions: 'Send for current funnel only',
        },
      ],
      campaignPersona: {
        persona: 'Campaign persona',
        doRules: ['campaign do', 'current do'],
        dontRules: ['campaign dont'],
        funnelInstruction: 'Current funnel instructions',
      },
    })
    expect(mocks.sendMessengerButton).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://app.test/a/current?p=signed',
        ctaLabel: 'Continue',
      }),
    )
  })
})
