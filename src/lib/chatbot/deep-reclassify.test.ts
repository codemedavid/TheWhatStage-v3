import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock HfRouterLlm before importing the module under test.
const llmMocks = vi.hoisted(() => ({
  complete: vi.fn(async () => '{}'),
}))

vi.mock('@/lib/rag', async (orig) => {
  const actual = await orig<typeof import('@/lib/rag')>()
  return {
    ...actual,
    HfRouterLlm: vi.fn().mockImplementation(() => ({
      complete: llmMocks.complete,
    })),
  }
})

import { runDeepReclassify } from './deep-reclassify'

type AdminMockState = {
  lead: { id: string; user_id: string; name: string; stage_id: string; entered_stage_at: string; score: number | null }
  stages: Array<{ id: string; name: string; description: string | null; position: number; kind: string }>
  events: Array<{ id: string; from_stage_id: string | null; to_stage_id: string; source: string; reason: string | null; confidence: string | null; created_at: string }>
  submissions: Array<{ id: string; outcome: string; created_at: string; action_page_id: string }>
  pages: Array<{ id: string; title: string; kind: string }>
  messages: Array<{ direction: 'inbound' | 'outbound'; body: string; created_at: string }>
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>
  rpcResult: { data: unknown; error: unknown } | null
}

function makeAdmin(state: AdminMockState) {
  const from = (table: string) => {
    const fluent: Record<string, unknown> = {}
    const self: Record<string, (...args: unknown[]) => unknown> = {
      select: () => self,
      eq: () => self,
      neq: () => self,
      in: () => self,
      order: () => self,
      limit: () => self,
      maybeSingle: async () => {
        if (table === 'leads') return { data: state.lead, error: null }
        return { data: null, error: null }
      },
    }
    // Thenable so `await query` resolves without explicit .then()
    Object.assign(self, {
      then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
        if (table === 'pipeline_stages') return resolve({ data: state.stages, error: null })
        if (table === 'lead_stage_events') return resolve({ data: state.events, error: null })
        if (table === 'action_page_submissions') return resolve({ data: state.submissions, error: null })
        if (table === 'action_pages') return resolve({ data: state.pages, error: null })
        if (table === 'messenger_messages') return resolve({ data: state.messages, error: null })
        return resolve({ data: [], error: null })
      },
    })
    void fluent
    return self
  }
  return {
    from,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args })
      return state.rpcResult ?? { data: true, error: null }
    }),
  } as unknown as Parameters<typeof runDeepReclassify>[0]['adminClient']
}

function makeState(): AdminMockState {
  return {
    lead: {
      id: 'lead_1',
      user_id: 'user_1',
      name: 'Buyer Bob',
      stage_id: 'st_q',
      entered_stage_at: '2026-05-01T00:00:00Z',
      score: 60,
    },
    stages: [
      { id: 'st_new', name: 'New Lead',   description: 'fresh',  position: 0, kind: 'entry' },
      { id: 'st_q',   name: 'Qualifying', description: 'q&a',    position: 1, kind: 'qualifying' },
      { id: 'st_b',   name: 'Booked',     description: 'booked', position: 2, kind: 'decision' },
      { id: 'st_won', name: 'Won',        description: 'won',    position: 3, kind: 'won' },
    ],
    events: [],
    submissions: [],
    pages: [],
    messages: [
      { direction: 'inbound',  body: 'I want to book a call', created_at: '2026-05-10T00:00:00Z' },
      { direction: 'outbound', body: 'Sure!',                 created_at: '2026-05-10T00:00:01Z' },
    ],
    rpcCalls: [],
    rpcResult: null,
  }
}

beforeEach(() => {
  llmMocks.complete.mockReset()
})

