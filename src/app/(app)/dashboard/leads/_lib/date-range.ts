import type { LeadsQuery } from './schemas'

const TZ = 'Asia/Manila'

/** The Manila calendar Y/M/D for the absolute instant `now`. */
function manilaParts(now: Date): { y: number; m: number; d: number } {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now) // en-CA → "YYYY-MM-DD"
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
 * Resolve a {@link LeadsQuery}'s `range` preset into concrete `from`/`to` day
 * bounds, expressed as Asia/Manila calendar days. Presets are anchored to the
 * Manila "now" (UTC+8) — not the server's local day, which is UTC on Vercel and
 * would otherwise disagree with the rest of the app. `custom` passes the
 * explicit bounds through and `all` clears them. Returns a new params object
 * (never mutates the input).
 *
 * Calendar arithmetic runs on a UTC-seeded Date so it stays deterministic
 * regardless of where the process runs.
 */
export function resolveDateRange(params: LeadsQuery, now: Date = new Date()): LeadsQuery {
  const { y, m, d } = manilaParts(now)
  // A UTC midnight that *represents* the Manila calendar day — used only for
  // calendar math (day-of-week, month start), never as an instant.
  const todayCal = new Date(Date.UTC(y, m - 1, d))
  const today = fmt(todayCal)

  switch (params.range) {
    case 'today':
      return { ...params, from: today, to: today }
    case 'week': {
      const dow = (todayCal.getUTCDay() + 6) % 7 // 0 = Monday … 6 = Sunday
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
