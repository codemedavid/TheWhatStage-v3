import { describe, it, expect } from 'vitest'
import { breakInlineEnumeration } from './structured-lines'

/**
 * Guarantees for the inline-enumeration safety net. When the model ignores the
 * structured-messages prompt and runs an option list into ONE line —
 * "A) Better ordering B) Mas malaki orders C) ..." — the customer gets an
 * unreadable wall of text, and Messenger even emoji-converts the inline "B)"
 * into 😎. This deterministic normalizer breaks such runs onto their own lines
 * and rewrites "X)" markers to "X." so no marker is emoticon-converted.
 */
describe('breakInlineEnumeration', () => {
  it('breaks a lettered inline option run onto its own lines with dot markers', () => {
    const reply =
      'Ano po goal niyo? A) Better Ordering Experience B) Mas mapalaki orders C) Mas mapabalik-balik si customer D) Matrack ang sales'
    expect(breakInlineEnumeration(reply)).toBe(
      'Ano po goal niyo?\nA. Better Ordering Experience\nB. Mas mapalaki orders\nC. Mas mapabalik-balik si customer\nD. Matrack ang sales',
    )
  })

  it('breaks a numbered inline option run onto its own lines', () => {
    const reply = 'May dalawang plan po kami: 1) Basic plan 2) Pro plan'
    expect(breakInlineEnumeration(reply)).toBe(
      'May dalawang plan po kami:\n1. Basic plan\n2. Pro plan',
    )
  })

  it('handles a run with no lead-in text (starts at the first marker)', () => {
    expect(breakInlineEnumeration('A) For ordering B) For monitoring')).toBe(
      'A. For ordering\nB. For monitoring',
    )
  })

  it('never emits an emoticon-convertible ") " marker in the output', () => {
    const out = breakInlineEnumeration('Pili po kayo: A) Una B) Pangalawa')
    expect(out).not.toMatch(/[A-H]\)/)
  })

  it('leaves text unchanged when the model already used line breaks', () => {
    const reply = 'Ano po goal niyo?\nA) Better ordering B) side note sa isang line'
    expect(breakInlineEnumeration(reply)).toBe(reply)
  })

  it('leaves prose with a single stray marker unchanged', () => {
    const reply = 'Sige po, option B) na lang po kami.'
    expect(breakInlineEnumeration(reply)).toBe(reply)
  })

  it('leaves a run unchanged when it does not start the sequence (C, D only)', () => {
    const reply = 'Nabanggit niyo po ang C) at D) kanina.'
    expect(breakInlineEnumeration(reply)).toBe(reply)
  })

  it('leaves non-consecutive markers unchanged', () => {
    const reply = 'Room 1) is taken and room 5) is free.'
    expect(breakInlineEnumeration(reply)).toBe(reply)
  })

  it('returns empty/whitespace input unchanged', () => {
    expect(breakInlineEnumeration('')).toBe('')
    expect(breakInlineEnumeration('   ')).toBe('   ')
  })

  it('supports "X." style markers inline too', () => {
    const reply = 'Ano po goal niyo? 1. Ordering 2. Monitoring 3. Marketing'
    expect(breakInlineEnumeration(reply)).toBe(
      'Ano po goal niyo?\n1. Ordering\n2. Monitoring\n3. Marketing',
    )
  })
})
