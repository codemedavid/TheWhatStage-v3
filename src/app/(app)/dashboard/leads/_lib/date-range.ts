import type { LeadsQuery } from './schemas'

/** Local-date YYYY-MM-DD for the given Date (server-local, matching the
 *  <input type="date"> chips and the inclusive day bounds the queries apply). */
function toDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Monday-based start of the week containing `d`. */
function startOfWeek(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = (copy.getDay() + 6) % 7 // 0 = Monday … 6 = Sunday
  copy.setDate(copy.getDate() - dow)
  return copy
}

/**
 * Resolve a {@link LeadsQuery}'s `range` preset into concrete `from`/`to`
 * day bounds. Presets are anchored to "now" so they always track the current
 * day/week/month; `custom` passes the explicit bounds through and `all` clears
 * them. Returns a new params object (never mutates the input).
 */
export function resolveDateRange(params: LeadsQuery, now: Date = new Date()): LeadsQuery {
  const today = toDateString(now)

  switch (params.range) {
    case 'today':
      return { ...params, from: today, to: today }
    case 'week':
      return { ...params, from: toDateString(startOfWeek(now)), to: today }
    case 'month':
      return { ...params, from: toDateString(new Date(now.getFullYear(), now.getMonth(), 1)), to: today }
    case 'all':
      return { ...params, from: undefined, to: undefined }
    case 'custom':
      return params
  }
}
