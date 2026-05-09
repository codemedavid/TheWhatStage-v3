import { describe, expect, it, vi, beforeEach } from 'vitest'

const sendOutboundMock = vi.hoisted(() => vi.fn(async () => ({ sent: true, messageId: 'mid_1' })))
vi.mock('@/lib/messenger/outbound', () => ({
  sendOutbound: sendOutboundMock,
}))

// executor.ts imports decryptToken from crypto — that module throws at load time
// when FB_TOKEN_ENCRYPTION_KEY is not set. Stub it out for unit tests.
vi.mock('@/lib/facebook/crypto', () => ({
  encryptToken: vi.fn((s: string) => s),
  decryptToken: vi.fn((s: string) => s),
}))

// createAdminClient also reads env vars at import time; stub the factory.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({})),
}))

import { handleSendForTest } from './executor'
import type { SendNodeConfig } from './types'

const makeAdmin = (templateRow: unknown) => {
  const from = vi.fn((table: string) => {
    if (table === 'messenger_message_templates') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: templateRow, error: null })),
          })),
        })),
      }
    }
    if (table === 'booking_events') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { event_at: '2026-06-01T01:00:00Z', timezone: 'UTC', title: 'My Booking' },
              error: null,
            })),
          })),
        })),
      }
    }
    if (table === 'action_pages') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })),
        })),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  return { from } as never
}

const baseCtx = {
  thread: { id: 't1', psid: 'ps1', last_inbound_at: null },
  pageToken: 'tok',
  lead: { name: 'Sarah', custom_fields: { city: 'Manila' } },
  run: {
    id: 'run_1',
    state: { variables: { booking_event_id: 'be_1' } },
  },
}

describe('executor handleSend — utility_template', () => {
  beforeEach(() => sendOutboundMock.mockClear())

  it('skips with policy_blocked when template is not approved', async () => {
    const admin = makeAdmin({
      id: 'tpl_1',
      meta_status: 'pending',
      template_name: 'booking_24h',
      language: 'en_US',
      variable_count: 1,
      buttons: [],
    })

    const config: SendNodeConfig = {
      payload: {
        kind: 'utility_template',
        template_id: 'tpl_1',
        variables: { '1': { kind: 'lead_field', field: 'name' } },
      },
    }

    const result = await handleSendForTest(admin, baseCtx, {
      id: 'n1',
      type: 'send',
      config: config as unknown as Record<string, unknown>,
    })

    expect(result.edge).toBe('policy_blocked')
    expect(result.payload.reason).toBe('template_not_approved')
    expect(sendOutboundMock).not.toHaveBeenCalled()
  })

  it('sends rendered utility_template payload when approved', async () => {
    const admin = makeAdmin({
      id: 'tpl_1',
      meta_status: 'approved',
      template_name: 'booking_24h',
      language: 'en_US',
      variable_count: 2,
      buttons: [],
    })

    const config: SendNodeConfig = {
      payload: {
        kind: 'utility_template',
        template_id: 'tpl_1',
        variables: {
          '1': { kind: 'lead_field', field: 'name' },
          '2': { kind: 'booking_field', field: 'event_at_relative' },
        },
      },
    }

    const result = await handleSendForTest(admin, baseCtx, {
      id: 'n1',
      type: 'send',
      config: config as unknown as Record<string, unknown>,
    })

    expect(result.edge).toBe('success')
    expect(sendOutboundMock).toHaveBeenCalledTimes(1)
    const calls = sendOutboundMock.mock.calls as unknown as Array<[{ payload: { kind: string; templateName: string; language: string; bodyParameters: string[] } }]>
    const sentPayload = calls[0]![0]!.payload
    expect(sentPayload.kind).toBe('utility_template')
    expect(sentPayload.templateName).toBe('booking_24h')
    expect(sentPayload.language).toBe('en_US')
    expect(sentPayload.bodyParameters[0]).toBe('Sarah')
    expect(sentPayload.bodyParameters[1]).toMatch(/in \d+/)
  })

  it('skips with policy_blocked when template_id has no row', async () => {
    const admin = makeAdmin(null)
    const config: SendNodeConfig = {
      payload: {
        kind: 'utility_template',
        template_id: 'tpl_missing',
        variables: {},
      },
    }
    const result = await handleSendForTest(admin, baseCtx, {
      id: 'n1',
      type: 'send',
      config: config as unknown as Record<string, unknown>,
    })
    expect(result.edge).toBe('policy_blocked')
    expect(result.payload.reason).toBe('template_not_found')
  })
})
