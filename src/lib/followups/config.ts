// src/lib/followups/config.ts
//
// Re-exports the historical defaults plus the engine's other knobs. The
// canonical schedule lives in ./settings (DEFAULT_FOLLOWUP_SETTINGS); this
// file keeps OFFSETS_MS for any caller that still needs a static list.

import { DEFAULT_FOLLOWUP_SETTINGS } from './settings'

export const OFFSETS_MS = DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map(
  (t) => t.offset_ms,
) as readonly number[]

export const REAL_CONVERSATION_LEAD_MSG_THRESHOLD = 4
export const MAX_LIFETIME_LEAD_INBOUND = 15

export type ConversationKind = 'generic' | 'real'
export type FollowupStatus = 'pending' | 'running' | 'done' | 'cancelled' | 'failed'
