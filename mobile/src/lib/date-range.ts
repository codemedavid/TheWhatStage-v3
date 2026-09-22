// Date-range presets for board filters. Pure helpers so the board can filter
// already-loaded rows client-side without another round trip.

export type DatePreset = 'all' | 'today' | 'yesterday' | '7d' | '30d' | 'custom'

/** Which timestamp on a lead the range applies to. */
export type DateBasis = 'activity' | 'created' | 'stage'

export interface DateRange {
  /** Inclusive start, ms epoch. */
  from: number | null
  /** Exclusive end, ms epoch. */
  to: number | null
}

export interface DateFilter {
  preset: DatePreset
  basis: DateBasis
  /** Only read when preset is 'custom'. Local-day start / end (inclusive). */
  customFrom: string | null
  customTo: string | null
}

export const DEFAULT_DATE_FILTER: DateFilter = { preset: 'all', basis: 'activity', customFrom: null, customTo: null }

const DAY_MS = 24 * 60 * 60 * 1000

export const PRESET_LABELS: Record<DatePreset, string> = {
  all: 'All time',
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  custom: 'Custom',
}

export const BASIS_LABELS: Record<DateBasis, string> = {
  activity: 'Last activity',
  created: 'Created',
  stage: 'Entered stage',
}

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Resolve a filter into an absolute range; `all` returns open bounds. */
export function resolveRange(filter: DateFilter, now = Date.now()): DateRange {
  const today = startOfDay(now)
  switch (filter.preset) {
    case 'all':
      return { from: null, to: null }
    case 'today':
      return { from: today, to: today + DAY_MS }
    case 'yesterday':
      return { from: today - DAY_MS, to: today }
    case '7d':
      return { from: today - 6 * DAY_MS, to: today + DAY_MS }
    case '30d':
      return { from: today - 29 * DAY_MS, to: today + DAY_MS }
    case 'custom': {
      const from = filter.customFrom ? startOfDay(new Date(filter.customFrom).getTime()) : null
      const to = filter.customTo ? startOfDay(new Date(filter.customTo).getTime()) + DAY_MS : null
      return { from, to }
    }
  }
}

export function inRange(iso: string | null | undefined, range: DateRange): boolean {
  if (range.from == null && range.to == null) return true
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return false
  if (range.from != null && t < range.from) return false
  if (range.to != null && t >= range.to) return false
  return true
}

/** Short chip label, e.g. "Sep 1 – Sep 22" for custom ranges. */
export function describeFilter(filter: DateFilter): string {
  if (filter.preset !== 'custom') return PRESET_LABELS[filter.preset]
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '…'
  return `${fmt(filter.customFrom)} – ${fmt(filter.customTo)}`
}
