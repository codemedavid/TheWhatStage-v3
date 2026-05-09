import type { SupabaseClient } from '@supabase/supabase-js'
import type { BookingForRender, PropertyForRender } from '@/lib/messenger-templates/render'

export interface FollowupContextInput {
  booking_event_id?: string
  source_property_action_page_id?: string
  /** Override "now" — required for deterministic tests; defaults to Date.now(). */
  now?: number
}

export interface FollowupContext {
  booking?: BookingForRender
  property?: PropertyForRender
}

interface BookingRow {
  event_at: string
  timezone: string | null
  title: string | null
}

interface ActionPageRow {
  id: string
  kind: string
  title: string | null
  slug: string
  config: Record<string, unknown> | null
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''

export async function loadFollowupContext(
  admin: SupabaseClient,
  input: FollowupContextInput,
): Promise<FollowupContext> {
  const now = input.now ?? Date.now()
  const out: FollowupContext = {}

  if (input.booking_event_id) {
    const { data: bk } = await admin
      .from('booking_events')
      .select('event_at, timezone, title')
      .eq('id', input.booking_event_id)
      .maybeSingle<BookingRow>()
    if (bk) {
      out.booking = {
        event_at: bk.event_at,
        event_at_relative: formatRelative(bk.event_at, now),
        title: bk.title ?? '',
      }
    }
  }

  if (input.source_property_action_page_id) {
    const { data: prop } = await admin
      .from('action_pages')
      .select('id, kind, title, slug, config')
      .eq('id', input.source_property_action_page_id)
      .maybeSingle<ActionPageRow>()
    if (prop && prop.kind === 'realestate') {
      const cfg = (prop.config ?? {}) as { address?: string; price?: string | number }
      out.property = {
        title: prop.title ?? '',
        address: typeof cfg.address === 'string' ? cfg.address : '',
        price:
          typeof cfg.price === 'number'
            ? String(cfg.price)
            : typeof cfg.price === 'string'
              ? cfg.price
              : '',
        deeplink_url: APP_URL ? `${APP_URL}/a/${prop.slug}` : `/a/${prop.slug}`,
      }
    }
  }

  return out
}

/**
 * Humanize a delta between event time and `now`.
 * Granularity: days > hours > minutes. plus or minus 30s window = "now".
 */
export function formatRelative(eventAtIso: string, now: number): string {
  const eventMs = new Date(eventAtIso).getTime()
  if (Number.isNaN(eventMs)) return ''
  const deltaMs = eventMs - now
  const absMs = Math.abs(deltaMs)
  if (absMs <= 30_000) return 'now'

  const MS_PER_MIN = 60 * 1000
  const MS_PER_HOUR = 60 * MS_PER_MIN
  const MS_PER_DAY = 24 * MS_PER_HOUR

  let unit: string
  let n: number
  // For past events, round to days at the 24h boundary; for future, keep hours at exactly 24h.
  const dayThreshold = deltaMs < 0 ? MS_PER_DAY : MS_PER_DAY + 1
  if (absMs >= dayThreshold) {
    n = Math.round(absMs / MS_PER_DAY)
    unit = n === 1 ? 'day' : 'days'
  } else if (absMs >= MS_PER_HOUR) {
    n = Math.round(absMs / MS_PER_HOUR)
    unit = n === 1 ? 'hour' : 'hours'
  } else {
    n = Math.max(1, Math.round(absMs / MS_PER_MIN))
    unit = n === 1 ? 'minute' : 'minutes'
  }

  return deltaMs > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`
}
