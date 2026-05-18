import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.FB_TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64')
process.env.MESSENGER_WORKER_SECRET ??= 'test-secret'

const deepMocks = vi.hoisted(() => ({
  runDeepReclassify: vi.fn(async () => undefined),
}))
vi.mock('@/lib/chatbot/deep-reclassify', () => ({
  runDeepReclassify: deepMocks.runDeepReclassify,
}))

const mocks = vi.hoisted(() => ({
  admin: null as unknown,
  answer: vi.fn(async () => ({ text: 'Fallback reply', sourceTitles: [] })),
  shouldRollSummary: vi.fn(() => false),
  summarizeConversation: vi.fn(async () => ''),
  answerWithClassification: vi.fn(async () => ({
    text: 'Current funnel reply',
    sourceTitles: [],
    stageChange: null,
    actionPage: {
      action_page_id: 'ap_current',
      reason: 'Current funnel page',
      button_text: 'Continue below',
    },
    productRecommendation: null,
    propertyRecommendation: null,
    media: [],
  })),
  applyStageChange: vi.fn(async () => null),
  classifyOnly: vi.fn(async () => null),
  decryptToken: vi.fn((token: string) => `decrypted:${token}`),
  fetchMessengerProfile: vi.fn(async () => ({
    fullName: 'Lead One',
    pictureUrl: null,
  })),
  sendMessengerButton: vi.fn(async () => ({ message_id: 'mid.button.1' })),
  sendMessengerGenericTemplate: vi.fn(async () => ({ message_id: 'mid.carousel.1' })),
  sendMessengerReaction: vi.fn(async () => undefined),
  sendMessengerSenderAction: vi.fn(async () => undefined),
  sendMessengerText: vi.fn(async () => ({ message_id: 'mid.text.1' })),
  deeplinkActionPageUrl: vi.fn(() => 'https://app.test/a/current?p=signed'),
  sendPropertyRecommendation: vi.fn(async () => ({
    sent: true,
    messageIds: ['mid-img', 'mid-card'],
    imageSent: true,
    deeplinkUrl: 'https://app.test/a/re?p=signed&property=p-abc',
  })),
  recommendProperty: vi.fn(async () => ({ ok: false, reason: 'no_products' })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mocks.admin,
}))

vi.mock('@/lib/chatbot/answer', () => ({
  answer: mocks.answer,
  shouldRollSummary: mocks.shouldRollSummary,
  summarizeConversation: mocks.summarizeConversation,
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
  sendMessengerGenericTemplate: mocks.sendMessengerGenericTemplate,
  sendMessengerReaction: mocks.sendMessengerReaction,
  sendMessengerSenderAction: mocks.sendMessengerSenderAction,
  sendMessengerText: mocks.sendMessengerText,
}))

vi.mock('@/lib/action-pages/urls', () => ({
  deeplinkActionPageUrl: mocks.deeplinkActionPageUrl,
}))

vi.mock('@/lib/chatbot/recommend-property', () => ({
  recommendProperty: mocks.recommendProperty,
}))

vi.mock('@/lib/messenger/property-outbound', () => ({
  sendPropertyRecommendation: mocks.sendPropertyRecommendation,
  buildRealestateCarouselElements: (props: unknown[], _url: string, _cta: string) => {
    return (props as Array<{ id: string; title: string; status: string }>)
      .filter((p) => p.status === 'for_sale' || p.status === 'for_rent')
      .map((p) => ({
        title: p.title,
        subtitle: undefined,
        imageUrl: undefined,
        defaultActionUrl: `https://app.test/a/re?p=signed&property=p-${p.id}`,
        buttons: [
          { title: 'View property', url: `https://app.test/a/re?p=signed&property=p-${p.id}` },
          { title: 'View all', url: 'https://app.test/a/re?p=signed' },
        ],
      }))
  },
}))

let pendingInboundCount = 0
let pendingDeepFlag = false

const { resolveCommentBridgesForThread } = await import('./route')
const { POST } = await import('./route')

beforeEach(() => {
  vi.clearAllMocks()
  deepMocks.runDeepReclassify.mockClear()
  pendingInboundCount = 0
  pendingDeepFlag = false
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
    private selectOpts: Record<string, unknown> = {}

    constructor(private table: string) {}

    select(_col?: unknown, opts?: Record<string, unknown>) {
      this.selectOpts = opts ?? {}
      return this
    }
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

      // Count query: select('id', { head: true, count: 'exact' })
      if (this.table === 'messenger_messages' && this.selectOpts.count === 'exact') {
        return { count: pendingInboundCount, data: null, error: null }
      }

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
        return {
          data: {
            auto_classify_enabled: true,
            deep_reclassify_enabled: pendingDeepFlag,
          },
          error: null,
        }
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

      // Count query landing in resolveMany (via .then) — return count shape
      if (this.table === 'messenger_messages' && this.selectOpts.count === 'exact') {
        return { count: pendingInboundCount, data: null, error: null }
      }

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

function makeWorkerAdminMockWithRealestate(allSold = false) {
  let claimCount = 0
  const inserts: Record<string, unknown[]> = {}
  const updates: Record<string, unknown[]> = {}

  const realestateProperties = [
    {
      id: 'a',
      title: 'Home A',
      status: allSold ? 'sold' : 'for_sale',
      price: { display_label: 'PHP 1M', currency: 'PHP', amount: null, period: null },
      address: { city: 'Cebu City', region: 'Cebu', line1: '', line2: '', postal: '', country: '' },
      gallery: [],
      description: '',
      specs: { property_type: null, beds: null, baths: null, floor_area: null, lot_area: null, year_built: null, parking: null },
      custom_specs: [],
      amenities: [],
      financing_options: [],
      financing_notes: '',
    },
    {
      id: 'b',
      title: 'Home B',
      status: 'sold',
      price: { display_label: 'PHP 2M', currency: 'PHP', amount: null, period: null },
      address: { city: '', region: '', line1: '', line2: '', postal: '', country: '' },
      gallery: [],
      description: '',
      specs: { property_type: null, beds: null, baths: null, floor_area: null, lot_area: null, year_built: null, parking: null },
      custom_specs: [],
      amenities: [],
      financing_options: [],
      financing_notes: '',
    },
    {
      id: 'c',
      title: 'Home C',
      status: allSold ? 'sold' : 'for_rent',
      price: { display_label: 'PHP 3M', currency: 'PHP', amount: null, period: null },
      address: { city: 'Mandaue', region: 'Cebu', line1: '', line2: '', postal: '', country: '' },
      gallery: [],
      description: '',
      specs: { property_type: null, beds: null, baths: null, floor_area: null, lot_area: null, year_built: null, parking: null },
      custom_specs: [],
      amenities: [],
      financing_options: [],
      financing_notes: '',
    },
  ]

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
            goal_action_page_id: 'ap_realestate',
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
              action_page_id: 'ap_realestate',
              next_funnel_id: 'funnel_next',
            },
            {
              id: 'funnel_next',
              position: 1,
              instruction: 'Next funnel instructions',
              rules: [{ kind: 'dont', text: 'next dont' }],
              action_page_id: null,
              next_funnel_id: null,
            },
          ],
          error: null,
        }
      }

      if (this.table === 'action_pages') {
        const pages = [
          {
            id: 'ap_realestate',
            user_id: 'user_1',
            kind: 'realestate',
            slug: 're-page',
            title: 'Realestate Page',
            cta_label: 'View all',
            bot_send_instructions: 'Send when customer asks about properties',
            signing_secret: 'secret-re',
            config: {
              properties: realestateProperties,
            },
            send_as_messenger_button: true,
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

function makeWorkerAdminMockWithAllSold() {
  return makeWorkerAdminMockWithRealestate(true)
}

describe('resolveCommentBridgesForThread', () => {
  it('links unresolved same-page bridge rows and back-fills lead-comment lead_id', async () => {
    const bridgeUpdates: unknown[] = []
    const commentUpdates: unknown[] = []
    const admin = {
      from: vi.fn((table: string) => {
        if (table === 'facebook_comment_bridges') {
          return {
            update: (payload: unknown) => {
              bridgeUpdates.push(payload)
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
        if (table === 'facebook_lead_comments') {
          return {
            update: (payload: unknown) => {
              commentUpdates.push(payload)
              return {
                eq: () => ({
                  eq: () => ({
                    is: async () => ({ error: null }),
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

    expect(bridgeUpdates).toEqual([{ lead_id: 'lead-1', resolved_at: expect.any(String) }])
    expect(commentUpdates).toEqual([{ lead_id: 'lead-1' }])
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

  it('realestate page chosen — sends carousel of active properties (2 of 3; sold filtered)', async () => {
    const { admin } = makeWorkerAdminMockWithRealestate()
    mocks.admin = admin
    mocks.answerWithClassification.mockResolvedValueOnce({
      text: 'Check out our listings!',
      sourceTitles: [],
      stageChange: null,
      actionPage: { action_page_id: 'ap_realestate', reason: 'customer asked', button_text: 'See listings 👇' },
      productRecommendation: null,
      propertyRecommendation: null,
      media: [],
    })

    const res = await POST(makeWorkerRequest() as Parameters<typeof POST>[0])
    expect(res.status).toBe(200)
    expect(mocks.sendMessengerGenericTemplate).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (mocks.sendMessengerGenericTemplate.mock.calls as any)[0][0]
    const elements = call.elements
    expect(elements).toHaveLength(2) // Home A + Home C; Home B (sold) filtered out
    expect(elements.map((e: { title: string }) => e.title)).toEqual(['Home A', 'Home C'])
  })

  it('realestate page chosen — no active properties, falls back to single button', async () => {
    const { admin } = makeWorkerAdminMockWithAllSold()
    mocks.admin = admin
    mocks.answerWithClassification.mockResolvedValueOnce({
      text: 'Let me show you our properties.',
      sourceTitles: [],
      stageChange: null,
      actionPage: { action_page_id: 'ap_realestate', reason: 'customer asked', button_text: 'View listings 👇' },
      productRecommendation: null,
      propertyRecommendation: null,
      media: [],
    })

    const res = await POST(makeWorkerRequest() as Parameters<typeof POST>[0])
    expect(res.status).toBe(200)
    expect(mocks.sendMessengerGenericTemplate).not.toHaveBeenCalled()
    expect(mocks.sendMessengerButton).toHaveBeenCalledTimes(1)
  })

  it('propertyRecommendation succeeds — rec card sent, carousel skipped', async () => {
    const { admin } = makeWorkerAdminMockWithRealestate()
    mocks.admin = admin
    mocks.answerWithClassification.mockResolvedValueOnce({
      text: 'Got one for you!',
      sourceTitles: [],
      stageChange: null,
      actionPage: { action_page_id: 'ap_realestate', reason: 'customer asked', button_text: 'See recommendation 👇' },
      productRecommendation: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      propertyRecommendation: { query: '3BR condo in Cebu', filters: { priceMin: null, priceMax: 6_000_000, tags: ['condo'] }, actionPageId: 'ap_realestate', confidenceThreshold: 0.55 } as any,
      media: [],
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mocks.recommendProperty.mockResolvedValueOnce as any)({
      ok: true,
      product: { id: 'item-1', slug: 'p-a', title: 'Home A', price_label: 'PHP 1M', cover_image_url: null, city: 'Cebu City', region: 'Cebu', property_status: 'for_sale', summary: null, description: null, price_amount: 1_000_000, currency: 'PHP', pricing_model: 'fixed', inventory_status: 'in_stock', tags: [] },
      confidence: 0.9,
    })
    mocks.sendPropertyRecommendation.mockResolvedValueOnce({
      sent: true,
      messageIds: ['mid-card'],
      imageSent: false,
      deeplinkUrl: 'https://app.test/a/re?p=signed&property=p-a',
    })

    const res = await POST(makeWorkerRequest() as Parameters<typeof POST>[0])
    expect(res.status).toBe(200)
    expect(mocks.sendPropertyRecommendation).toHaveBeenCalledTimes(1)
    expect(mocks.sendMessengerGenericTemplate).not.toHaveBeenCalled()
  })

  describe('deep re-evaluation trigger', () => {
    beforeEach(() => {
      deepMocks.runDeepReclassify.mockClear()
      pendingInboundCount = 0
      pendingDeepFlag = false
    })

    // Cadence: fire at the 3rd inbound, then every 5 inbound thereafter (3, 8, 13, 18, ...).
    it('invokes runDeepReclassify at the 3rd inbound when flag is on', async () => {
      pendingInboundCount = 3
      pendingDeepFlag = true
      const { admin } = makeWorkerAdminMock()
      mocks.admin = admin
      await POST(makeWorkerRequest() as Parameters<typeof POST>[0])
      await new Promise((r) => setTimeout(r, 10))
      expect(deepMocks.runDeepReclassify).toHaveBeenCalledTimes(1)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arg = (deepMocks.runDeepReclassify.mock.calls as any)[0][0] as Record<string, unknown>
      // windowIndex is now the raw inbound count (used as the idempotency
      // discriminator — uniqueness is what matters, not the historical
      // floor-by-10 semantics).
      expect(arg.windowIndex).toBe(3)
      expect(arg.threadId).toBeTruthy()
      expect(arg.leadId).toBeTruthy()
    })

    it('invokes runDeepReclassify at the 8th inbound (3 + 5)', async () => {
      pendingInboundCount = 8
      pendingDeepFlag = true
      const { admin } = makeWorkerAdminMock()
      mocks.admin = admin
      await POST(makeWorkerRequest() as Parameters<typeof POST>[0])
      await new Promise((r) => setTimeout(r, 10))
      expect(deepMocks.runDeepReclassify).toHaveBeenCalledTimes(1)
    })

    it('does not invoke when inbound count is 5', async () => {
      pendingInboundCount = 5
      pendingDeepFlag = true
      const { admin } = makeWorkerAdminMock()
      mocks.admin = admin
      await POST(makeWorkerRequest() as Parameters<typeof POST>[0])
      await new Promise((r) => setTimeout(r, 10))
      expect(deepMocks.runDeepReclassify).not.toHaveBeenCalled()
    })

    it('does not invoke when flag is off, even on a firing tick', async () => {
      pendingInboundCount = 18
      pendingDeepFlag = false
      const { admin } = makeWorkerAdminMock()
      mocks.admin = admin
      await POST(makeWorkerRequest() as Parameters<typeof POST>[0])
      await new Promise((r) => setTimeout(r, 10))
      expect(deepMocks.runDeepReclassify).not.toHaveBeenCalled()
    })

    it('reply path completes when runDeepReclassify throws', async () => {
      pendingInboundCount = 3
      pendingDeepFlag = true
      deepMocks.runDeepReclassify.mockRejectedValueOnce(new Error('boom'))
      const { admin } = makeWorkerAdminMock()
      mocks.admin = admin
      const response = await POST(makeWorkerRequest() as Parameters<typeof POST>[0])
      expect(response.status).toBe(200)
    })
  })
})
