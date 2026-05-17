import { describe, expect, it } from 'vitest'
import { resolveStatusForOrder, snapshotMethod } from './server'

describe('snapshotMethod', () => {
  it('returns kind + name from a payment method row', () => {
    const snap = snapshotMethod({ kind: 'gcash', name: 'My GCash' })
    expect(snap).toEqual({ method_kind: 'gcash', method_name: 'My GCash' })
  })
})

describe('resolveStatusForOrder', () => {
  it('maps submitted to pending', () => {
    expect(resolveStatusForOrder('submitted')).toBe('pending')
  })
  it('maps verified to paid', () => {
    expect(resolveStatusForOrder('verified')).toBe('paid')
  })
  it('maps rejected to failed', () => {
    expect(resolveStatusForOrder('rejected')).toBe('failed')
  })
})
