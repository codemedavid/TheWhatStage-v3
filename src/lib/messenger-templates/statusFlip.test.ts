import { describe, expect, it } from 'vitest'
import { mapMetaStatus, mapMetaStatusStrict, buildStatusUpdate } from './statusFlip'

describe('mapMetaStatus', () => {
  it('maps the core states 1:1', () => {
    expect(mapMetaStatus('APPROVED')).toBe('approved')
    expect(mapMetaStatus('PENDING')).toBe('pending')
    expect(mapMetaStatus('REJECTED')).toBe('rejected')
    expect(mapMetaStatus('DISABLED')).toBe('disabled')
  })

  it('collapses non-sendable Meta states to disabled', () => {
    for (const s of ['PAUSED', 'PENDING_DELETION', 'DELETED', 'LIMIT_EXCEEDED', 'ARCHIVED']) {
      expect(mapMetaStatus(s)).toBe('disabled')
    }
  })

  it('treats IN_APPEAL as rejected (actionable)', () => {
    expect(mapMetaStatus('IN_APPEAL')).toBe('rejected')
  })

  it('is case-insensitive', () => {
    expect(mapMetaStatus('approved')).toBe('approved')
    expect(mapMetaStatus('Pending')).toBe('pending')
  })

  it('defaults unknown/empty to pending (never optimistically approved)', () => {
    expect(mapMetaStatus('SOMETHING_NEW')).toBe('pending')
    expect(mapMetaStatus(undefined)).toBe('pending')
    expect(mapMetaStatus(null)).toBe('pending')
    expect(mapMetaStatus('')).toBe('pending')
  })
})

describe('mapMetaStatusStrict', () => {
  it('matches mapMetaStatus for recognized tokens', () => {
    expect(mapMetaStatusStrict('APPROVED')).toBe('approved')
    expect(mapMetaStatusStrict('PAUSED')).toBe('disabled')
    expect(mapMetaStatusStrict('IN_APPEAL')).toBe('rejected')
  })

  it('returns null (no blind downgrade) for unrecognized/empty tokens', () => {
    // e.g. a FLAGGED/REINSTATED or future event token must not flip an approved
    // template to a defaulted "pending".
    expect(mapMetaStatusStrict('FLAGGED')).toBeNull()
    expect(mapMetaStatusStrict('SOMETHING_NEW')).toBeNull()
    expect(mapMetaStatusStrict(undefined)).toBeNull()
    expect(mapMetaStatusStrict('')).toBeNull()
  })
})

describe('buildStatusUpdate', () => {
  it('sets approved_at only when approved', () => {
    const u = buildStatusUpdate('approved', { now: '2026-06-12T00:00:00.000Z' })
    expect(u.meta_status).toBe('approved')
    expect(u.approved_at).toBe('2026-06-12T00:00:00.000Z')
    expect(u.meta_rejection_reason).toBeNull()

    expect(buildStatusUpdate('pending').approved_at).toBeUndefined()
  })

  it('persists rejection reason only when rejected', () => {
    expect(buildStatusUpdate('rejected', { rejectedReason: 'PROMOTIONAL' }).meta_rejection_reason).toBe('PROMOTIONAL')
    // non-rejected statuses clear the reason
    expect(buildStatusUpdate('approved', { rejectedReason: 'PROMOTIONAL' }).meta_rejection_reason).toBeNull()
    expect(buildStatusUpdate('pending', { rejectedReason: 'PROMOTIONAL' }).meta_rejection_reason).toBeNull()
  })

  it('backfills meta_template_id only when missing', () => {
    expect(buildStatusUpdate('approved', { metaTemplateId: 'tpl_1', hadMetaTemplateId: false }).meta_template_id).toBe('tpl_1')
    expect(buildStatusUpdate('approved', { metaTemplateId: 'tpl_1', hadMetaTemplateId: true }).meta_template_id).toBeUndefined()
    expect(buildStatusUpdate('approved', {}).meta_template_id).toBeUndefined()
  })
})
