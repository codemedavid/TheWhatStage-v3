import { describe, it, expect } from 'vitest'
import { segmentReply, DEFAULT_SPLIT_MAX_BUBBLES } from './reply-segments'

/**
 * Guarantees for the human-like reply splitter. It must feel like a person
 * cutting one thought into a couple of chat bubbles — greeting/acknowledgement
 * first, then the follow-up question on its own — WITHOUT ever dropping content.
 */
describe('segmentReply', () => {
  it('returns [] for empty or whitespace-only text', () => {
    expect(segmentReply('')).toEqual([])
    expect(segmentReply('   \n\t ')).toEqual([])
  })

  it('keeps a single statement as one bubble', () => {
    expect(segmentReply('Salamat po sa inyong mensahe.')).toEqual([
      'Salamat po sa inyong mensahe.',
    ])
  })

  it('keeps a lone question as one bubble', () => {
    expect(segmentReply('Ano po name ng business niyo?')).toEqual([
      'Ano po name ng business niyo?',
    ])
  })

  it('splits greeting/acknowledgement from a trailing question (the core example)', () => {
    const reply = 'Hello po bossing! Salamat sa message. Ano po name ng business niyo?'
    expect(segmentReply(reply)).toEqual([
      'Hello po bossing! Salamat sa message.',
      'Ano po name ng business niyo?',
    ])
  })

  it('gives each question its own bubble', () => {
    const reply = 'Sige po. Ano po budget niyo? Kailan po kayo available?'
    expect(segmentReply(reply)).toEqual([
      'Sige po.',
      'Ano po budget niyo?',
      'Kailan po kayo available?',
    ])
  })

  it('never drops non-whitespace content', () => {
    const reply = 'Hello po bossing! Salamat sa message. Ano po name ng business niyo?'
    const joined = segmentReply(reply).join(' ')
    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim()
    expect(normalize(joined)).toBe(normalize(reply))
  })

  it('caps the number of bubbles, merging the trailing overflow into the last bubble', () => {
    const reply = 'Uno? Dos? Tres? Kwatro? Singko?'
    const out = segmentReply(reply, { maxBubbles: 3 })
    expect(out).toHaveLength(3)
    // Order preserved and nothing lost — the tail collapses into bubble 3.
    expect(out[0]).toBe('Uno?')
    expect(out[1]).toBe('Dos?')
    expect(out[2]).toBe('Tres? Kwatro? Singko?')
  })

  it('defaults to a conservative max bubble count', () => {
    expect(DEFAULT_SPLIT_MAX_BUBBLES).toBe(3)
  })

  it('does not emit a spammy sub-minimum statement bubble on its own', () => {
    // "Ok." is too short to stand alone; it should ride along, not spam.
    const reply = 'Ok. Ano po pangalan niyo?'
    const out = segmentReply(reply)
    expect(out).toEqual(['Ok. Ano po pangalan niyo?'])
  })

  it('treats newlines as bubble boundaries', () => {
    const reply = 'Hello po!\nAno po kailangan niyo?'
    expect(segmentReply(reply)).toEqual(['Hello po!', 'Ano po kailangan niyo?'])
  })
})
