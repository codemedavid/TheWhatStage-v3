import { describe, expect, it, vi } from 'vitest'
import type { ProceedIntent } from './classify'
import {
  createVirtualSubmission,
  decideVirtualSubmission,
  isProceedQuoteGrounded,
} from './virtual-submission'

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
    const d = decideVirtualSubmission({ proceed: high, heuristicHit: true, quoteGrounded: true, mode: 'off', hasLead: true })
    expect(d.create).toBe(false)
    expect(d.advanceStage).toBe(false)
  })

  it('never creates without an attributable lead', () => {
    expect(decideVirtualSubmission({ proceed: high, heuristicHit: true, quoteGrounded: true, mode: 'suggest', hasLead: false }).create).toBe(false)
  })

  it('never creates when there is no proceed signal', () => {
    expect(decideVirtualSubmission({ proceed: null, heuristicHit: true, quoteGrounded: true, mode: 'suggest', hasLead: true }).create).toBe(false)
  })

  it('creates on high/medium LLM confidence when the quote is grounded', () => {
    expect(decideVirtualSubmission({ proceed: high, heuristicHit: false, quoteGrounded: true, mode: 'suggest', hasLead: true }).create).toBe(true)
    expect(decideVirtualSubmission({ proceed: medium, heuristicHit: false, quoteGrounded: true, mode: 'suggest', hasLead: true }).create).toBe(true)
  })

  it('rejects a high/medium signal whose quote is NOT grounded in the customer words', () => {
    // The model echoed the prompt's "Kayo na po bahala" example for a lead who
    // never said it — fabricated consent. Reject regardless of confidence.
    expect(decideVirtualSubmission({ proceed: high, heuristicHit: false, quoteGrounded: false, mode: 'suggest', hasLead: true }).create).toBe(false)
    expect(decideVirtualSubmission({ proceed: medium, heuristicHit: true, quoteGrounded: false, mode: 'suggest', hasLead: true }).create).toBe(false)
  })

  it('requires heuristic corroboration for low confidence (grounding not required — heuristic is itself grounded)', () => {
    expect(decideVirtualSubmission({ proceed: low, heuristicHit: false, quoteGrounded: true, mode: 'suggest', hasLead: true }).create).toBe(false)
    expect(decideVirtualSubmission({ proceed: low, heuristicHit: true, quoteGrounded: false, mode: 'suggest', hasLead: true }).create).toBe(true)
  })

  it('advances stage only in auto mode with >= medium confidence', () => {
    expect(decideVirtualSubmission({ proceed: high, heuristicHit: false, quoteGrounded: true, mode: 'auto', hasLead: true }).advanceStage).toBe(true)
    expect(decideVirtualSubmission({ proceed: medium, heuristicHit: false, quoteGrounded: true, mode: 'auto', hasLead: true }).advanceStage).toBe(true)
    // low+heuristic creates the row but must NOT auto-advance the stage
    expect(decideVirtualSubmission({ proceed: low, heuristicHit: true, quoteGrounded: false, mode: 'auto', hasLead: true }).advanceStage).toBe(false)
    // suggest mode never advances
    expect(decideVirtualSubmission({ proceed: high, heuristicHit: true, quoteGrounded: true, mode: 'suggest', hasLead: true }).advanceStage).toBe(false)
  })
})