describe('runDeepReclassify', () => {
  it('no-ops when LLM returns null stage_change', async () => {
    const state = makeState()
    llmMocks.complete.mockResolvedValueOnce(JSON.stringify({ stage_change: null }))
    await runDeepReclassify({
      adminClient: makeAdmin(state),
      leadId: 'lead_1',
      threadId: 'th_1',
      userId: 'user_1',
      windowIndex: 1,
    })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('drops medium confidence (deep pass requires high)', async () => {
    const state = makeState()
    llmMocks.complete.mockResolvedValueOnce(
      JSON.stringify({ stage_change: { to_stage_id: 'st_b', confidence: 'medium', reason: 'maybe' } }),
    )
    await runDeepReclassify({
      adminClient: makeAdmin(state),
      leadId: 'lead_1',
      threadId: 'th_1',
      userId: 'user_1',
      windowIndex: 1,
    })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('applies high-confidence move via set_lead_stage with deep_classifier source', async () => {
    const state = makeState()
    llmMocks.complete.mockResolvedValueOnce(
      JSON.stringify({
        stage_change: {
          to_stage_id: 'st_b',
          confidence: 'high',
          reason: 'Customer explicitly asked to book a call.',
        },
      }),
    )
    await runDeepReclassify({
      adminClient: makeAdmin(state),
      leadId: 'lead_1',
      threadId: 'th_1',
      userId: 'user_1',
      windowIndex: 1,
    })
    expect(state.rpcCalls).toHaveLength(1)
    expect(state.rpcCalls[0].name).toBe('set_lead_stage')
    expect(state.rpcCalls[0].args).toMatchObject({
      p_lead_id: 'lead_1',
      p_to_stage_id: 'st_b',
      p_source: 'deep_classifier',
      p_confidence: 'high',
      p_idempotency_key: 'deep:th_1:lead_1:1',
      p_thread_id: 'th_1',
    })
    expect((state.rpcCalls[0].args.p_reason as string)).toContain('explicitly asked')
  })

  it('skips when target stage equals current stage', async () => {
    const state = makeState()
    llmMocks.complete.mockResolvedValueOnce(
      JSON.stringify({
        stage_change: { to_stage_id: 'st_q', confidence: 'high', reason: 'still qualifying' },
      }),
    )
    await runDeepReclassify({
      adminClient: makeAdmin(state),
      leadId: 'lead_1',
      threadId: 'th_1',
      userId: 'user_1',
      windowIndex: 1,
    })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('skips when target stage_id is unknown', async () => {
    const state = makeState()
    llmMocks.complete.mockResolvedValueOnce(
      JSON.stringify({
        stage_change: { to_stage_id: 'st_DOES_NOT_EXIST', confidence: 'high', reason: 'x' },
      }),
    )
    await runDeepReclassify({
      adminClient: makeAdmin(state),
      leadId: 'lead_1',
      threadId: 'th_1',
      userId: 'user_1',
      windowIndex: 1,
    })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('does not throw when LLM throws', async () => {
    const state = makeState()
    llmMocks.complete.mockRejectedValueOnce(new Error('llm down'))
    await expect(
      runDeepReclassify({
        adminClient: makeAdmin(state),
        leadId: 'lead_1',
        threadId: 'th_1',
        userId: 'user_1',
        windowIndex: 1,
      }),
    ).resolves.toBeUndefined()
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('does not throw when LLM returns malformed JSON', async () => {
    const state = makeState()
    llmMocks.complete.mockResolvedValueOnce('not json at all')
    await expect(
      runDeepReclassify({
        adminClient: makeAdmin(state),
        leadId: 'lead_1',
        threadId: 'th_1',
        userId: 'user_1',
        windowIndex: 1,
      }),
    ).resolves.toBeUndefined()
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('caps reason at 500 chars when applying', async () => {
    const state = makeState()
    const longReason = 'x'.repeat(1000)
    llmMocks.complete.mockResolvedValueOnce(
      JSON.stringify({
        stage_change: { to_stage_id: 'st_b', confidence: 'high', reason: longReason },
      }),
    )
    await runDeepReclassify({
      adminClient: makeAdmin(state),
      leadId: 'lead_1',
      threadId: 'th_1',
      userId: 'user_1',
      windowIndex: 2,
    })
    expect(state.rpcCalls).toHaveLength(1)
    expect((state.rpcCalls[0].args.p_reason as string).length).toBeLessThanOrEqual(500)
  })
})
