import { describe, expect, it, vi } from 'vitest'
import type { StageBrief, StageChange } from './classify'
import { applyStageChange, sanitizeReply, stageInstruction, stageList } from './classify'

// applyStageChange creates a fresh admin client after a successful move so
// it can fire `dispatchStageEntered`. The real implementation pulls Supabase
// env vars; in tests we don't have them, so stub both.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({}),
}))
vi.mock('@/lib/workflow/dispatcher', () => ({
  dispatchStageEntered: vi.fn(async () => undefined),
}))

const stages: StageBrief[] = [
  { id: 'st_new', name: 'New Lead',    description: 'fresh',    position: 0, kind: 'entry' },
  { id: 'st_q',   name: 'Qualifying',  description: 'asking q', position: 1, kind: 'qualifying' },
  { id: 'st_b',   name: 'Booked Call', description: 'call set', position: 2, kind: 'decision' },
  { id: 'st_won', name: 'Closed Won',  description: 'paid',     position: 3, kind: 'won' },
  { id: 'st_lost',name: 'Lost',        description: 'no go',    position: 4, kind: 'lost' },
]

describe('stageList', () => {
  it('renders stages in position order with [position · kind] name prefix', () => {
    const out = stageList(stages, 'st_q')
    const lines = out.split('\n')
    expect(lines[0]).toMatch(/Pipeline stages \(in order/)
    expect(out).toContain('[0 · entry] New Lead')
    expect(out).toContain('[1 · qualifying] Qualifying')
    expect(out).toContain('[2 · decision] Booked Call')
    expect(out).toContain('[3 · won] Closed Won')
    expect(out).toContain('[4 · lost] Lost')
  })

  it('flags the current stage', () => {
    const out = stageList(stages, 'st_b')
    expect(out).toMatch(/\[2 · decision\] Booked Call\s*\[CURRENT\]/)
  })

  it('handles missing description gracefully', () => {
    const s: StageBrief[] = [
      { id: 'a', name: 'A', description: null, position: 0, kind: 'entry' },
    ]
    expect(stageList(s, null)).toContain('(no description)')
  })

  it('preserves position order even when input is shuffled', () => {
    const shuffled: StageBrief[] = [stages[3], stages[0], stages[2], stages[4], stages[1]]
    const out = stageList(shuffled, null)
    const idxNew  = out.indexOf('New Lead')
    const idxQ    = out.indexOf('Qualifying')
    const idxB    = out.indexOf('Booked Call')
    const idxWon  = out.indexOf('Closed Won')
    const idxLost = out.indexOf('Lost')
    expect(idxNew).toBeLessThan(idxQ)
    expect(idxQ).toBeLessThan(idxB)
    expect(idxB).toBeLessThan(idxWon)
    expect(idxWon).toBeLessThan(idxLost)
  })
})

describe('stageInstruction (hierarchy block)', () => {
  it('includes the HIERARCHY RULES block', () => {
    // stageInstruction signature:
    //   (stages, currentStageId, actionPages, recommendRules, recommendPropertyRules)
    const out = stageInstruction(stages, null, [], null, null)
    expect(out).toContain('STAGE HIERARCHY RULES')
    expect(out).toContain('Forward moves')
    expect(out).toContain('Backward moves')
    expect(out).toContain('"high"')
    expect(out).toContain('disqualifying signal')
  })

  it('renders the position-ordered stage list within the prompt', () => {
    const out = stageInstruction(stages, 'st_q', [], null, null)
    expect(out).toContain('[0 · entry] New Lead')
    // st_q is current — should have [CURRENT]
    expect(out).toMatch(/\[1 · qualifying\] Qualifying\s*\[CURRENT\]/)
  })
})

describe('stageList renders entry signals', () => {
  it('renders entry signals when present so the live classifier can read them', () => {
    const withSignals: StageBrief[] = [
      {
        id: 'st_int',
        name: 'Interested',
        description: 'evaluating',
        position: 1,
        kind: 'nurture',
        entry_signals: ['says "interested po"', 'asks magkano'],
        exit_signals: ['commits to buy'],
      },
    ]
    const out = stageList(withSignals, null)
    expect(out).toContain('enter when:')
    expect(out).toContain('says "interested po"')
    expect(out).toContain('asks magkano')
    expect(out).toContain('leave when:')
    expect(out).toContain('commits to buy')
  })

  it('omits the enter-when block when entry_signals is empty or missing', () => {
    const out = stageList(stages, null)
    // Default stages array has no entry_signals → no enter-when block.
    expect(out).not.toContain('enter when:')
  })
})

describe('stageInstruction includes calibration + Tagalog few-shots', () => {
  it('includes the confidence calibration block', () => {
    const out = stageInstruction(stages, null, [], null, null)
    expect(out).toContain('CONFIDENCE CALIBRATION')
    expect(out).toContain('`low`')
    expect(out).toContain('`medium`')
    expect(out).toContain('`high`')
  })

  it('biases toward forward movement and away from null', () => {
    const out = stageInstruction(stages, null, [], null, null)
    expect(out).toMatch(/keep the lead moving forward/i)
    expect(out).toMatch(/move forward.*rather than.*null/i)
  })

  it('includes Tagalog/Taglish examples', () => {
    const out = stageInstruction(stages, null, [], null, null)
    expect(out).toContain('interested po')
    expect(out).toContain('magkano')
    expect(out).toContain('ayaw na')
  })

  it('flags entry-kind stages as exit-on-first-inbound', () => {
    const out = stageInstruction(stages, null, [], null, null)
    expect(out).toMatch(/entry.*exit/i)
  })
})

describe('applyStageChange confidence gate', () => {
  const testStages: StageBrief[] = [
    { id: 'new',   name: 'New',        description: '', position: 0, kind: 'entry' },
    { id: 'eng',   name: 'Engaged',    description: '', position: 1, kind: 'nurture' },
    { id: 'int',   name: 'Interested', description: '', position: 2, kind: 'nurture' },
    { id: 'qual',  name: 'Qualified',  description: '', position: 3, kind: 'qualifying' },
    { id: 'obj',   name: 'Objection',  description: '', position: 4, kind: 'objection' as 'nurture' /* kind union */ },
    { id: 'won',   name: 'Won',        description: '', position: 5, kind: 'won' },
  ]

  function fakeAdmin(captured: { args: Record<string, unknown> | null }) {
    return {
      rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
        captured.args = args
        return { data: true, error: null }
      }),
    } as unknown as Parameters<typeof applyStageChange>[0]
  }

  it('accepts low confidence for adjacent-forward moves', async () => {
    const captured = { args: null as Record<string, unknown> | null }
    const change: StageChange = { to_stage_id: 'eng', confidence: 'low', reason: 'said hello' }
    const result = await applyStageChange(fakeAdmin(captured), {
      leadId: 'L', userId: 'U', threadId: 'T', fromStageId: 'new', change, stages: testStages,
      idempotencySuffix: 'msg1',
    })
    expect(result).toBe('L')
    expect(captured.args?.p_confidence).toBe('low')
  })

  it('rejects low confidence for skip-ahead moves', async () => {
    const captured = { args: null as Record<string, unknown> | null }
    const change: StageChange = { to_stage_id: 'qual', confidence: 'low', reason: 'maybe?' }
    const result = await applyStageChange(fakeAdmin(captured), {
      leadId: 'L', userId: 'U', threadId: 'T', fromStageId: 'new', change, stages: testStages,
      idempotencySuffix: 'msg1',
    })
    expect(result).toBeNull()
    expect(captured.args).toBeNull()
  })

  it('rejects low confidence into terminal stages', async () => {
    const captured = { args: null as Record<string, unknown> | null }
    const change: StageChange = { to_stage_id: 'won', confidence: 'low', reason: 'maybe paid?' }
    const result = await applyStageChange(fakeAdmin(captured), {
      leadId: 'L', userId: 'U', threadId: 'T', fromStageId: 'qual', change, stages: testStages,
      idempotencySuffix: 'msg1',
    })
    expect(result).toBeNull()
  })

  it('accepts low confidence into objection (objection is a side-track)', async () => {
    const captured = { args: null as Record<string, unknown> | null }
    const objStages = [
      ...testStages.slice(0, 4),
      { ...testStages[4], kind: 'objection' as unknown as StageBrief['kind'] },
      testStages[5],
    ]
    const change: StageChange = { to_stage_id: 'obj', confidence: 'low', reason: 'maybe an objection' }
    const result = await applyStageChange(fakeAdmin(captured), {
      leadId: 'L', userId: 'U', threadId: 'T', fromStageId: 'int', change, stages: objStages,
      idempotencySuffix: 'msg1',
    })
    expect(result).toBe('L')
  })

  it('accepts medium and high for any allowed move', async () => {
    for (const conf of ['medium', 'high'] as const) {
      const captured = { args: null as Record<string, unknown> | null }
      const change: StageChange = { to_stage_id: 'qual', confidence: conf, reason: 'r' }
      const result = await applyStageChange(fakeAdmin(captured), {
        leadId: 'L', userId: 'U', threadId: 'T', fromStageId: 'new', change, stages: testStages,
        idempotencySuffix: 'msg1',
      })
      expect(result).toBe('L')
    }
  })

  it('includes idempotencySuffix in the idempotency key — different messages = different keys', async () => {
    const captured1 = { args: null as Record<string, unknown> | null }
    const captured2 = { args: null as Record<string, unknown> | null }
    const change: StageChange = { to_stage_id: 'eng', confidence: 'medium', reason: 'r' }
    await applyStageChange(fakeAdmin(captured1), {
      leadId: 'L', userId: 'U', threadId: 'T', fromStageId: 'new', change, stages: testStages,
      idempotencySuffix: 'msgA',
    })
    await applyStageChange(fakeAdmin(captured2), {
      leadId: 'L', userId: 'U', threadId: 'T', fromStageId: 'new', change, stages: testStages,
      idempotencySuffix: 'msgB',
    })
    expect(captured1.args?.p_idempotency_key).toBe('classify:T:L:msgA')
    expect(captured2.args?.p_idempotency_key).toBe('classify:T:L:msgB')
    expect(captured1.args?.p_idempotency_key).not.toBe(captured2.args?.p_idempotency_key)
  })
})

