import { describe, expect, it } from 'vitest'
import { classifyIntentHeuristic } from '@/lib/chatbot/intent'

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
