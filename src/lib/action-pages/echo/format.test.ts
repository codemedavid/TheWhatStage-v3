import { describe, expect, it } from 'vitest'
import {
  formatCurrency,
  formatDateInTz,
  formatTimeInTz,
  formatDateTimeInTz,
  formatDurationMinutes,
} from './format'

describe('formatCurrency', () => {
  it('formats PHP amounts with peso sign', () => {
    expect(formatCurrency(2500, 'PHP')).toMatch(/₱2,500/)
  })

  it('formats USD amounts', () => {
    expect(formatCurrency(99.5, 'USD')).toMatch(/\$99\.50/)
  })

  it('falls back to "<amount> <currency>" on an unknown currency code', () => {
    expect(formatCurrency(10, 'XYZ')).toBe('10.00 XYZ')
  })

  it('returns empty string on null/undefined/NaN', () => {
    expect(formatCurrency(null, 'PHP')).toBe('')
    expect(formatCurrency(undefined, 'PHP')).toBe('')
    expect(formatCurrency(Number.NaN, 'PHP')).toBe('')
  })
})

describe('formatDateInTz', () => {
  it('formats an ISO timestamp in Asia/Manila as a medium date', () => {
    const out = formatDateInTz('2026-05-28T06:30:00Z', 'Asia/Manila')
    expect(out).toMatch(/May 28, 2026/)
  })

  it('returns empty string on invalid input', () => {
    expect(formatDateInTz('not-a-date', 'Asia/Manila')).toBe('')
    expect(formatDateInTz(null, 'Asia/Manila')).toBe('')
  })
})

describe('formatTimeInTz', () => {
  it('formats an ISO timestamp in Asia/Manila as a short time', () => {
    const out = formatTimeInTz('2026-05-28T06:30:00Z', 'Asia/Manila')
    expect(out).toMatch(/2:30/)
  })
})

describe('formatDateTimeInTz', () => {
  it('combines date and time in the same timezone', () => {
    const out = formatDateTimeInTz('2026-05-28T06:30:00Z', 'Asia/Manila')
    expect(out).toMatch(/May 28, 2026/)
    expect(out).toMatch(/2:30/)
  })
})

describe('formatDurationMinutes', () => {
  it('formats minutes as "30 min"', () => {
    expect(formatDurationMinutes(30)).toBe('30 min')
  })

  it('returns empty string on null/undefined', () => {
    expect(formatDurationMinutes(null)).toBe('')
    expect(formatDurationMinutes(undefined)).toBe('')
  })
})