describe('sanitizeReply', () => {
  it('strips the malformed <|tool_call>...<tool_call|> artifact seen in production', () => {
    const raw = '<|tool_call>call:action_page.action_page_id("WhatStage")<tool_call|>'
    expect(sanitizeReply(raw)).toBe('')
  })

  it('strips well-formed tool-call wrappers but keeps surrounding text', () => {
    const raw = 'Salamat! <tool_call>call:action_page.action_page_id("X")</tool_call> Heto na.'
    const out = sanitizeReply(raw)
    expect(out).not.toMatch(/tool_call/i)
    expect(out).not.toMatch(/call:action_page/i)
    expect(out).toContain('Salamat!')
    expect(out).toContain('Heto na.')
  })

  it('strips fenced code blocks and bracketed link placeholders', () => {
    const raw = 'Sure thing 👇 [Insert Link]\n```json\n{"action_page": "x"}\n```'
    const out = sanitizeReply(raw)
    expect(out).not.toMatch(/```/)
    expect(out).not.toMatch(/\[insert link\]/i)
    expect(out).toContain('Sure thing')
  })

  it('strips ChatML control tokens like <|im_start|>assistant', () => {
    const raw = '<|im_start|>assistant\nHello there<|im_end|>'
    const out = sanitizeReply(raw)
    expect(out).not.toMatch(/<\|/)
    expect(out).toContain('Hello there')
  })

  it('passes a normal reply through unchanged (apart from trim)', () => {
    expect(sanitizeReply('  Hello, kumusta? 👋  ')).toBe('Hello, kumusta? 👋')
  })

  // ---- Variants of the production-incident pattern. Every one of these
  //      MUST sanitize to a string that contains zero tool-call residue.

  it.each([
    // Original incident
    '<|tool_call>call:action_page.action_page_id("WhatStage")<tool_call|>',
    // Both delimiters well-formed
    '<|tool_call|>call:action_page.action_page_id("X")<|/tool_call|>',
    '<|tool_call|>call:action_page.action_page_id("X")<|tool_call|>',
    // XML-style
    '<tool_call>call:action_page.action_page_id("X")</tool_call>',
    '<tool_call>action_page.action_page_id("X")</tool_call>',
    // function_call alias
    '<|function_call|>call:action_page.action_page_id("X")<|/function_call|>',
    '<function_call>foo("bar")</function_call>',
    // tool_use alias (Anthropic-flavoured)
    '<|tool_use|>action_page.action_page_id("X")<|/tool_use|>',
    // Square-bracket variant
    '[[tool_call]]call:action_page.action_page_id("X")[[/tool_call]]',
    // Underscored / spaced / mixed-case names
    '<|TOOL_CALL|>call:action_page.action_page_id("X")<|/TOOL_CALL|>',
    '<|tool call|>call:action_page.action_page_id("X")<|/tool call|>',
    // No `action_page.` prefix — bare `call:foo(...)` form
    'call:foo("bar")',
    'tool_call: action_page_id("WhatStage")',
    // JSON fragment leak
    '{"action_page_id":"WhatStage","reason":"x"}',
    // Multiline with payload and noise
    'Sigurado ka na ba?\n<|tool_call>\ncall:action_page.action_page_id("WhatStage")\n<tool_call|>\nSalamat!',
    // Lone control token, no body
    '<|tool_call|>',
    '<tool_call>',
    '<|/tool_call|>',
  ])('scrubs all tool-call residue from variant: %s', (raw) => {
    const out = sanitizeReply(raw)
    expect(out).not.toMatch(/tool[_ ]?call/i)
    expect(out).not.toMatch(/function[_ ]?call/i)
    expect(out).not.toMatch(/tool[_ ]?use/i)
    expect(out).not.toMatch(/<\|/)
    expect(out).not.toMatch(/\|>/)
    expect(out).not.toMatch(/action_page\.action_page_id/i)
    expect(out).not.toMatch(/"action_page_id"/i)
    expect(out).not.toMatch(/\bcall\s*:/i)
  })

  it('preserves real customer-facing content around a stripped tool call', () => {
    const raw =
      'Sigurado ka na ba?\n<|tool_call>call:action_page.action_page_id("WhatStage")<tool_call|>\nSalamat!'
    const out = sanitizeReply(raw)
    expect(out).toContain('Sigurado ka na ba?')
    expect(out).toContain('Salamat!')
  })

  it('is idempotent — running twice produces the same string', () => {
    const raw = '<|tool_call>call:action_page.action_page_id("X")<tool_call|>\nHello'
    const once = sanitizeReply(raw)
    const twice = sanitizeReply(once)
    expect(twice).toBe(once)
  })

  // ---- Link-tease sentences. The model sometimes paraphrases "here's the
  //      link" without actually attaching the action_page, leaving the
  //      customer with a broken promise. These MUST be stripped.
  it.each([
    'Sige, eto ang link para makita mo kung paano namin inaayos ang ganyang setup: check it',
    'Heto na po ang link 👇',
    "Here's the link for you 👇",
    'Click the link below',
    'I-tap ang link sa baba',
    'Check this out',
    "Tingnan mo 'to",
    'Fill out the form below',
    'I-click ang button para mag-book',
    'I-fill out ang form para makita ang availability',
    // Production case (2026-05-15 screenshot): bot teased a link with no
    // button card attached, customer replied "wala pa din pong link".
    'Perfect. Eto na yung link para makita mo kung paano namin inaayos ang ganyang setup:',
  ])('strips link-tease line: %s', (raw) => {
    const out = sanitizeReply(raw)
    expect(out).not.toMatch(/\blink\b/i)
    expect(out).not.toMatch(/\bcheck\s+(?:it|this|the|sa|ang|yung|mo|'to)/i)
    expect(out).not.toMatch(/\bi[-\s]?(?:click|tap|fill)\b/i)
    expect(out).not.toMatch(/\bclick\s+the\b/i)
    expect(out).not.toMatch(/\btingnan\s+mo\b/i)
    expect(out).not.toMatch(/\bheto\s+(?:na\s+)?(?:po\s+)?ang\s+link/i)
    expect(out).not.toMatch(/\beto\s+ang\s+link/i)
    expect(out).not.toMatch(/\bfill\s+out\b/i)
  })

  it('strips a tease sentence but keeps surrounding conversational text', () => {
    const raw =
      'Usually sa ganyang volume, 60–70% talaga nasasayang. Sige, eto ang link para makita mo: check it. Salamat po!'
    const out = sanitizeReply(raw)
    expect(out).toContain('60–70%')
    expect(out).toContain('Salamat po!')
    expect(out).not.toMatch(/eto\s+ang\s+link/i)
    expect(out).not.toMatch(/check\s+it/i)
  })

  it('leaves a fully conversational reply untouched', () => {
    const raw =
      'Usually sa ganyang volume, nasa 60-70% ang nasasayang. Gusto mo bang makita kung paano namin inaayos yan?'
    expect(sanitizeReply(raw)).toBe(raw)
  })
})
