import { describe, expect, it } from 'vitest'
import { renderEchoTemplate } from './render'

const KNOWN = new Set([
  'customer.name',
  'customer.email',
  'customer.phone',
  'fb.name',
  'booking.date',
  'booking.time',
])

describe('renderEchoTemplate', () => {
  it('returns the template unchanged when it has no placeholders', () => {
    const result = renderEchoTemplate('Hello world', {}, KNOWN)
    expect(result.text).toBe('Hello world')
    expect(result.warnings).toEqual([])
  })

  it('substitutes a known dotted path', () => {
    const result = renderEchoTemplate(
      'Hi {{customer.name}}!',
      { customer: { name: 'Maria' } },
      KNOWN,
    )
    expect(result.text).toBe('Hi Maria!')
    expect(result.warnings).toEqual([])
  })

  it('renders empty string for a known path with no value', () => {
    const result = renderEchoTemplate(
      'Hi {{customer.name}}!',
      { customer: {} },
      KNOWN,
    )
    expect(result.text).toBe('Hi !')
    expect(result.warnings).toEqual([])
  })

  it('renders empty string for a missing nested object', () => {
    const result = renderEchoTemplate('{{customer.name}}', {}, KNOWN)
    expect(result.text).toBe('')
  })

  it('tolerates whitespace inside braces', () => {
    const result = renderEchoTemplate(
      '{{  customer.name  }}',
      { customer: { name: 'Ana' } },
      KNOWN,
    )
    expect(result.text).toBe('Ana')
  })

  it('falls back to the next operand in an || chain', () => {
    const result = renderEchoTemplate(
      '{{fb.name || customer.name}}',
      { fb: {}, customer: { name: 'Liza' } },
      KNOWN,
    )
    expect(result.text).toBe('Liza')
  })

  it('falls back to a quoted literal when all paths are empty', () => {
    const result = renderEchoTemplate(
      '{{fb.name || customer.name || "there"}}',
      { fb: {}, customer: {} },
      KNOWN,
    )
    expect(result.text).toBe('there')
  })

  it('accepts whitespace around || operators and quoted literals', () => {
    const result = renderEchoTemplate(
      '{{ fb.name   ||  "Hello there" }}',
      { fb: {} },
      KNOWN,
    )
    expect(result.text).toBe('Hello there')
  })

  it('emits an "unknown" warning for paths not in the known set, rendering empty', () => {
    const result = renderEchoTemplate(
      '{{customer.adress}}',
      { customer: {} },
      KNOWN,
    )
    expect(result.text).toBe('')
    expect(result.warnings).toEqual([{ token: 'customer.adress', reason: 'unknown' }])
  })

  it('emits a "malformed" warning for unsupported syntax and leaves literal text', () => {
    const result = renderEchoTemplate(
      'pre {{#if customer.name}}x{{/if}} post',
      { customer: {} },
      KNOWN,
    )
    expect(result.text).toBe('pre {{#if customer.name}}x{{/if}} post')
    expect(result.warnings).toEqual([
      { token: '#if customer.name', reason: 'malformed' },
      { token: '/if', reason: 'malformed' },
    ])
  })

  it('renders multiple placeholders in one template', () => {
    const result = renderEchoTemplate(
      'Hi {{customer.name}}, you are booked at {{booking.time}} on {{booking.date}}.',
      {
        customer: { name: 'Maria' },
        booking: { time: '2:30 PM', date: 'May 28, 2026' },
      },
      KNOWN,
    )
    expect(result.text).toBe('Hi Maria, you are booked at 2:30 PM on May 28, 2026.')
  })

  it('stringifies numeric values', () => {
    const result = renderEchoTemplate(
      '{{customer.phone}}',
      { customer: { phone: 1234 } },
      new Set(['customer.phone']),
    )
    expect(result.text).toBe('1234')
  })

  it('hard-errors above the placeholder cap of 500', () => {
    const tpl = '{{customer.name}}'.repeat(501)
    expect(() =>
      renderEchoTemplate(tpl, { customer: { name: 'X' } }, KNOWN),
    ).toThrow(/too many placeholders/i)
  })

  it('rejects bare double-braces without a path as malformed', () => {
    const result = renderEchoTemplate('a {{}} b', {}, KNOWN)
    expect(result.text).toBe('a {{}} b')
    expect(result.warnings).toEqual([{ token: '', reason: 'malformed' }])
  })
})
