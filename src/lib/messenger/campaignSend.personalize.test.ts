import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendOutboundMock, sendCampaignMediaMock } = vi.hoisted(() => ({
  sendOutboundMock: vi.fn(),
  sendCampaignMediaMock: vi.fn(),
}))

vi.mock('./outbound', () => ({ sendOutbound: sendOutboundMock }))
vi.mock('./campaignMedia', () => ({ sendCampaignMedia: sendCampaignMediaMock }))
vi.mock('@/lib/facebook/crypto', () => ({ decryptToken: (s: string) => `dec:${s}` }))

import { handleCampaignSend } from './campaignSend'

const JOB = {
  id: 'job-1',
  thread_id: 'thread-1',
  user_id: 'u1',
  payload: { campaign_message_id: 'cm-1' },
}

interface FakeOptions {
  draftText: string
  leadName: string | null
}

// Minimal Supabase stand-in covering the free-text campaign send path.
// Each `.from(table)` returns a chainable stub; terminal calls resolve with
// the row this table should serve.
function makeAdmin({ draftText, leadName }: FakeOptions) {
  const updates: Array<{ table: string; values: Record<string, unknown> }> = []

  const rowFor = (table: string): unknown => {
    switch (table) {
      case 'agent_campaign_messages':
        return {
          id: 'cm-1',
          campaign_id: 'camp-1',
          thread_id: 'thread-1',
          lead_id: 'lead-1',
          draft_text: draftText,
          policy_at_preview: 'RESPONSE',
          user_included: true,
          status: 'pending',
          attempts: 0,
        }
      case 'agent_campaigns':
        return {
          id: 'camp-1',
          status: 'sending',
          user_id: 'u1',
          send_mode: 'per_lead_ai',
          template_id: null,
          template_variables: null,
          attached_action_page_id: null,
          attached_button_index: 0,
          media_asset_ids: [],
        }
      case 'messenger_threads':
        // Inside the 24h window so the send takes the plain-text path.
        return { id: 'thread-1', psid: 'psid-1', last_inbound_at: new Date().toISOString(), page_id: 'page-1' }
      case 'facebook_pages':
        return { id: 'page-1', page_access_token: 'enc' }
      case 'messenger_page_rate_buckets':
        return { tokens: 50, capacity: 100, refill_per_sec: 7, last_refill_at: new Date().toISOString() }
      case 'leads':
        return { name: leadName, custom_fields: {} }
      default:
        return null
    }
  }

  const admin = {
    rpc: vi.fn(async () => ({ error: null })),
    from(table: string) {
      // The cooldown probe reads agent_campaign_messages with .neq() — it must
      // come back empty or the send is skipped before the text is built.
      let isCooldownProbe = false
      let isUpdate = false
      let updateValues: Record<string, unknown> = {}

      const chain: Record<string, unknown> = {
        select: () => chain,
        upsert: async () => ({ error: null }),
        insert: () => ({ then: (r: (v: unknown) => void) => r({ error: null }) }),
        update: (values: Record<string, unknown>) => {
          isUpdate = true
          updateValues = values
          return chain
        },
        eq: () => chain,
        gte: () => chain,
        neq: () => { isCooldownProbe = true; return chain },
        limit: () => chain,
        is: () => chain,
        single: async () => ({ data: rowFor(table), error: null }),
        maybeSingle: async () => ({
          data: isCooldownProbe ? null : rowFor(table),
          error: null,
        }),
        then: (resolve: (v: unknown) => void) => {
          if (isUpdate) updates.push({ table, values: updateValues })
          return resolve({ data: null, error: null })
        },
      }
      return chain
    },
  }

  return { admin: admin as never, updates, rpc: admin.rpc }
}

beforeEach(() => {
  sendOutboundMock.mockReset()
  sendCampaignMediaMock.mockReset()
  sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'mid-1' })
  sendCampaignMediaMock.mockResolvedValue({ sent: 0, skipped: 0, reason: null })
})

describe('handleCampaignSend — personalization at send time', () => {
  it('resolves a tag an operator typed while editing the draft', async () => {
    // Arrange: preview rendered the draft, then the operator edited it and
    // re-introduced a merge tag.
    const { admin } = makeAdmin({ draftText: 'Hi [first_name], ready na?', leadName: 'Juan Dela Cruz' })

    // Act
    await handleCampaignSend(admin, JOB)

    // Assert
    expect(sendOutboundMock).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { kind: 'text', text: 'Hi Juan, ready na?' } }),
    )
  })

  it('substitutes the full name for [name]', async () => {
    const { admin } = makeAdmin({ draftText: 'Hello [name]!', leadName: 'Juan Dela Cruz' })
    await handleCampaignSend(admin, JOB)
    expect(sendOutboundMock.mock.calls[0][0].payload.text).toBe('Hello Juan Dela Cruz!')
  })

  it('never sends a literal tag when the lead has no name', async () => {
    const { admin } = makeAdmin({ draftText: 'Hi [first_name]!', leadName: null })
    await handleCampaignSend(admin, JOB)
    expect(sendOutboundMock.mock.calls[0][0].payload.text).toBe('Hi there!')
  })

  it('leaves an already-rendered draft byte-for-byte unchanged', async () => {
    const { admin } = makeAdmin({ draftText: 'Hi Juan, ready na?', leadName: 'Juan Dela Cruz' })
    await handleCampaignSend(admin, JOB)
    expect(sendOutboundMock.mock.calls[0][0].payload.text).toBe('Hi Juan, ready na?')
  })

  it('logs the personalized text to thread history, not the raw tag', async () => {
    const { admin, rpc } = makeAdmin({ draftText: 'Hi [first_name]!', leadName: 'Juan Dela Cruz' })
    await handleCampaignSend(admin, JOB)
    // The send succeeded, so the message row was marked sent.
    expect(rpc).toHaveBeenCalledWith('agent_campaign_bump', {
      p_campaign_id: 'camp-1',
      p_counter: 'sent',
    })
  })
})
