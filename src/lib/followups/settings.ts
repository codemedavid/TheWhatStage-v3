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
const MAX_INSTRUCTION_LEN = 200
const MAX_MESSAGE_LEN = 200
const MAX_IMAGES_PER_TOUCHPOINT = 3

const TouchpointSchema = z.object({
  enabled: z.boolean(),
  offset_ms: z.number().int().min(MIN_OFFSET_MS).max(MAX_OFFSET_MS),
  // The AI guide (used only when ai_enabled is on).
  instruction: z.string().trim().max(MAX_INSTRUCTION_LEN).default(''),
  // The manually authored message sent in manual mode (ai_enabled off).
  // `{name}` is interpolated at send time. Optional for back-compat with rows
  // stored before this field existed — a blank/absent message falls back to the
  // curated per-offset pool so a touchpoint is never dropped.
  message: z.string().trim().max(MAX_MESSAGE_LEN).optional(),
  image_media_asset_ids: z.array(z.string().uuid())
    .max(MAX_IMAGES_PER_TOUCHPOINT)
    .default([]),
  action_page_id: z.string().uuid().nullable().default(null),
})

export const FOLLOWUP_SETTINGS_SCHEMA = z
  .object({
    enabled: z.boolean(),
    // Master AI toggle. OFF by default: follow-ups send the manual `message`
    // per touchpoint (no LLM cost). Flip ON to generate each nudge with the LLM.
    ai_enabled: z.boolean().default(false),
    touchpoints: z.array(TouchpointSchema).length(TOUCHPOINT_COUNT),
  })
  .superRefine((val, ctx) => {
    const enabled = val.touchpoints
      .map((t, idx) => ({ t, idx }))
      .filter((x) => x.t.enabled)
    // Enabled rows must be strictly increasing in offset_ms.
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
  ai_enabled: false,
  touchpoints: [
    { enabled: true, offset_ms: 5 * 60_000,     instruction: 'Quick light hello — just ask if still interested po.',          message: 'Hi {name}, interested pa po kayo?',                              image_media_asset_ids: [], action_page_id: null },
    { enabled: true, offset_ms: 60 * 60_000,    instruction: 'Friendly nudge — offer to answer any questions.',                message: 'Hi {name}, balik lang po ako, anything I can help with?',        image_media_asset_ids: [], action_page_id: null },
    { enabled: true, offset_ms: 5 * 3_600_000,  instruction: 'Share one concrete benefit or social proof — keep it short.',   message: 'Hi {name}, baka may tanong po kayo, happy to help anytime.',     image_media_asset_ids: [], action_page_id: null },
    { enabled: true, offset_ms: 8 * 3_600_000,  instruction: "Ask one focused question to surface what's blocking them.",     message: 'Hi {name}, ano po sa tingin niyo so far?',                       image_media_asset_ids: [], action_page_id: null },
    { enabled: true, offset_ms: 12 * 3_600_000, instruction: 'Light reminder — emphasize convenience and flexibility.',       message: 'Hi {name}, nandito lang po ako kung kailangan niyo ng details.', image_media_asset_ids: [], action_page_id: null },
    { enabled: true, offset_ms: 18 * 3_600_000, instruction: 'Soft scarcity or a clear call to decide — no pressure.',        message: 'Hi {name}, gusto niyo pa po bang ituloy?',                       image_media_asset_ids: [], action_page_id: null },
    { enabled: true, offset_ms: 24 * 3_600_000, instruction: 'Last graceful check — invite them to message anytime.',         message: 'Hi {name}, last check po, message lang anytime kayo ready.',     image_media_asset_ids: [], action_page_id: null },
  ],
}

export interface SnapshotEntry {
  offset_ms: number
  slot: number
  instruction: string
  message: string
  ai_enabled: boolean
  image_media_asset_ids: string[]
  action_page_id: string | null
}

export function resolveEnabledOffsets(settings: FollowupSettings): SnapshotEntry[] {
  if (!settings.enabled) return []
  const entries: SnapshotEntry[] = settings.touchpoints
    .map((t, slot) => ({ t, slot }))
    .filter((x) => x.t.enabled)
    .map((x) => ({
      slot: x.slot,
      offset_ms: x.t.offset_ms,
      instruction: x.t.instruction,
      message: x.t.message ?? '',
      ai_enabled: settings.ai_enabled,
      image_media_asset_ids: x.t.image_media_asset_ids,
      action_page_id: x.t.action_page_id,
    }))
  if (entries.length === 0) return []
  entries.sort((a, b) => a.offset_ms - b.offset_ms)
  return entries
}

// Back-compat: rows in chatbot_configs.followup_settings written before the
// multi-image change carry `image_media_asset_id: string|null` instead of
// `image_media_asset_ids: string[]`. Remove this function (and its call in
// loadFollowupSettings) once the expand SQL migration has been live long enough
// that no rows carry only the legacy key.
function normalizeStoredSettings(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const obj = raw as Record<string, unknown>
  const tps = obj.touchpoints
  if (!Array.isArray(tps)) return raw
  return {
    ...obj,
    touchpoints: tps.map((t) => {
      if (!t || typeof t !== 'object') return t
      const tp = t as Record<string, unknown>
      if (Array.isArray(tp.image_media_asset_ids)) return tp
      const legacy = typeof tp.image_media_asset_id === 'string' ? tp.image_media_asset_id : null
      return { ...tp, image_media_asset_ids: legacy ? [legacy] : [] }
    }),
  }
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
  const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(normalizeStoredSettings(data.followup_settings))
  if (!parsed.success) {
    console.warn('[followups.settings] parse failed, using defaults', parsed.error.issues[0])
    return DEFAULT_FOLLOWUP_SETTINGS
  }
  return parsed.data
}
