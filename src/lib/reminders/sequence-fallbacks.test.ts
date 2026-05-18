import { describe, expect, it } from 'vitest'
import { fallbackForPosition, SEQUENCE_FALLBACKS } from './sequence-fallbacks'
import { SEQUENCE_LENGTH } from './sequence'

describe('SEQUENCE_FALLBACKS', () => {
  it('has exactly SEQUENCE_LENGTH entries', () => {
    expect(SEQUENCE_FALLBACKS.length).toBe(SEQUENCE_LENGTH)
  })

  it('has no dashes, no newlines, fits 200 chars', () => {
    for (const line of SEQUENCE_FALLBACKS) {
      expect(line).not.toMatch(/[-‐‑‒–—―]/)
      expect(line.split('\n').length).toBe(1)
      expect(line.length).toBeLessThanOrEqual(200)
      expect(line.length).toBeGreaterThan(5)
    }
  })
})

describe('fallbackForPosition', () => {
  it('substitutes {name} with the lead first name', () => {
    const line = fallbackForPosition(0, 'Maria')
    expect(line).toContain('Maria')
    expect(line).not.toContain('{name}')
  })

  it('uses "there" when name is null', () => {
    const line = fallbackForPosition(0, null)
    expect(line).toContain('there')
    expect(line).not.toContain('{name}')
  })

  it('uses only the first token of a multi-word name', () => {
    const line = fallbackForPosition(0, 'Maria Cruz')
    expect(line).toContain('Maria')
    expect(line).not.toContain('Cruz')
  })

  it('throws on out-of-range position', () => {
    expect(() => fallbackForPosition(7, 'X')).toThrow()
  })
})
