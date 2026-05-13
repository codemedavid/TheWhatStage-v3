import { describe, it, expect } from 'vitest'
import { parseMatchedSignals } from './queries'

describe('parseMatchedSignals', () => {
  it('returns empty matched array on null reason', () => {
    expect(parseMatchedSignals(null)).toEqual({ matched: [], freeReason: '' })
  })
  it('returns matched array when reason follows the "matched: X, Y — Z" pattern', () => {
    expect(parseMatchedSignals('matched: asked price, asked schedule — lead asked magkano')).toEqual({
      matched: ['asked price', 'asked schedule'],
      freeReason: 'lead asked magkano',
    })
  })
  it('returns empty matched and original reason as freeReason for non-matching format', () => {
    expect(parseMatchedSignals('just some free text')).toEqual({
      matched: [],
      freeReason: 'just some free text',
    })
  })
})
