import { describe, expect, it } from 'vitest'
import { sanitizeFollowup } from './sanitize'

describe('sanitizeFollowup', () => {
  it('strips ASCII hyphen', () => {
    expect(sanitizeFollowup('Hi - interested?')).toBe('Hi interested?')
  })

  it('strips every dash glyph (en, em, figure, hyphen-bullet)', () => {
    expect(sanitizeFollowup('a-b‐c‑d‒e–f—g―h')).toBe('a b c d e f g h')
  })

  it('collapses whitespace and forces one line', () => {
    expect(sanitizeFollowup('Hi\nthere\n\n  friend')).toBe('Hi there friend')
  })

  it('trims surrounding quotes the LLM sometimes adds', () => {
    expect(sanitizeFollowup('"Hi there"')).toBe('Hi there')
    expect(sanitizeFollowup("'Hi there'")).toBe('Hi there')
  })

  it('caps length at 200 chars', () => {
    const long = 'a'.repeat(300)
    expect(sanitizeFollowup(long).length).toBe(200)
  })

  it('returns empty string on empty input', () => {
    expect(sanitizeFollowup('')).toBe('')
    expect(sanitizeFollowup('   ')).toBe('')
  })
})
