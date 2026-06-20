import type { AnalyticsQuery } from './schemas'

const TZ = 'Asia/Manila'

/** The Manila calendar Y/M/D for the absolute instant `now`. */
function manilaParts(now: Date): { y: number; m: number; d: number } {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now) // en-CA -> "YYYY-MM-DD"
  const [y, m, d] = s.split('-').map(Number)
  return { y, m, d }
}

/** Format a UTC-seeded calendar date as YYYY-MM-DD (calendar-only, tz-agnostic). */
function fmt(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Resolve an {@link AnalyticsQuery}'s `range` preset into concrete `from`/`to`
 * Asia/Manila day bounds. Mirrors the leads module helper: presets anchor to the
 * Manila "now" (UTC+8), `custom` passes explicit bounds through, and `all` clears
 * them. Returns a new object — never mutates the input.
 */
export function resolveDateRange(params: AnalyticsQuery, now: Date = new Date()): AnalyticsQuery {
  const { y, m, d } = manilaParts(now)
  const todayCal = new Date(Date.UTC(y, m - 1, d))
  const today = fmt(todayCal)

  switch (params.range) {
    case 'today':
      return { ...params, from: today, to: today }
    case 'week': {
      const dow = (todayCal.getUTCDay() + 6) % 7 // 0 = Monday ... 6 = Sunday
      const monday = new Date(todayCal)
      monday.setUTCDate(monday.getUTCDate() - dow)
      return { ...params, from: fmt(monday), to: today }
    }
    case 'month':
      return { ...params, from: fmt(new Date(Date.UTC(y, m - 1, 1))), to: today }
    case 'all':
      return { ...params, from: undefined, to: undefined }
    case 'custom':
      return params
  }
}

/** Human label for the selected range, e.g. "This month" or "Jun 1 – Jun 20". */
export function rangeLabel(params: AnalyticsQuery): string {
  switch (params.range) {
    case 'today':
      return 'Today'
    case 'week':
      return 'This week'
    case 'month':
      return 'This month'
    case 'all':
      return 'All time'
    case 'custom':
      return params.from && params.to ? `${params.from} → ${params.to}` : 'Custom range'
  }
}
