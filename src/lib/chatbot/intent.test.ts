import { describe, expect, it } from 'vitest'
import { classifyIntentHeuristic, hasProceedIntent } from '@/lib/chatbot/intent'

describe('classifyIntentHeuristic', () => {
  it('"hello po" -> smalltalk', () => {
    expect(classifyIntentHeuristic('hello po')).toBe('smalltalk')
  })

  it('"magkano po ang small?" -> faq', () => {
    expect(classifyIntentHeuristic('magkano po ang small?')).toBe('faq')
  })

  it('"book na ako" -> sales', () => {
    expect(classifyIntentHeuristic('book na ako')).toBe('sales')
  })

  it('"order ko po status?" -> support', () => {
    expect(classifyIntentHeuristic('order ko po status?')).toBe('support')
  })

  it('is case-insensitive for smalltalk greetings', () => {
    expect(classifyIntentHeuristic('HELLO PO')).toBe('smalltalk')
  })

  it('handles leading/trailing whitespace', () => {
    expect(classifyIntentHeuristic('  book na ako  ')).toBe('sales')
  })
})

describe('hasProceedIntent', () => {
  it.each([
    'Kayo na po bahala',
    'kayo na bahala sa design',
    'bahala na po kayo',
    'ikaw na bahala',
    'Check niyo na lang po page namin',
    'tingnan niyo na lang po page namin',
    'sige po, ituloy na natin',
    'go na po',
    'Go ahead po',
    'proceed na po tayo',
    'push na natin to',
    'okay na po, ituloy niyo na',
    'trust ko na po sa inyo',
    'deal na po',
    'tara na po',
  ])('detects proceed/defer signal: %s', (msg) => {
    expect(hasProceedIntent(msg)).toBe(true)
  })

  it.each([
    'magkano po ang small?',
    'hello po',
    'ano po ang process?',
    'sandali lang po, iisipin ko muna',
    '',
    '   ',
  ])('returns false for non-proceed message: %s', (msg) => {
    expect(hasProceedIntent(msg)).toBe(false)
  })

  it('disengage signal overrides a proceed token in the same message', () => {
    expect(hasProceedIntent('wag na po ituloy')).toBe(false)
    expect(hasProceedIntent('hindi na po, ayaw ko na')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(hasProceedIntent('KAYO NA PO BAHALA')).toBe(true)
  })

  it('requires a 2nd-person pronoun with "bahala" (not fatalistic "bahala na")', () => {
    expect(hasProceedIntent('bahala na kung ano mangyari')).toBe(false)
  })
})
