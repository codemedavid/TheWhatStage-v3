import { describe, expect, it } from 'vitest'
import { redactForLlm } from '@/lib/chatbot/pii-redact'

describe('redactForLlm — PII masking', () => {
  it('masks an email address', () => {
    const result = redactForLlm('Please contact me at juan.delacruz@gmail.com for details.')
    expect(result).not.toContain('juan.delacruz@gmail.com')
    // Should have some placeholder in its place
    expect(result.length).toBeGreaterThan(0)
  })

  it('masks an 11-digit PH mobile number (09171234567)', () => {
    const result = redactForLlm('My number is 09171234567, please text me.')
    expect(result).not.toContain('09171234567')
  })

  it('masks a +63 spaced mobile format', () => {
    const result = redactForLlm('You can reach me at +63 917 123 4567.')
    expect(result).not.toContain('+63 917 123 4567')
    expect(result).not.toContain('917 123 4567')
  })

  it('leaves a 4-digit price (1500) untouched', () => {
    const input = 'The package costs 1500 pesos.'
    const result = redactForLlm(input)
    expect(result).toContain('1500')
  })

  it('leaves a year (2026) untouched', () => {
    const input = 'This promo runs until 2026.'
    const result = redactForLlm(input)
    expect(result).toContain('2026')
  })

  it('leaves short numbers like prices and years intact together', () => {
    const input = 'Promo price is 1500 pesos and expires in 2026.'
    const result = redactForLlm(input)
    expect(result).toContain('1500')
    expect(result).toContain('2026')
  })

  it('is idempotent — running twice produces the same result as once', () => {
    const input = 'Call 09171234567 or email test@example.com for info.'
    const once = redactForLlm(input)
    const twice = redactForLlm(once)
    expect(twice).toBe(once)
  })
})
