import { describe, it, expect, vi, beforeEach } from 'vitest'
import { coerceDecision, classifyMoveType, runDeepReclassify } from './deep-reclassify'

// ---------------------------------------------------------------------------
// Mock HfRouterLlm for integration tests
// ---------------------------------------------------------------------------
const llmMocks = vi.hoisted(() => ({
  complete: vi.fn(async () => '{}'),
}))

vi.mock('@/lib/rag', async (orig) => {
  const actual = await orig<typeof import('@/lib/rag')>()
  return {
    ...actual,
    HfRouterLlm: vi.fn().mockImplementation(function HfRouterLlmMock() {
      return { complete: llmMocks.complete }
    }),
  }
})

const stages = [
  { id: 's1', name: 'New', kind: 'entry', position: 0 },
  { id: 's2', name: 'Engaged', kind: 'nurture', position: 1 },
  { id: 's3', name: 'Interested', kind: 'nurture', position: 2 },
  { id: 's4', name: 'Qualified', kind: 'qualifying', position: 3 },
  { id: 's5', name: 'Objection', kind: 'objection', position: 4 },
  { id: 's7', name: 'Won', kind: 'won', position: 6 },
] as const

describe('classifyMoveType', () => {
  it('adjacent forward', () => {
    expect(classifyMoveType(stages, 's2', 's3')).toBe('adjacent_forward')
  })
  it('skip ahead', () => {
    expect(classifyMoveType(stages, 's2', 's4')).toBe('skip_ahead')
  })
  it('into terminal', () => {
    expect(classifyMoveType(stages, 's3', 's7')).toBe('into_terminal')
  })
  it('into objection', () => {
    expect(classifyMoveType(stages, 's3', 's5')).toBe('into_objection')
  })
  it('out of objection', () => {
    expect(classifyMoveType(stages, 's5', 's3')).toBe('out_of_objection')
  })
  it('backward', () => {
    expect(classifyMoveType(stages, 's4', 's2')).toBe('backward')
  })
})

