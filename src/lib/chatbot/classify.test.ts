import { describe, expect, it } from 'vitest'
import type { StageBrief } from './classify'
import { sanitizeReply, stageInstruction, stageList } from './classify'

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
})
