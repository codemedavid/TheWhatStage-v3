import { describe, expect, it } from 'vitest'
import {
  isAccountStatus,
  pathForBlockedStatus,
  zAccountStatus,
} from '../account-status'

describe('zAccountStatus', () => {
  it('accepts the three valid statuses', () => {
    expect(zAccountStatus.parse('pending')).toBe('pending')
    expect(zAccountStatus.parse('active')).toBe('active')
    expect(zAccountStatus.parse('paused')).toBe('paused')
  })

  it('rejects anything else', () => {
    expect(zAccountStatus.safeParse('disabled').success).toBe(false)
    expect(zAccountStatus.safeParse('').success).toBe(false)
    expect(zAccountStatus.safeParse(null).success).toBe(false)
  })
})

describe('isAccountStatus', () => {
  it('narrows to AccountStatus', () => {
    expect(isAccountStatus('active')).toBe(true)
    expect(isAccountStatus('pending')).toBe(true)
    expect(isAccountStatus('paused')).toBe(true)
    expect(isAccountStatus('superadmin')).toBe(false)
    expect(isAccountStatus(undefined)).toBe(false)
  })
})

describe('pathForBlockedStatus', () => {
  it('routes pending and paused, returns null for active', () => {
    expect(pathForBlockedStatus('pending')).toBe('/account-pending')
    expect(pathForBlockedStatus('paused')).toBe('/account-paused')
    expect(pathForBlockedStatus('active')).toBeNull()
  })
})
