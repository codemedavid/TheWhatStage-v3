import { describe, expect, it } from 'vitest'
import { parseOffset, formatOffset } from './offsets'

describe('parseOffset', () => {
  it('parses negative day offsets', () => {
    expect(parseOffset('-3d')).toBe(-3 * 24 * 60 * 60 * 1000)
    expect(parseOffset('-1d')).toBe(-1 * 24 * 60 * 60 * 1000)
  })
  it('parses negative hour and minute offsets', () => {
    expect(parseOffset('-2h')).toBe(-2 * 60 * 60 * 1000)
    expect(parseOffset('-10m')).toBe(-10 * 60 * 1000)
    expect(parseOffset('-5m')).toBe(-5 * 60 * 1000)
  })
  it('parses positive offsets', () => {
    expect(parseOffset('+1h')).toBe(60 * 60 * 1000)
    expect(parseOffset('+1d')).toBe(24 * 60 * 60 * 1000)
  })
  it('parses zero', () => {
    expect(parseOffset('0')).toBe(0)
    expect(parseOffset('+0')).toBe(0)
    expect(parseOffset('-0')).toBe(0)
    expect(parseOffset('0m')).toBe(0)
    expect(parseOffset('0h')).toBe(0)
    expect(parseOffset('0d')).toBe(0)
  })
  it('treats unsigned values as positive', () => {
    expect(parseOffset('30m')).toBe(30 * 60 * 1000)
  })
  it('clamps to ±30d', () => {
    expect(parseOffset('-31d')).toBeNull()
    expect(parseOffset('+999d')).toBeNull()
  })
  it('rejects invalid input', () => {
    expect(parseOffset('')).toBeNull()
    expect(parseOffset('abc')).toBeNull()
    expect(parseOffset('-3y')).toBeNull()
    expect(parseOffset('1.5h')).toBeNull()
    expect(parseOffset('--5m')).toBeNull()
    expect(parseOffset('5')).toBeNull()
    expect(parseOffset('-3')).toBeNull()
  })
})

describe('formatOffset', () => {
  it('formats negative day, hour, minute', () => {
    expect(formatOffset(-3 * 24 * 60 * 60 * 1000)).toBe('-3d')
    expect(formatOffset(-2 * 60 * 60 * 1000)).toBe('-2h')
    expect(formatOffset(-10 * 60 * 1000)).toBe('-10m')
  })
  it('formats positive', () => {
    expect(formatOffset(60 * 60 * 1000)).toBe('+1h')
    expect(formatOffset(0)).toBe('0')
    expect(formatOffset(5 * 60 * 1000)).toBe('+5m')
  })
  it('round-trips parseOffset for canonical inputs', () => {
    for (const s of ['-3d', '-2h', '-10m', '+1h', '+1d', '0']) {
      const ms = parseOffset(s)
      expect(ms).not.toBeNull()
      expect(formatOffset(ms!)).toBe(s)
    }
  })
})
