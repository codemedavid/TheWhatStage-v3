import { describe, expect, it } from 'vitest'
import { resolveEventName } from './capi-mapping'
import type { ActionPageKind } from '@/lib/action-pages/kinds'

function input(
  kind: ActionPageKind,
  outcome: string,
  hasPayment = false,
  override: string | null = null,
) {
  return { kind, outcome, hasPayment, override }
}

describe('resolveEventName — kind defaults', () => {
  it('form/submitted → Lead', () => {
    expect(resolveEventName(input('form', 'submitted'))).toEqual({ send: true, eventName: 'Lead' })
  })

  it('booking/booked → Schedule', () => {
    expect(resolveEventName(input('booking', 'booked'))).toEqual({ send: true, eventName: 'Schedule' })
  })

  it('qualification/qualified → Lead', () => {
    expect(resolveEventName(input('qualification', 'qualified'))).toEqual({ send: true, eventName: 'Lead' })
  })

  it('qualification/disqualified → skip', () => {
    expect(resolveEventName(input('qualification', 'disqualified'))).toEqual({ send: false, reason: 'outcome_skip' })
  })

  it('qualification/pending_review → skip', () => {
    expect(resolveEventName(input('qualification', 'pending_review'))).toEqual({ send: false, reason: 'outcome_skip' })
  })

  it('sales/submitted without payment → InitiateCheckout', () => {
    expect(resolveEventName(input('sales', 'submitted', false))).toEqual({ send: true, eventName: 'InitiateCheckout' })
  })

  it('sales/submitted with payment → Purchase', () => {
    expect(resolveEventName(input('sales', 'submitted', true))).toEqual({ send: true, eventName: 'Purchase' })
  })

  it('catalog/checked_out without payment → InitiateCheckout', () => {
    expect(resolveEventName(input('catalog', 'checked_out', false))).toEqual({ send: true, eventName: 'InitiateCheckout' })
  })

  it('catalog/checked_out with payment → Purchase', () => {
    expect(resolveEventName(input('catalog', 'checked_out', true))).toEqual({ send: true, eventName: 'Purchase' })
  })

  it('realestate/inquiry_submitted → Lead', () => {
    expect(resolveEventName(input('realestate', 'inquiry_submitted'))).toEqual({ send: true, eventName: 'Lead' })
  })

  it('realestate/viewing_booked → Schedule', () => {
    expect(resolveEventName(input('realestate', 'viewing_booked'))).toEqual({ send: true, eventName: 'Schedule' })
  })

  it('unknown outcome → skip', () => {
    expect(resolveEventName(input('form', 'bogus'))).toEqual({ send: false, reason: 'outcome_skip' })
  })
})

describe('resolveEventName — override precedence', () => {
  it('override "SKIP" → skip regardless of mapping', () => {
    expect(resolveEventName(input('form', 'submitted', false, 'SKIP'))).toEqual({ send: false, reason: 'outcome_skip' })
  })

  it('override "Purchase" → Purchase regardless of mapping', () => {
    expect(resolveEventName(input('form', 'submitted', false, 'Purchase'))).toEqual({ send: true, eventName: 'Purchase' })
  })

  it('override null → falls through to default mapping', () => {
    expect(resolveEventName(input('booking', 'booked', false, null))).toEqual({ send: true, eventName: 'Schedule' })
  })

  it('override with non-standard string → falls through to default mapping', () => {
    expect(resolveEventName(input('form', 'submitted', false, 'CustomEvent'))).toEqual({ send: true, eventName: 'Lead' })
  })
})

describe('resolveEventName — unknown kind fallback', () => {
  it('unknown kind → skip', () => {
    expect(resolveEventName(input('form' as ActionPageKind, 'submitted'))).toEqual({ send: true, eventName: 'Lead' })
    // explicitly test that defaultEventName's default: branch returns null for an unknown kind
    expect(resolveEventName({ kind: 'unknown_kind' as ActionPageKind, outcome: 'submitted', hasPayment: false, override: null })).toEqual({ send: false, reason: 'outcome_skip' })
  })
})
