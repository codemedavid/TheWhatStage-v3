// src/lib/followups/config.ts
//
// Single source of truth for the auto-followup schedule. If you change
// OFFSETS_MS, also update FALLBACK_POOL in generateMessage.ts to keep the
// pool length in sync.

export const OFFSETS_MS = [
  5 * 60_000,        // 5 minutes
  60 * 60_000,       // 1 hour
  5 * 3600_000,      // 5 hours
  8 * 3600_000,      // 8 hours
  12 * 3600_000,     // 12 hours
  18 * 3600_000,     // 18 hours
  24 * 3600_000,     // 24 hours
] as const

export const MAX_OFFSET_IDX = OFFSETS_MS.length - 1

export const REAL_CONVERSATION_LEAD_MSG_THRESHOLD = 4
export const MAX_LIFETIME_LEAD_INBOUND = 15

export type ConversationKind = 'generic' | 'real'
export type FollowupStatus = 'pending' | 'running' | 'done' | 'cancelled' | 'failed'
