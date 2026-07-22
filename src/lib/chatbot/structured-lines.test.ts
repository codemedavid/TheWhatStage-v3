import { describe, it, expect } from 'vitest'
import { splitStructuredLines, DEFAULT_STRUCTURED_MAX_BUBBLES } from './structured-lines'

/**
 * Guarantees for the structured-message line splitter used by the "bubbles"
 * layout. When the bot writes a stairway/1-3-1 reply (a lead line, options each
 * on their own line, a closing line), this turns each meaningful line into its
 * own chat bubble WITHOUT ever dropping content, and respects a hard cap.
 */
describe('splitStructuredLines', () => {
  it('returns [] for empty or whitespace-only text', () => {
    expect(splitStructuredLines('')).toEqual([])
    expect(splitStructuredLines('   \n\t \n ')).toEqual([])
  })

  it('keeps a single line as one bubble', () => {
    expect(splitStructuredLines('Salamat po sa inyong mensahe.')).toEqual([
      'Salamat po sa inyong mensahe.',
    ])
  })

  it('splits each non-empty line into its own bubble', () => {
    const reply = 'Ano po plano niyo?\nFor ordering\nFor better experience\nPara ma-monitor sales'
    expect(splitStructuredLines(reply, { maxBubbles: 5 })).toEqual([
      'Ano po plano niyo?',
      'For ordering',
      'For better experience',
      'Para ma-monitor sales',
    ])
  })

  it('drops blank separator lines but keeps all real content', () => {
    const reply = 'Lead line\n\nFor ordering\n\nFor monitoring'
    expect(splitStructuredLines(reply, { maxBubbles: 5 })).toEqual([
      'Lead line',
      'For ordering',
      'For monitoring',
    ])
  })

  it('trims surrounding whitespace on each line', () => {
    const reply = '  Lead line  \n   For ordering\nFor monitoring   '
    expect(splitStructuredLines(reply, { maxBubbles: 5 })).toEqual([
      'Lead line',
      'For ordering',
      'For monitoring',
    ])
  })

  it('caps at maxBubbles, merging the overflow into the last bubble', () => {
    const reply = 'A\nB\nC\nD\nE'
    // maxBubbles=3 -> keep first 2, fold C, D, E into the last (joined by \n)
    expect(splitStructuredLines(reply, { maxBubbles: 3 })).toEqual(['A', 'B', 'C\nD\nE'])
  })

  it('uses the default cap when maxBubbles is missing or invalid', () => {
    const reply = 'A\nB\nC\nD'
    const capped = splitStructuredLines(reply)
    expect(capped.length).toBe(DEFAULT_STRUCTURED_MAX_BUBBLES)
    // Content is never dropped: rejoining reproduces every line.
    expect(capped.join('\n')).toBe('A\nB\nC\nD')
    expect(splitStructuredLines(reply, { maxBubbles: 0 }).length).toBe(
      DEFAULT_STRUCTURED_MAX_BUBBLES,
    )
  })

  it('never drops content — every input line survives in order', () => {
    const reply = 'Uno\nDos\nTres\nKwatro\nSingko'
    const out = splitStructuredLines(reply, { maxBubbles: 2 })
    expect(out).toEqual(['Uno', 'Dos\nTres\nKwatro\nSingko'])
  })
})
