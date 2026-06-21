import { describe, expect, it, vi } from 'vitest'
import type { ProceedIntent } from './classify'
import { createVirtualSubmission, decideVirtualSubmission } from './virtual-submission'

// applyStageChange (auto mode) makes a fresh admin client + fires a dispatch;
// stub both so the IO test never touches Supabase env.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/workflow/dispatcher', () => ({
  dispatchSubmissionReceived: vi.fn(async () => undefined),
  dispatchStageEntered: vi.fn(async () => undefined),
}))

const high: ProceedIntent = { confidence: 'high', quote: 'Kayo na po bahala', reason: 'defer' }
const medium: ProceedIntent = { confidence: 'medium', quote: 'sige, tuloy na', reason: 'consent' }
const low: ProceedIntent = { confidence: 'low', quote: 'sige', reason: 'maybe' }

describe('decideVirtualSubmission', () => {
  it('never creates when mode is off', () => {
    const d = decideVirtualSubmission({ proceed: high, heuristicHit: true, mode: 'off', hasLead: true })
    expect(d.create).toBe(false)
    expect(d.advanceStage).toBe(false)
  })

  it('never creates without an attributable lead', () => {
    expect(decideVirtualSubmission({ proceed: high, heuristicHit: true, mode: 'suggest', hasLead: false }).create).toBe(false)
  })

  it('never creates when there is no proceed signal', () => {
    expect(decideVirtualSubmission({ proceed: null, heuristicHit: true, mode: 'suggest', hasLead: true }).create).toBe(false)
  })

  it('creates on high/medium LLM confidence alone (no heuristic needed)', () => {
    expect(decideVirtualSubmission({ proceed: high, heuristicHit: false, mode: 'suggest', hasLead: true }).create).toBe(true)
    expect(decideVirtualSubmission({ proceed: medium, heuristicHit: false, mode: 'suggest', hasLead: true }).create).toBe(true)
  })

  it('requires heuristic corroboration for low confidence', () => {
    expect(decideVirtualSubmission({ proceed: low, heuristicHit: false, mode: 'suggest', hasLead: true }).create).toBe(false)
    expect(decideVirtualSubmission({ proceed: low, heuristicHit: true, mode: 'suggest', hasLead: true }).create).toBe(true)
  })

  it('advances stage only in auto mode with >= medium confidence', () => {
    expect(decideVirtualSubmission({ proceed: high, heuristicHit: false, mode: 'auto', hasLead: true }).advanceStage).toBe(true)
    expect(decideVirtualSubmission({ proceed: medium, heuristicHit: false, mode: 'auto', hasLead: true }).advanceStage).toBe(true)
    // low+heuristic creates the row but must NOT auto-advance the stage
    expect(decideVirtualSubmission({ proceed: low, heuristicHit: true, mode: 'auto', hasLead: true }).advanceStage).toBe(false)
    // suggest mode never advances
    expect(decideVirtualSubmission({ proceed: high, heuristicHit: true, mode: 'suggest', hasLead: true }).advanceStage).toBe(false)
  })
})

// ---- IO happy-path with a hand-rolled fake admin client --------------------

interface FakeRow {
  id: string
  meta: Record<string, unknown> | null
}

/** Minimal Supabase fluent-chain fake covering exactly the calls
 *  createVirtualSubmission makes in suggest mode. */
function makeFakeAdmin(opts: {
  pages: Record<string, { user_id: string; status: string }>
  primaryActionPageId?: string | null
  existing?: FakeRow | null
}) {
  const inserts: Record<string, unknown>[] = []
  let insertedId = 0
  return {
    inserts,
    from(table: string) {
      if (table === 'chatbot_configs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { primary_action_page_id: opts.primaryActionPageId ?? null },
              }),
            }),
          }),
        }
      }
      if (table === 'action_pages') {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: async () => {
                const page = opts.pages[id]
                return { data: page ? { id, user_id: page.user_id, status: page.status } : null }
              },
            }),
          }),
        }
      }
      if (table === 'action_page_submissions') {
        return {
          select: () => ({
            filter: () => ({ maybeSingle: async () => ({ data: opts.existing ?? null }) }),
          }),
          insert: (row: Record<string, unknown>) => {
            inserts.push(row)
            return {
              select: () => ({
                single: async () => ({ data: { id: `sub_${++insertedId}` }, error: null }),
              }),
            }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('createVirtualSubmission (IO)', () => {
  const baseArgs = {
    userId: 'u1',
    leadId: 'l1',
    threadId: 't1',
    psid: 'psid1',
    pageId: 'fbpage1',
    proceed: high,
    idempotencyAnchor: 'msg1',
    mode: 'suggest' as const,
  }

  it('inserts a virtual submission attributed to the primary page', async () => {
    const admin = makeFakeAdmin({
      pages: { ap1: { user_id: 'u1', status: 'published' } },
      primaryActionPageId: 'ap1',
    })
    const res = await createVirtualSubmission(admin as never, baseArgs)
    expect(res?.submissionId).toBe('sub_1')
    expect(res?.deduplicated).toBe(false)
    const row = admin.inserts[0]
    expect(row.action_page_id).toBe('ap1')
    expect(row.user_id).toBe('u1')
    expect(row.lead_id).toBe('l1')
    expect(row.outcome).toBe('implied_proceed')
    expect((row.meta as Record<string, unknown>).virtual).toBe(true)
    expect((row.meta as Record<string, unknown>).idempotency_key).toBe('chat-intent:t1:msg1')
    expect((row.data as Record<string, unknown>).message_quote).toBe('Kayo na po bahala')
  })

  it('returns null when no owned/published page can be attributed', async () => {
    const admin = makeFakeAdmin({ pages: {}, primaryActionPageId: null })
    const res = await createVirtualSubmission(admin as never, baseArgs)
    expect(res).toBeNull()
    expect(admin.inserts).toHaveLength(0)
  })

  it('rejects a page owned by a different tenant', async () => {
    const admin = makeFakeAdmin({
      pages: { ap1: { user_id: 'OTHER', status: 'published' } },
      primaryActionPageId: 'ap1',
    })
    const res = await createVirtualSubmission(admin as never, baseArgs)
    expect(res).toBeNull()
  })

  it('short-circuits as deduplicated when an identical turn already recorded', async () => {
    const admin = makeFakeAdmin({
      pages: { ap1: { user_id: 'u1', status: 'published' } },
      primaryActionPageId: 'ap1',
      existing: { id: 'sub_existing', meta: { idempotency_key: 'chat-intent:t1:msg1' } },
    })
    const res = await createVirtualSubmission(admin as never, baseArgs)
    expect(res).toEqual({ submissionId: 'sub_existing', deduplicated: true, stageMoved: false })
    expect(admin.inserts).toHaveLength(0)
  })
})
