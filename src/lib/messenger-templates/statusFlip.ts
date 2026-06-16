// Single source of truth for translating Meta's message-template review state
// into our local meta_status enum, and for building the row-update field set.
//
// Four code paths flip a template's status and MUST agree:
//   1. submitTemplateForReview / submitTemplatesForReview (synchronous create response)
//   2. refreshTemplateStatus / refreshTemplateStatuses (on-demand + live poll)
//   3. /api/cron/template-status-poll (background backstop)
//   4. the message_template_status_update webhook handler
// Keeping the mapping here prevents these four writers from drifting apart.

import type { TemplateMetaStatus } from './types'

/**
 * Map Meta's message-template status (or webhook event) to our local enum.
 *
 * Meta's enum is LARGER than our five values:
 *   APPROVED, PENDING, REJECTED, DISABLED, IN_APPEAL,
 *   PENDING_DELETION, DELETED, PAUSED, LIMIT_EXCEEDED, ARCHIVED.
 *
 * We collapse the extra states deliberately. Anything that is no longer
 * sendable (paused/deleted/limit-exceeded/archived) becomes 'disabled' so the
 * AI Follow-Up Agent — which only sends 'approved' templates — stops offering
 * it. IN_APPEAL means Meta rejected it and the user is contesting, so we keep
 * it actionable as 'rejected'. Unknown values stay 'pending' rather than being
 * optimistically treated as approved/sendable.
 */
export function mapMetaStatus(raw: string | undefined | null): TemplateMetaStatus {
  switch ((raw ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'approved'
    case 'PENDING':
    case 'PENDING_REVIEW':
      return 'pending'
    case 'REJECTED':
    case 'IN_APPEAL':
      return 'rejected'
    case 'DISABLED':
    case 'PAUSED':
    case 'PENDING_DELETION':
    case 'DELETED':
    case 'LIMIT_EXCEEDED':
    case 'ARCHIVED':
      return 'disabled'
    default:
      return 'pending'
  }
}

// The Meta status/event tokens we positively recognize. Anything outside this
// set is genuinely unknown (e.g. a future event token).
const KNOWN_META_TOKENS = new Set([
  'APPROVED', 'PENDING', 'PENDING_REVIEW', 'REJECTED', 'IN_APPEAL',
  'DISABLED', 'PAUSED', 'PENDING_DELETION', 'DELETED', 'LIMIT_EXCEEDED', 'ARCHIVED',
])

/**
 * Like mapMetaStatus, but returns null for an unrecognized token instead of
 * defaulting to 'pending'. Use this when reacting to a PUSHED webhook event:
 * an unknown event token must NOT blindly overwrite an existing terminal status
 * (e.g. flip an 'approved' template back to 'pending' and yank it from the
 * Agent). The 'pending' default is only safe in the poll/refresh path, where the
 * value is Meta's authoritative `status` field for a row we already know is pending.
 */
export function mapMetaStatusStrict(raw: string | undefined | null): TemplateMetaStatus | null {
  if (!raw || !KNOWN_META_TOKENS.has(raw.toUpperCase())) return null
  return mapMetaStatus(raw)
}

export interface BuildStatusUpdateOpts {
  /** Meta's rejected_reason (persisted only when the local status is rejected). */
  rejectedReason?: string | null
  /** Meta's template id, to backfill when we don't already have one. */
  metaTemplateId?: string | null
  /** Whether the row already has a meta_template_id (so we don't overwrite it). */
  hadMetaTemplateId?: boolean
  /** Override for "now" (tests). Defaults to the current time. */
  now?: string
}

/**
 * Build the column patch to apply to messenger_message_templates for a status
 * transition. Centralizing this keeps approved_at / rejection-reason / id
 * backfill behavior identical across every writer.
 */
export function buildStatusUpdate(
  status: TemplateMetaStatus,
  opts: BuildStatusUpdateOpts = {},
): Record<string, unknown> {
  const update: Record<string, unknown> = {
    meta_status: status,
    meta_rejection_reason: status === 'rejected' ? (opts.rejectedReason ?? null) : null,
  }
  if (status === 'approved') {
    update.approved_at = opts.now ?? new Date().toISOString()
  }
  if (opts.metaTemplateId && !opts.hadMetaTemplateId) {
    update.meta_template_id = opts.metaTemplateId
  }
  return update
}