describe('isProceedQuoteGrounded', () => {
  it('accepts a quote that appears verbatim in the customer text', () => {
    expect(isProceedQuoteGrounded('Kayo na po bahala', 'sige, kayo na po bahala diyan')).toBe(true)
  })

  it('is case-, punctuation- and diacritic-insensitive', () => {
    expect(isProceedQuoteGrounded('Kayo na po bahala!', 'KAYO NA PO BAHALA')).toBe(true)
    expect(isProceedQuoteGrounded('niño', 'si nino po')).toBe(true)
  })

  it('accepts a short fragment of what the customer said', () => {
    expect(isProceedQuoteGrounded('go po', 'ok go po')).toBe(true)
  })

  it('rejects a fabricated/echoed example the customer never typed', () => {
    // Niña only asked a question — the model parroted the example phrase.
    expect(isProceedQuoteGrounded('Kayo na po bahala', 'Hi po, magkano po ang package?')).toBe(false)
  })

  it('rejects an empty quote (nothing to ground)', () => {
    expect(isProceedQuoteGrounded('', 'ok go po')).toBe(false)
    expect(isProceedQuoteGrounded('   ', 'ok go po')).toBe(false)
  })

  // --- Code-review findings (token-matching, not substring) -----------------

  it('Finding 1: accepts a lightly paraphrased quote when its distinctive word is present', () => {
    // Model expands the contraction "nyo" → "niyo" (LLMs routinely normalize).
    // The distinctive verb "ituloy" is in the transcript, so this is grounded —
    // strict substring would have dropped a genuine consent here.
    expect(isProceedQuoteGrounded('ituloy niyo na', 'sige, ituloy nyo na yan')).toBe(true)
  })

  it('Finding 2: grounds a quote that spans a redacted phone the model saw', () => {
    // The LLM only ever sees the PII-redacted transcript, so its quote carries
    // the "[phone]" placeholder. Grounding must compare in that same redacted
    // space, not against the raw digits.
    expect(
      isProceedQuoteGrounded('go na, number ko [phone]', 'sige go na, number ko 09171234567'),
    ).toBe(true)
  })

  it('Finding 3: rejects a short quote that only matches inside an unrelated word', () => {
    // "go po" must NOT be grounded by "ago poll" — whole-token matching, no
    // substring-inside-a-word false positives.
    expect(isProceedQuoteGrounded('go po', 'sino ang nag-ago poll kahapon')).toBe(false)
  })

  it('still rejects a fabricated multi-word example whose distinctive word is absent', () => {
    // Regression guard: the whole point of grounding. "bahala" never appears.
    expect(isProceedQuoteGrounded('kayo na po bahala', 'pwede po magtanong, magkano?')).toBe(false)
  })

  it('grounds an all-filler quote only when it appears contiguously', () => {
    expect(isProceedQuoteGrounded('kayo na po', 'sige kayo na po diyan')).toBe(true)
    expect(isProceedQuoteGrounded('kayo na po', 'po na kayo ang bahala')).toBe(false)
  })
})

// ---- IO happy-path with a hand-rolled fake admin client --------------------

interface FakeRow {
  id: string
  data?: Record<string, unknown> | null
  meta?: Record<string, unknown> | null
}

/** Minimal Supabase fluent-chain fake covering exactly the calls
 *  createVirtualSubmission makes in suggest mode. */
