import { describe, expect, it } from 'vitest'
import {
  normalizeEmail,
  normalizePhone,
  splitName,
  sha256,
  hashList,
} from './capi-payload'

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Bar.COM  ')).toBe('foo@bar.com')
  })
  it('returns null for empty string', () => {
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail('   ')).toBeNull()
  })
})

describe('normalizePhone', () => {
  it('strips non-digits', () => {
    expect(normalizePhone('+63 917 555 1234')).toBe('639175551234')
  })
  it('keeps leading zeros from local format', () => {
    expect(normalizePhone('09175551234')).toBe('09175551234')
  })
  it('returns null when no digits', () => {
    expect(normalizePhone('abc')).toBeNull()
    expect(normalizePhone('')).toBeNull()
  })
})

describe('splitName', () => {
  it('splits on first whitespace', () => {
    expect(splitName('John Angelo David')).toEqual({ first: 'john', last: 'angelo david' })
  })
  it('single token → first only', () => {
    expect(splitName('Madonna')).toEqual({ first: 'madonna', last: null })
  })
  it('empty → both null', () => {
    expect(splitName('')).toEqual({ first: null, last: null })
    expect(splitName('   ')).toEqual({ first: null, last: null })
  })
  it('trims surrounding whitespace', () => {
    expect(splitName('  Ada  Lovelace  ')).toEqual({ first: 'ada', last: 'lovelace' })
  })
})

describe('sha256 / hashList', () => {
  it('sha256 returns 64-char hex', () => {
    const h = sha256('foo@bar.com')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    // Known SHA-256 of "foo@bar.com"
    expect(h).toBe('0c7e6a405862e402eb76a70f8a26fc732d07c32931e9fae9ab1582911d2e8a3b')
  })

  it('hashList drops empties and hashes the rest', () => {
    expect(hashList(['a', '', null, 'b'])).toEqual([sha256('a'), sha256('b')])
  })

  it('hashList returns null when result is empty', () => {
    expect(hashList([])).toBeNull()
    expect(hashList(['', null, undefined])).toBeNull()
  })
})
