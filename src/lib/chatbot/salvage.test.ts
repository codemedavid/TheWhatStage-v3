import { describe, expect, it, vi } from 'vitest'
import { recoverReply, salvageReply } from './classify'

// classify transitively imports applyStageChange -> admin client + dispatcher,
// which pull Supabase env at module load. Stub both so this pure-function test
// is side-effect free (mirrors classify.test.ts).
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/workflow/dispatcher', () => ({ dispatchStageEntered: vi.fn(async () => undefined) }))

/**
 * recoverReply is the single entry point the classify salvage site uses BEFORE
 * paying for a second `chatbot.answer.fallback` LLM call. Every shape below is a
 * real reason the combined JSON failed to parse AND the old salvageReply (which
 * only understood a double-quoted "reply" key) returned null — forcing a wasted
 * regeneration on ~1-in-5 turns. recoverReply must turn the usable ones into a
 * recovered reply, while still declining genuinely-unusable output so the LLM
 * fallback still runs for those.
 */
describe('recoverReply — cut fallback double-calls', () => {
  it('recovers plain prose when the model ignored response_format entirely', () => {
    // The single biggest real case: the model just answers in natural language
    // with no JSON wrapper at all. That prose IS the reply — using it skips a
    // second full LLM call that would regenerate the same answer.
    const raw = 'Sige po! Available pa yung unit. Gusto mo po ba i-reserve?'
    expect(recoverReply(raw)).toBe('Sige po! Available pa yung unit. Gusto mo po ba i-reserve?')
  })

  it('recovers a single-quoted reply object', () => {
    const raw = "{'reply': 'Salamat po sa inyong interes!'}"
    expect(recoverReply(raw)).toBe('Salamat po sa inyong interes!')
  })

  it('recovers an alternate reply key (message)', () => {
    const raw = '{"message": "Pwede po tayo mag-usap bukas?"}'
    expect(recoverReply(raw)).toBe('Pwede po tayo mag-usap bukas?')
  })

  it('recovers an alternate reply key (response, single-quoted)', () => {
    const raw = "{'response': 'Oo po, meron pa kaming stock.'}"
    expect(recoverReply(raw)).toBe('Oo po, meron pa kaming stock.')
  })

  it('strips a markdown code fence wrapping plain prose', () => {
    const raw = '```\nNoted po, ililista ko na kayo.\n```'
    expect(recoverReply(raw)).toBe('Noted po, ililista ko na kayo.')
  })

  it('still recovers the legacy double-quoted "reply" (delegates to salvageReply)', () => {
    // Regression guard: the truncated-tail case salvageReply already handled
    // must keep working through recoverReply.
    const raw = '{"reply":"Kumusta po! Saan po kayo galing","stage_change":'
    expect(recoverReply(raw)).toBe('Kumusta po! Saan po kayo galing')
    expect(salvageReply(raw)).toBe('Kumusta po! Saan po kayo galing')
  })

  it('declines empty / whitespace-only output', () => {
    expect(recoverReply('')).toBeNull()
    expect(recoverReply('   \n  ')).toBeNull()
  })

  it('declines a broken JSON envelope with no usable reply value (defers to LLM fallback)', () => {
    // Truncated before any reply value exists. Guessing here would emit raw JSON
    // fragments to the customer — safer to let the LLM fallback regenerate.
    expect(recoverReply('{"stage_change":{"to_stage_id":"st_x"')).toBeNull()
    expect(recoverReply('{"reply":')).toBeNull()
  })

  it('does NOT treat structured-envelope prose as a plain-prose reply', () => {
    // Looks like a (broken) envelope because it carries schema keys — must not be
    // returned verbatim as the reply.
    const raw = 'some preamble "stage_change": {"to_stage_id":"st_a"} trailing'
    expect(recoverReply(raw)).toBeNull()
  })
})
