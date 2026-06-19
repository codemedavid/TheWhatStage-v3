import { describe, expect, it } from 'vitest'
import { splitMessengerText, MESSENGER_TEXT_LIMIT } from './messenger-split'

// Strip all whitespace so we can assert no NON-whitespace character is ever
// lost or duplicated by the splitter (inter-chunk whitespace is intentionally
// trimmed and therefore excluded from the comparison).
function squash(s: string): string {
  return s.replace(/\s+/g, '')
}

function repeat(unit: string, length: number): string {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length)
}

describe('splitMessengerText', () => {
  it('returns a single chunk for text within the limit', () => {
    expect(splitMessengerText('hello world')).toEqual(['hello world'])
  })

  it('returns an empty array for empty text', () => {
    expect(splitMessengerText('')).toEqual([])
    expect(splitMessengerText('   ')).toEqual([])
  })

  it('keeps text exactly at the limit as one chunk', () => {
    const text = repeat('a', MESSENGER_TEXT_LIMIT)
    const parts = splitMessengerText(text)
    expect(parts).toHaveLength(1)
    expect(parts[0].length).toBe(MESSENGER_TEXT_LIMIT)
  })

  it('splits text just over the limit into multiple chunks, each within the limit', () => {
    const text = repeat('word ', MESSENGER_TEXT_LIMIT + 500)
    const parts = splitMessengerText(text)
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MESSENGER_TEXT_LIMIT)
  })

  it('never loses non-whitespace content', () => {
    const text = repeat('The quick brown fox. ', MESSENGER_TEXT_LIMIT * 2)
    const parts = splitMessengerText(text)
    expect(squash(parts.join(''))).toBe(squash(text))
  })

  it('prefers paragraph boundaries (\\n\\n)', () => {
    const para = repeat('a', MESSENGER_TEXT_LIMIT - 100)
    const para2 = repeat('b', 300)
    const parts = splitMessengerText(`${para}\n\n${para2}`)
    expect(parts[0]).toBe(para)
    expect(parts[1]).toBe(para2)
  })

  it('prefers sentence boundaries when no paragraph break fits', () => {
    // s1 must fit on its own, but s1 + ' ' + s2 must exceed the limit so a
    // split is actually forced at the sentence boundary.
    const s1 = repeat('a', MESSENGER_TEXT_LIMIT - 20) + '.'
    const s2 = 'Second sentence here.'
    const parts = splitMessengerText(`${s1} ${s2}`)
    expect(parts[0]).toBe(s1)
    expect(parts[1]).toBe(s2)
  })

  it('falls back to word boundaries when a sentence is too long', () => {
    const longSentence = repeat('word ', MESSENGER_TEXT_LIMIT + 200).trimEnd()
    const parts = splitMessengerText(longSentence)
    expect(parts.length).toBeGreaterThan(1)
    // No chunk should start or end mid-"word" — every chunk is whole words.
    for (const p of parts) {
      expect(p.startsWith('word') || p === '').toBe(true)
      expect(p.length).toBeLessThanOrEqual(MESSENGER_TEXT_LIMIT)
    }
  })

  it('hard-splits a single oversized token with no spaces', () => {
    const giant = repeat('x', MESSENGER_TEXT_LIMIT * 2 + 7)
    const parts = splitMessengerText(giant)
    expect(parts.length).toBe(3)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MESSENGER_TEXT_LIMIT)
    expect(parts.join('')).toBe(giant)
  })

  it('never splits a surrogate pair (emoji stay intact)', () => {
    // 😀 is two UTF-16 code units. A naive slice at the limit could cut one in half.
    const emoji = '😀'
    const giant = emoji.repeat(MESSENGER_TEXT_LIMIT) // length = 2*LIMIT
    const parts = splitMessengerText(giant)
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(MESSENGER_TEXT_LIMIT)
      // A lone surrogate would make this throw / produce U+FFFD.
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(p)).toBe(false)
    }
    expect(parts.join('')).toBe(giant)
  })

  it('respects a custom limit', () => {
    const parts = splitMessengerText('aaaa bbbb cccc', 5)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(5)
    expect(squash(parts.join(''))).toBe(squash('aaaa bbbb cccc'))
  })
})
