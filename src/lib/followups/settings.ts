// src/lib/followups/settings.ts
//
// Per-user configuration for the silent auto-followup engine. Single source
// of truth for the default schedule and the zod schema enforced at write
// time. The engine reads settings via loadFollowupSettings and resolves a
// compact snapshot via resolveEnabledOffsets — that snapshot is persisted
// on each lead_followup_schedules row so in-flight schedules are unaffected
// by subsequent setting changes.

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

const MIN_OFFSET_MS = 60_000                       // 1 minute
const MAX_OFFSET_MS = 7 * 24 * 3_600_000           // 7 days
const TOUCHPOINT_COUNT = 7

const TouchpointSchema = z.object({
  enabled: z.boolean(),
  offset_ms: z.number().int().min(MIN_OFFSET_MS).max(MAX_OFFSET_MS),
})

export const FOLLOWUP_SETTINGS_SCHEMA = z
  .object({
    enabled: z.boolean(),
    touchpoints: z.array(TouchpointSchema).length(TOUCHPOINT_COUNT),
  })
  .superRefine((val, ctx) => {
    // Enabled rows must be strictly increasing in offset_ms.
    const enabled = val.touchpoints
      .map((t, idx) => ({ t, idx }))
      .filter((x) => x.t.enabled)
    for (let i = 1; i < enabled.length; i++) {
      if (enabled[i].t.offset_ms <= enabled[i - 1].t.offset_ms) {
        ctx.addIssue({
          code: 'custom',
          message: `Touchpoint ${enabled[i].idx + 1} must be later than touchpoint ${enabled[i - 1].idx + 1}.`,
          path: ['touchpoints', enabled[i].idx, 'offset_ms'],
        })
      }
    }
    // If the master toggle is ON, at least one row must be enabled.
    if (val.enabled && enabled.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enable at least one touchpoint or turn the master toggle off.',
        path: ['touchpoints'],
      })
    }
  })

export type FollowupSettings = z.infer<typeof FOLLOWUP_SETTINGS_SCHEMA>

export const DEFAULT_FOLLOWUP_SETTINGS: FollowupSettings = {
  enabled: true,
  touchpoints: [
    { enabled: true, offset_ms: 5 * 60_000 },        // 5m
    { enabled: true, offset_ms: 60 * 60_000 },       // 1h
    { enabled: true, offset_ms: 5 * 3_600_000 },     // 5h
    { enabled: true, offset_ms: 8 * 3_600_000 },     // 8h
    { enabled: true, offset_ms: 12 * 3_600_000 },    // 12h
    { enabled: true, offset_ms: 18 * 3_600_000 },    // 18h
    { enabled: true, offset_ms: 24 * 3_600_000 },    // 24h
  ],
}

export interface SnapshotEntry {
  offset_ms: number
  slot: number
}

export function resolveEnabledOffsets(settings: FollowupSettings): SnapshotEntry[] {
  if (!settings.enabled) return []
  const entries: SnapshotEntry[] = settings.touchpoints
    .map((t, slot) => ({ t, slot }))
    .filter((x) => x.t.enabled)
    .map((x) => ({ slot: x.slot, offset_ms: x.t.offset_ms }))
  if (entries.length === 0) return []
  entries.sort((a, b) => a.offset_ms - b.offset_ms)
  return entries
}

export async function loadFollowupSettings(
  admin: SupabaseClient,
  userId: string,
): Promise<FollowupSettings> {
  const { data, error } = await admin
    .from('chatbot_configs')
    .select('followup_settings')
    .eq('user_id', userId)
    .maybeSingle<{ followup_settings: unknown }>()

  if (error) {
    console.warn('[followups.settings] db error, using defaults', error)
    return DEFAULT_FOLLOWUP_SETTINGS
  }
  if (!data || data.followup_settings == null) {
    return DEFAULT_FOLLOWUP_SETTINGS
  }
  const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(data.followup_settings)
  if (!parsed.success) {
    console.warn('[followups.settings] parse failed, using defaults', parsed.error.issues[0])
    return DEFAULT_FOLLOWUP_SETTINGS
  }
  return parsed.data
}
