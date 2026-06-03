import { describe, it, expect } from 'vitest'
import { getEntitlement, isSubscriber, getViewer, type EntitlementReason } from './access'
import type { SessionContext } from '@/lib/auth/get-session'
import type { AccessLevel, CourseStatus } from './types'

function session(over: Partial<SessionContext> = {}): SessionContext {
  return {
    userId: 'u1',
    email: 'a@b.com',
    fullName: 'A',
    role: 'user',
    status: 'active',
    subscriptionTier: 'free',
    ...over,
  }
}

const GUEST: SessionContext | null = null
const MEMBER = session({ subscriptionTier: 'free' })
const PRO = session({ subscriptionTier: 'pro' })
const ADMIN = session({ role: 'admin' })
const SUPER = session({ role: 'superadmin' })

function course(accessLevel: AccessLevel, status: CourseStatus = 'published') {
  return { accessLevel, status }
}

describe('isSubscriber / getViewer', () => {
  it('treats pro + staff as subscribers, free as not', () => {
    expect(isSubscriber(GUEST)).toBe(false)
    expect(isSubscriber(MEMBER)).toBe(false)
    expect(isSubscriber(PRO)).toBe(true)
    expect(isSubscriber(ADMIN)).toBe(true)
    expect(isSubscriber(SUPER)).toBe(true)
  })
  it('maps viewers correctly', () => {
    expect(getViewer(GUEST)).toBe('guest')
    expect(getViewer(MEMBER)).toBe('member')
    expect(getViewer(PRO)).toBe('subscriber')
  })
})

describe('getEntitlement — mirrors the SQL truth table', () => {
  type Row = { access: AccessLevel; preview: boolean; viewer: SessionContext | null; reason: EntitlementReason; allowed: boolean }
  const rows: Row[] = [
    // public — everyone
    { access: 'public', preview: false, viewer: GUEST, allowed: true, reason: 'ok' },
    { access: 'public', preview: false, viewer: MEMBER, allowed: true, reason: 'ok' },
    { access: 'public', preview: false, viewer: PRO, allowed: true, reason: 'ok' },
    // authenticated, non-preview
    { access: 'authenticated', preview: false, viewer: GUEST, allowed: false, reason: 'needs_login' },
    { access: 'authenticated', preview: false, viewer: MEMBER, allowed: true, reason: 'ok' },
    { access: 'authenticated', preview: false, viewer: PRO, allowed: true, reason: 'ok' },
    // authenticated, preview → anyone
    { access: 'authenticated', preview: true, viewer: GUEST, allowed: true, reason: 'ok' },
    // subscriber, non-preview
    { access: 'subscriber', preview: false, viewer: GUEST, allowed: false, reason: 'needs_login' },
    { access: 'subscriber', preview: false, viewer: MEMBER, allowed: false, reason: 'needs_subscription' },
    { access: 'subscriber', preview: false, viewer: PRO, allowed: true, reason: 'ok' },
    { access: 'subscriber', preview: false, viewer: ADMIN, allowed: true, reason: 'ok' },
    { access: 'subscriber', preview: false, viewer: SUPER, allowed: true, reason: 'ok' },
    // subscriber, preview → anyone
    { access: 'subscriber', preview: true, viewer: GUEST, allowed: true, reason: 'ok' },
    { access: 'subscriber', preview: true, viewer: MEMBER, allowed: true, reason: 'ok' },
  ]

  for (const r of rows) {
    const who = r.viewer === null ? 'guest' : `${r.viewer.role}/${r.viewer.subscriptionTier}`
    it(`${r.access}${r.preview ? '+preview' : ''} for ${who} → ${r.reason}`, () => {
      const ent = getEntitlement(r.viewer, course(r.access), { isPreview: r.preview })
      expect(ent.allowed).toBe(r.allowed)
      expect(ent.reason).toBe(r.reason)
    })
  }
})

describe('getEntitlement — draft courses', () => {
  it('hides drafts from everyone but superadmin', () => {
    for (const v of [GUEST, MEMBER, PRO, ADMIN]) {
      const ent = getEntitlement(v, course('public', 'draft'))
      expect(ent.allowed).toBe(false)
      expect(ent.reason).toBe('not_found')
    }
    expect(getEntitlement(SUPER, course('subscriber', 'draft')).allowed).toBe(true)
  })
})
