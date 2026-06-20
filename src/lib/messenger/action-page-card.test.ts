import { describe, expect, it } from 'vitest'
import {
  GUIDING_DEFAULT_CAPTION,
  cleanCardCaption,
  resolveCardCaption,
  resolveCardLabel,
} from './action-page-card'

describe('cleanCardCaption', () => {
  it('strips markdown emphasis so the caption renders as natural plain text', () => {
    expect(cleanCardCaption('**I-click** niyo lang po *yung* button')).toBe(
      'I-click niyo lang po yung button',
    )
    expect(cleanCardCaption('__Tap__ below')).toBe('Tap below')
  })

  it('strips surrounding quotes the model sometimes adds', () => {
    expect(cleanCardCaption('"Tap the button below 👇"')).toBe('Tap the button below 👇')
    expect(cleanCardCaption("'Sige po'")).toBe('Sige po')
  })

  it('collapses whitespace to a single line', () => {
    expect(cleanCardCaption('Sige po,\n\n  i-click   niyo')).toBe('Sige po, i-click niyo')
  })

  it('keeps emoji and Tagalog hyphens (I-claim, mag-book)', () => {
    expect(cleanCardCaption('I-claim mo na slot mo, mag-book na 👇')).toBe(
      'I-claim mo na slot mo, mag-book na 👇',
    )
  })

  it('returns empty string for non-string input', () => {
    expect(cleanCardCaption(null)).toBe('')
    expect(cleanCardCaption(undefined)).toBe('')
    expect(cleanCardCaption(42)).toBe('')
  })
})

describe('resolveCardCaption', () => {
  it('uses the AI caption when present', () => {
    expect(resolveCardCaption('Sige po, i-click niyo lang po sa baba 👇')).toBe(
      'Sige po, i-click niyo lang po sa baba 👇',
    )
  })

  it('falls back to the guiding default — never the page title — when the AI caption is empty', () => {
    expect(resolveCardCaption('')).toBe(GUIDING_DEFAULT_CAPTION)
    expect(resolveCardCaption('   ')).toBe(GUIDING_DEFAULT_CAPTION)
    expect(resolveCardCaption(null)).toBe(GUIDING_DEFAULT_CAPTION)
  })

  it('cleans markdown out of the AI caption (natural font)', () => {
    expect(resolveCardCaption('**Tap** the button below 👇')).toBe(
      'Tap the button below 👇',
    )
  })

  it('clamps to the 640-char Messenger button-template body cap', () => {
    const long = 'a'.repeat(900)
    expect(resolveCardCaption(long).length).toBe(640)
  })
})

describe('resolveCardLabel', () => {
  it('prefers the AI label', () => {
    expect(resolveCardLabel('Simulan na 🎵', 'Open form')).toBe('Simulan na 🎵')
  })

  it('falls back to the configured cta_label when the AI omits a label', () => {
    expect(resolveCardLabel('', 'Open form')).toBe('Open form')
    expect(resolveCardLabel(null, 'Open form')).toBe('Open form')
  })

  it('falls back to a sane default when nothing is configured', () => {
    expect(resolveCardLabel('', null)).toBe('Open')
    expect(resolveCardLabel('', '')).toBe('Open')
  })

  it('clamps to the Messenger 20-char button-title cap', () => {
    expect(resolveCardLabel('A'.repeat(40), 'Open form').length).toBe(20)
  })
})