describe('coerceDecision', () => {
  const base = {
    to_stage_id: 's3',
    matched_signals: ['asked price'],
    reason: 'lead asked magkano',
    move_type: 'adjacent_forward',
  }

  it('accepts medium confidence on adjacent forward', () => {
    const json = JSON.stringify({ stage_change: { ...base, confidence: 'medium' } })
    expect(coerceDecision(json)).not.toBeNull()
  })

  it('rejects medium confidence on skip_ahead', () => {
    const json = JSON.stringify({
      stage_change: { ...base, move_type: 'skip_ahead', confidence: 'medium' },
    })
    expect(coerceDecision(json)).toBeNull()
  })

  it('rejects medium confidence on into_terminal', () => {
    const json = JSON.stringify({
      stage_change: { ...base, move_type: 'into_terminal', confidence: 'medium' },
    })
    expect(coerceDecision(json)).toBeNull()
  })

  it('rejects when matched_signals is empty', () => {
    const json = JSON.stringify({
      stage_change: { ...base, matched_signals: [], confidence: 'high' },
    })
    expect(coerceDecision(json)).toBeNull()
  })

  it('accepts high confidence on backward only with regression in reason', () => {
    const okJson = JSON.stringify({
      stage_change: { ...base, move_type: 'backward', confidence: 'high', reason: 'regression: lead un-confirmed budget' },
    })
    const badJson = JSON.stringify({
      stage_change: { ...base, move_type: 'backward', confidence: 'high', reason: 'lead said nothing' },
    })
    expect(coerceDecision(okJson)).not.toBeNull()
    expect(coerceDecision(badJson)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Integration tests — runDeepReclassify
// ---------------------------------------------------------------------------

type AdminMockState = {
  lead: { id: string; user_id: string; name: string; stage_id: string; entered_stage_at: string; score: number | null }
  stages: Array<{ id: string; name: string; description: string | null; position: number; kind: string; entry_signals: string[] | null; exit_signals: string[] | null }>
  events: Array<{ id: string; from_stage_id: string | null; to_stage_id: string; source: string; reason: string | null; confidence: string | null; created_at: string }>
  submissions: Array<{ id: string; outcome: string; created_at: string; action_page_id: string }>
  pages: Array<{ id: string; title: string; kind: string }>
  messages: Array<{ direction: 'inbound' | 'outbound'; body: string; created_at: string }>
  queries: Array<{ table: string; filters: Record<string, unknown> }>
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>
  rpcResult: { data: unknown; error: unknown } | null
}

function makeAdmin(state: AdminMockState) {
  const from = (table: string) => {
    const filters: Record<string, unknown> = {}
    const self: Record<string, (...args: never[]) => unknown> = {
      select: () => self,
      eq: (key: string, value: unknown) => {
        filters[key] = value
        return self
      },
      neq: () => self,
      in: () => self,
      order: () => self,
      limit: () => self,
      maybeSingle: async () => {
        state.queries.push({ table, filters: { ...filters } })
        if (table === 'leads') return { data: state.lead, error: null }
        return { data: null, error: null }
      },
    }
    Object.assign(self, {
      then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
        state.queries.push({ table, filters: { ...filters } })
        if (table === 'pipeline_stages') return resolve({ data: state.stages, error: null })
        if (table === 'lead_stage_events') return resolve({ data: state.events, error: null })
        if (table === 'action_page_submissions') return resolve({ data: state.submissions, error: null })
        if (table === 'action_pages') return resolve({ data: state.pages, error: null })
        if (table === 'messenger_messages') return resolve({ data: state.messages, error: null })
        return resolve({ data: [], error: null })
      },
    })
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
      { id: 'st_new', name: 'New Lead',   description: 'fresh',  position: 0, kind: 'entry',      entry_signals: null, exit_signals: null },
      { id: 'st_q',   name: 'Qualifying', description: 'q&a',    position: 1, kind: 'qualifying', entry_signals: ['lead asked about pricing'], exit_signals: null },
      { id: 'st_b',   name: 'Booked',     description: 'booked', position: 2, kind: 'decision',   entry_signals: ['lead requested a booking'], exit_signals: null },
      { id: 'st_won', name: 'Won',        description: 'won',    position: 3, kind: 'won',         entry_signals: null, exit_signals: null },
    ],
    events: [],
    submissions: [],
    pages: [],
    messages: [
      { direction: 'inbound',  body: 'I want to book a call', created_at: '2026-05-10T00:00:00Z' },
      { direction: 'outbound', body: 'Sure!',                 created_at: '2026-05-10T00:00:01Z' },
    ],
    queries: [],
    rpcCalls: [],
    rpcResult: null,
  }
}

beforeEach(() => {
  llmMocks.complete.mockReset()
})

describe('runDeepReclassify integration', () => {
  // Test 1 — apply path: verifies source='deep_classifier', idempotency key format, and matched_signals forwarded
  it('calls set_lead_stage with source=deep_classifier, correct idempotency key, and matched_signals', async () => {
    const state = makeState()
    llmMocks.complete.mockResolvedValueOnce(
      JSON.stringify({
        stage_change: {
          to_stage_id: 'st_b',
          move_type: 'adjacent_forward',
          confidence: 'high',
          matched_signals: ['lead requested a booking'],
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
    expect(state.rpcCalls[0].args.p_reason as string).toContain('lead requested a booking')
  })

  // Test 2 — conversation history loaded via thread_id, not lead_id
  it('loads conversation history by thread_id, not a nonexistent lead_id column', async () => {
    const state = makeState()
    llmMocks.complete.mockResolvedValueOnce(JSON.stringify({ stage_change: null }))
    await runDeepReclassify({
      adminClient: makeAdmin(state),
      leadId: 'lead_1',
      threadId: 'th_1',
      userId: 'user_1',
      windowIndex: 1,
    })
    const messageQuery = state.queries.find((q) => q.table === 'messenger_messages')
    expect(messageQuery?.filters).toMatchObject({ thread_id: 'th_1' })
    expect(messageQuery?.filters).not.toHaveProperty('lead_id')
  })

  // Test 3 — LLM throws → runDeepReclassify must not propagate
  it('does not throw when callLlm throws', async () => {
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

  // Test 4 — reason truncated at 500 chars before being passed to the move helper / rpc
  it('caps reason at 500 chars when applying', async () => {
    const state = makeState()
    const longReason = 'r'.repeat(1000)
    llmMocks.complete.mockResolvedValueOnce(
      JSON.stringify({
        stage_change: {
          to_stage_id: 'st_b',
          move_type: 'adjacent_forward',
          confidence: 'high',
          matched_signals: ['lead requested a booking'],
          reason: longReason,
        },
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
    // deep-reclassify.ts truncates decision.reason at 500 chars before passing to moveLeadToStage.
    // moveLeadToStage prepends "matched: <signals> — " so the full p_reason may be longer,
    // but the reason portion after the separator must be ≤500 chars.
    const pReason = state.rpcCalls[0].args.p_reason as string
    const separatorIdx = pReason.indexOf(' — ')
    const reasonPart = separatorIdx >= 0 ? pReason.slice(separatorIdx + 3) : pReason
    expect(reasonPart.length).toBeLessThanOrEqual(500)
  })

  // Test 5 — same-stage guard and unknown-stage guard both skip without applying
  it('skips when decision targets current stage or an unknown stage', async () => {
    // Same stage
    const state1 = makeState()
    llmMocks.complete.mockResolvedValueOnce(
      JSON.stringify({
        stage_change: {
          to_stage_id: 'st_q',
          move_type: 'adjacent_forward',
          confidence: 'high',
          matched_signals: ['lead asked about pricing'],
          reason: 'still qualifying',
        },
      }),
    )
    await runDeepReclassify({
      adminClient: makeAdmin(state1),
      leadId: 'lead_1',
      threadId: 'th_1',
      userId: 'user_1',
      windowIndex: 1,
    })
    expect(state1.rpcCalls).toHaveLength(0)

    // Unknown stage
    const state2 = makeState()
    llmMocks.complete.mockResolvedValueOnce(
      JSON.stringify({
        stage_change: {
          to_stage_id: 'st_DOES_NOT_EXIST',
          move_type: 'adjacent_forward',
          confidence: 'high',
          matched_signals: ['lead requested a booking'],
          reason: 'hallucinated stage',
        },
      }),
    )
    await runDeepReclassify({
      adminClient: makeAdmin(state2),
      leadId: 'lead_1',
      threadId: 'th_1',
      userId: 'user_1',
      windowIndex: 1,
    })
    expect(state2.rpcCalls).toHaveLength(0)
  })
})