function makeFakeAdmin(opts: {
  pages: Record<string, { user_id: string; status: string }>
  primaryActionPageId?: string | null
  existing?: FakeRow | null
}) {
  const inserts: Record<string, unknown>[] = []
  const updates: Record<string, unknown>[] = []
  let insertedId = 0
  return {
    inserts,
    updates,
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
          update: (row: Record<string, unknown>) => {
            updates.push(row)
            return { eq: async () => ({ error: null }) }
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
    // The customer actually said the quoted words — grounds the high signal.
    customerText: 'sige, Kayo na po bahala',
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
    expect((row.meta as Record<string, unknown>).idempotency_key).toBe('chat-intent:t1')
    expect((row.data as Record<string, unknown>).message_quote).toBe('Kayo na po bahala')
  })

  it('stores captured info as data.fields so it renders like a form fill', async () => {
    const admin = makeFakeAdmin({
      pages: { ap1: { user_id: 'u1', status: 'published' } },
      primaryActionPageId: 'ap1',
    })
    await createVirtualSubmission(admin as never, {
      ...baseArgs,
      info: {
        details: [
          { label: 'Contact number', value: '0917 000 1234' },
          { label: 'Business', value: 'Aling Nena Catering' },
        ],
      },
    })
    const data = admin.inserts[0].data as Record<string, unknown>
    expect(data.fields).toEqual({
      'Contact number': '0917 000 1234',
      Business: 'Aling Nena Catering',
    })
  })

  it('omits data.fields when no info was captured', async () => {
    const admin = makeFakeAdmin({
      pages: { ap1: { user_id: 'u1', status: 'published' } },
      primaryActionPageId: 'ap1',
    })
    await createVirtualSubmission(admin as never, baseArgs)
    const data = admin.inserts[0].data as Record<string, unknown>
    expect('fields' in data).toBe(false)
  })

  it('does NOT insert when the proceed quote is fabricated (not in the customer text)', async () => {
    // Niña repro: the model emitted a high-confidence "Kayo na po bahala" for a
    // lead who only asked a question. No grounded quote → no chat-implied row.
    const admin = makeFakeAdmin({
      pages: { ap1: { user_id: 'u1', status: 'published' } },
      primaryActionPageId: 'ap1',
    })
    const res = await createVirtualSubmission(admin as never, {
      ...baseArgs,
      customerText: 'Hi po, magkano po ang package?',
    })
    expect(res).toBeNull()
    expect(admin.inserts).toHaveLength(0)
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

  it('dedupes per thread: a second proceed-intent never inserts a new row', async () => {
    const admin = makeFakeAdmin({
      pages: { ap1: { user_id: 'u1', status: 'published' } },
      primaryActionPageId: 'ap1',
      existing: {
        id: 'sub_existing',
        data: {
          virtual: true,
          message_quote: 'Kayo na po bahala',
          proceed_confidence: 'high',
          proceed_reason: 'defer',
          thread_id: 't1',
        },
        meta: { idempotency_key: 'chat-intent:t1' },
      },
    })
    // A different inbound message (msg2) in the SAME thread must NOT create a
    // second chat-implied submission — that was the doubling bug.
    const res = await createVirtualSubmission(admin as never, {
      ...baseArgs,
      idempotencyAnchor: 'msg2',
    })
    expect(res).toEqual({ submissionId: 'sub_existing', deduplicated: true, stageMoved: false })
    expect(admin.inserts).toHaveLength(0)
  })

  it('enriches the existing submission with newly captured fields on dedup', async () => {
    const admin = makeFakeAdmin({
      pages: { ap1: { user_id: 'u1', status: 'published' } },
      primaryActionPageId: 'ap1',
      existing: {
        id: 'sub_existing',
        data: {
          virtual: true,
          message_quote: 'Kayo na po bahala',
          proceed_confidence: 'high',
          proceed_reason: 'defer',
          thread_id: 't1',
          fields: { 'Contact number': '0917 000 1234' },
        },
        meta: { idempotency_key: 'chat-intent:t1' },
      },
    })
    await createVirtualSubmission(admin as never, {
      ...baseArgs,
      idempotencyAnchor: 'msg2',
      info: { details: [{ label: 'Business', value: 'Aling Nena Catering' }] },
    })
    expect(admin.inserts).toHaveLength(0)
    expect(admin.updates).toHaveLength(1)
    const data = admin.updates[0].data as Record<string, unknown>
    // Pre-existing field preserved AND new field merged in.
    expect(data.fields).toEqual({
      'Contact number': '0917 000 1234',
      Business: 'Aling Nena Catering',
    })
  })

  it('upgrades the stored quote/confidence when a stronger signal arrives', async () => {
    const admin = makeFakeAdmin({
      pages: { ap1: { user_id: 'u1', status: 'published' } },
      primaryActionPageId: 'ap1',
      existing: {
        id: 'sub_existing',
        data: {
          virtual: true,
          message_quote: 'sige',
          proceed_confidence: 'low',
          proceed_reason: 'maybe',
          thread_id: 't1',
        },
        meta: { idempotency_key: 'chat-intent:t1' },
      },
    })
    await createVirtualSubmission(admin as never, {
      ...baseArgs,
      proceed: high,
      idempotencyAnchor: 'msg2',
    })
    expect(admin.updates).toHaveLength(1)
    const data = admin.updates[0].data as Record<string, unknown>
    expect(data.message_quote).toBe('Kayo na po bahala')
    expect(data.proceed_confidence).toBe('high')
  })

  it('does not downgrade a stored stronger signal with a weaker later one', async () => {
    const admin = makeFakeAdmin({
      pages: { ap1: { user_id: 'u1', status: 'published' } },
      primaryActionPageId: 'ap1',
      existing: {
        id: 'sub_existing',
        data: {
          virtual: true,
          message_quote: 'Kayo na po bahala',
          proceed_confidence: 'high',
          proceed_reason: 'defer',
          thread_id: 't1',
        },
        meta: { idempotency_key: 'chat-intent:t1' },
      },
    })
    await createVirtualSubmission(admin as never, {
      ...baseArgs,
      proceed: low,
      idempotencyAnchor: 'msg2',
      heuristicHit: true,
    })
    // No new info, weaker signal → nothing worth writing.
    expect(admin.inserts).toHaveLength(0)
    expect(admin.updates).toHaveLength(0)
  })
})
