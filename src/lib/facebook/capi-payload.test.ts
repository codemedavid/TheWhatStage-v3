import { describe, expect, it } from 'vitest'
import {
  normalizeEmail,
  normalizePhone,
  splitName,
  sha256,
  hashList,
  buildUserData,
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

describe('buildUserData', () => {
  const base = {
    fbPageId: 'PAGE123',
    psid: 'PSID456',
    leadId: 'lead-uuid-1',
    leadName: 'John Angelo David',
    leadPhones: ['+63 917 555 1234', '09175551234'],
    leadEmails: ['Foo@Bar.COM'],
    clientIp: '203.0.113.10',
    clientUserAgent: 'vitest',
  }

  it('hashes all contact fields and splits name', () => {
    const ud = buildUserData(base)
    expect(ud.page_id).toBe('PAGE123')
    expect(ud.page_scoped_user_id).toBe('PSID456')
    expect(ud.em).toEqual([sha256('foo@bar.com')])
    expect(ud.ph).toEqual([sha256('639175551234'), sha256('09175551234')])
    expect(ud.fn).toEqual([sha256('john')])
    expect(ud.ln).toEqual([sha256('angelo david')])
    expect(ud.external_id).toEqual([sha256('lead-uuid-1')])
    expect(ud.client_ip_address).toBe('203.0.113.10')
    expect(ud.client_user_agent).toBe('vitest')
  })

  it('omits empty hashed arrays entirely', () => {
    const ud = buildUserData({ ...base, leadPhones: [], leadEmails: [], leadName: null, leadId: null })
    expect(ud).not.toHaveProperty('em')
    expect(ud).not.toHaveProperty('ph')
    expect(ud).not.toHaveProperty('fn')
    expect(ud).not.toHaveProperty('ln')
    expect(ud).not.toHaveProperty('external_id')
  })

  it('omits missing ip / user-agent', () => {
    const ud = buildUserData({ ...base, clientIp: null, clientUserAgent: null })
    expect(ud).not.toHaveProperty('client_ip_address')
    expect(ud).not.toHaveProperty('client_user_agent')
  })

  it('single-token name → fn only, ln omitted', () => {
    const ud = buildUserData({ ...base, leadName: 'Madonna' })
    expect(ud.fn).toEqual([sha256('madonna')])
    expect(ud).not.toHaveProperty('ln')
  })
})
