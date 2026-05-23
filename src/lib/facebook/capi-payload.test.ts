import { describe, expect, it } from 'vitest'
import {
  normalizeEmail,
  normalizePhone,
  splitName,
  sha256,
  hashList,
  buildUserData,
  buildCustomData,
  buildEventEnvelope,
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
  })

  it('never emits client_ip_address / client_user_agent — Meta rejects them for business_messaging', () => {
    const ud = buildUserData(base)
    expect(ud).not.toHaveProperty('client_ip_address')
    expect(ud).not.toHaveProperty('client_user_agent')
  })

  it('omits empty hashed arrays entirely', () => {
    const ud = buildUserData({ ...base, leadPhones: [], leadEmails: [], leadName: null, leadId: null })
    expect(ud).not.toHaveProperty('em')
    expect(ud).not.toHaveProperty('ph')
    expect(ud).not.toHaveProperty('fn')
    expect(ud).not.toHaveProperty('ln')
    expect(ud).not.toHaveProperty('external_id')
  })

  it('single-token name → fn only, ln omitted', () => {
    const ud = buildUserData({ ...base, leadName: 'Madonna' })
    expect(ud.fn).toEqual([sha256('madonna')])
    expect(ud).not.toHaveProperty('ln')
  })
})

describe('buildCustomData', () => {
  it('catalog with order → currency, value, content_ids, num_items, order_id, content_type', () => {
    const cd = buildCustomData({
      kind: 'catalog',
      actionPageId: 'ap-1',
      parsedData: {},
      pageConfig: {},
      businessOrderId: 'order-1',
      catalogOrder: {
        subtotal: 199.5,
        currency: 'PHP',
        lines: [
          { business_item_id: 'p1', quantity: 2 },
          { business_item_id: 'p2', quantity: 1 },
        ],
        paymentStatus: 'paid',
      },
    })
    expect(cd).toEqual({
      currency: 'PHP',
      value: 199.5,
      content_ids: ['p1', 'p2'],
      content_type: 'product',
      num_items: 3,
      order_id: 'order-1',
    })
  })

  it('sales with payment → currency + value + order_id + content_ids', () => {
    const cd = buildCustomData({
      kind: 'sales',
      actionPageId: 'ap-2',
      parsedData: { payment_amount: 500, payment_currency: 'PHP' },
      pageConfig: {},
      businessOrderId: null,
      catalogOrder: null,
      submissionId: 'sub-1',
      hasPayment: true,
    })
    expect(cd).toEqual({
      currency: 'PHP',
      value: 500,
      order_id: 'sub-1',
      content_ids: ['ap-2'],
      content_type: 'product',
    })
  })

  it('sales with payment but no payment_currency → falls back to pageConfig.price.currency', () => {
    const cd = buildCustomData({
      kind: 'sales',
      actionPageId: 'ap-2',
      parsedData: { payment_amount: 500 },
      pageConfig: { price: { currency: 'USD' } },
      businessOrderId: null,
      catalogOrder: null,
      submissionId: 'sub-1',
      hasPayment: true,
    })
    expect(cd?.currency).toBe('USD')
    expect(cd?.value).toBe(500)
  })

  it('sales with payment but no value/currency → returns content_ids only', () => {
    const cd = buildCustomData({
      kind: 'sales',
      actionPageId: 'ap-2',
      parsedData: {},
      pageConfig: {},
      businessOrderId: null,
      catalogOrder: null,
      submissionId: 'sub-1',
      hasPayment: true,
    })
    expect(cd).toEqual({ content_ids: ['ap-2'], content_type: 'product' })
  })

  it('non-monetary kinds → content_ids only', () => {
    const cd = buildCustomData({
      kind: 'form',
      actionPageId: 'ap-3',
      parsedData: {},
      pageConfig: {},
      businessOrderId: null,
      catalogOrder: null,
    })
    expect(cd).toEqual({ content_ids: ['ap-3'], content_type: 'product' })
  })
})

describe('buildEventEnvelope', () => {
  it('assembles a complete event without event_source_url (Meta rejects it for business_messaging)', () => {
    const userData = { page_id: 'P', page_scoped_user_id: 'X' }
    const customData = { content_ids: ['ap-1'], content_type: 'product' as const }
    const env = buildEventEnvelope({
      eventName: 'Lead',
      eventId: 'sub-1',
      eventTimeMs: 1716480000000, // 2024-05-23T16:00:00Z
      userData,
      customData,
    })
    expect(env).toEqual({
      event_name: 'Lead',
      event_time: 1716480000,
      event_id: 'sub-1',
      action_source: 'business_messaging',
      messaging_channel: 'messenger',
      user_data: userData,
      custom_data: customData,
    })
    expect(env).not.toHaveProperty('event_source_url')
  })

  it('omits custom_data when not provided', () => {
    const env = buildEventEnvelope({
      eventName: 'Lead',
      eventId: 'sub-1',
      eventTimeMs: 1716480000000,
      userData: { page_id: 'P', page_scoped_user_id: 'X' },
      customData: null,
    })
    expect(env).not.toHaveProperty('custom_data')
  })
})
