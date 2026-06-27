import type { SubmissionListItem } from '../../_lib/queries'

/**
 * Pure presentation/aggregation logic for the sales-style form &
 * qualification submissions view. Kept framework-free so it can be unit
 * tested without rendering the React component.
 */

export type SubmissionKind = 'form' | 'qualification'
export type SubmissionSource = 'Messenger' | 'Web'

export interface FormField {
  key: string
  label: string
  value: string
}

export interface QualAnswer {
  prompt: string
  value: string
}

export interface StatTileData {
  label: string
  value: number
  variant: 'default' | 'success' | 'warning' | 'accent'
}

export interface FilterDef {
  key: string
  label: string
  count: number
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** Outcome marking a chat-implied ("virtual") submission — created by the bot
 *  when it detects proceed-intent without a form fill (see virtual-submission.ts). */
export const IMPLIED_PROCEED_OUTCOME = 'implied_proceed'

const OUTCOME_LABELS: Record<string, string> = {
  qualified: 'Qualified',
  disqualified: 'Disqualified',
  pending_review: 'Pending review',
  submitted: 'Submitted',
  booked: 'Booked',
  checked_out: 'Checked out',
  invalid: 'Invalid',
  [IMPLIED_PROCEED_OUTCOME]: 'Chat-implied',
}

export function submissionSource(s: Pick<SubmissionListItem, 'psid'>): SubmissionSource {
  return s.psid ? 'Messenger' : 'Web'
}

/** True when this row is a chat-implied submission rather than a real form fill. */
export function isImpliedSubmission(s: Pick<SubmissionListItem, 'outcome'>): boolean {
  return s.outcome === IMPLIED_PROCEED_OUTCOME
}

/** The customer quote captured on a chat-implied submission, if any. */
export function impliedQuote(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const q = (data as { message_quote?: unknown }).message_quote
  return typeof q === 'string' && q.trim() ? q.trim() : null
}

export function displayName(
  s: Pick<
    SubmissionListItem,
    'lead_name' | 'messenger_name' | 'messenger_full_name' | 'lead_id'
  >,
): string {
  return (
    s.lead_name ??
    s.messenger_name ??
    s.messenger_full_name ??
    (s.lead_id ? 'Unknown lead' : 'Anonymous')
  )
}

export function extractFormFields(data: Record<string, unknown>): FormField[] {
  const raw =
    data?.fields && typeof data.fields === 'object'
      ? (data.fields as Record<string, unknown>)
      : {}
  const out: FormField[] = []
  for (const [key, val] of Object.entries(raw)) {
    const value = formatVal(val)
    if (!value || value === '—') continue
    out.push({ key, label: humanize(key), value })
  }
  return out
}

export function extractAnswers(data: Record<string, unknown>): QualAnswer[] {
  const answers = Array.isArray(data?.answers) ? data.answers : []
  return answers.map((a, i): QualAnswer => {
    const entry = (a ?? {}) as Record<string, unknown>
    const prompt =
      typeof entry.prompt === 'string' && entry.prompt.trim()
        ? entry.prompt
        : `Q${i + 1}`
    const display = entry.display
    const value = Array.isArray(display)
      ? display.map((x) => formatVal(x)).join(', ')
      : typeof display === 'string' && display
        ? display
        : formatVal(entry.value)
    return { prompt, value: value || '—' }
  })
}

export function getScore(data: Record<string, unknown>): number | null {
  return typeof data?.score === 'number' ? data.score : null
}

export function formatOutcomeLabel(outcome: string): string {
  return OUTCOME_LABELS[outcome] ?? humanize(outcome)
}

/* ---- Date-range filtering & lead-to-submission conversion ---- */

const MANILA_TZ = 'Asia/Manila'

export type DateRange = 'today' | 'week' | 'month' | 'all' | 'custom'

/** Inclusive Manila calendar-day bounds (YYYY-MM-DD), or null for open-ended. */
export interface DateRangeBounds {
  from: string | null
  to: string | null
}

export interface RangeMetrics {
  submissions: number
  leads: number
  /** submissions ÷ leads within the range, or null when there are no leads. */
  conversionRate: number | null
}

/** The Manila calendar Y/M/D for the absolute instant `now`. */
function manilaParts(now: Date): { y: number; m: number; d: number } {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const [y, m, d] = s.split('-').map(Number)
  return { y, m, d }
}

/** Format a UTC-seeded calendar date as YYYY-MM-DD (calendar-only, tz-agnostic). */
function fmtDay(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Resolve a {@link DateRange} preset into concrete inclusive Manila-day bounds.
 * Mirrors the analytics module helper (Asia/Manila, UTC+8). Returns a new object.
 */
export function resolveDateRange(
  range: DateRange,
  now: Date = new Date(),
  custom?: { from?: string; to?: string },
): DateRangeBounds {
  const { y, m, d } = manilaParts(now)
  const todayCal = new Date(Date.UTC(y, m - 1, d))
  const today = fmtDay(todayCal)

  switch (range) {
    case 'today':
      return { from: today, to: today }
    case 'week': {
      const dow = (todayCal.getUTCDay() + 6) % 7 // 0 = Monday … 6 = Sunday
      const monday = new Date(todayCal)
      monday.setUTCDate(monday.getUTCDate() - dow)
      return { from: fmtDay(monday), to: today }
    }
    case 'month':
      return { from: fmtDay(new Date(Date.UTC(y, m - 1, 1))), to: today }
    case 'custom':
      return { from: custom?.from ?? null, to: custom?.to ?? null }
    case 'all':
    default:
      return { from: null, to: null }
  }
}

/** Start-of-day instant (ms) for a Manila calendar date. */
function dayStartInstant(day: string): number {
  return new Date(`${day}T00:00:00.000+08:00`).getTime()
}

/** End-of-day instant (ms) for a Manila calendar date. */
function dayEndInstant(day: string): number {
  return new Date(`${day}T23:59:59.999+08:00`).getTime()
}

/** True when an ISO timestamp falls within inclusive Manila-day bounds. */
export function isWithinRange(createdAt: string, bounds: DateRangeBounds): boolean {
  const t = new Date(createdAt).getTime()
  if (Number.isNaN(t)) return false
  if (bounds.from && t < dayStartInstant(bounds.from)) return false
  if (bounds.to && t > dayEndInstant(bounds.to)) return false
  return true
}

/** Keep only rows whose created_at falls within the bounds. Never mutates input. */
export function filterByDateRange<T extends { created_at: string }>(
  rows: readonly T[],
  bounds: DateRangeBounds,
): T[] {
  return rows.filter((r) => isWithinRange(r.created_at, bounds))
}

/** Count raw ISO timestamps falling within the bounds. */
export function countWithinRange(
  timestamps: readonly string[],
  bounds: DateRangeBounds,
): number {
  return timestamps.reduce((n, ts) => (isWithinRange(ts, bounds) ? n + 1 : n), 0)
}

/** submissions ÷ leads, or null when there are no leads to divide by. */
export function conversionRate(submissions: number, leads: number): number | null {
  return leads > 0 ? submissions / leads : null
}

/** Render a 0..1 rate as a rounded percentage string, or "—" when null. */
export function formatPercent(rate: number | null): string {
  if (rate === null) return '—'
  return `${Number((rate * 100).toFixed(1))}%`
}

/**
 * Submission count, lead count and conversion within a date window. Leads are
 * passed as a flat list of created_at timestamps so the denominator responds to
 * the same window as the numerator.
 */
export function computeRangeMetrics(
  submissions: readonly Pick<SubmissionListItem, 'created_at'>[],
  leadTimestamps: readonly string[],
  bounds: DateRangeBounds,
  totalLeads?: number,
): RangeMetrics {
  const submissionCount = countWithinRange(
    submissions.map((s) => s.created_at),
    bounds,
  )
  // The timestamp list may be capped for very large accounts, so the open-ended
  // "all time" window uses the exact server-side total when one is supplied.
  const isOpenRange = bounds.from === null && bounds.to === null
  const leadCount =
    isOpenRange && typeof totalLeads === 'number'
      ? totalLeads
      : countWithinRange(leadTimestamps, bounds)
  return {
    submissions: submissionCount,
    leads: leadCount,
    conversionRate: conversionRate(submissionCount, leadCount),
  }
}

function isSubmitted(s: SubmissionListItem): boolean {
  return s.outcome === 'submitted' || !s.outcome
}

function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

export function computeStats(
  kind: SubmissionKind,
  submissions: SubmissionListItem[],
  now: Date = new Date(),
): StatTileData[] {
  const weekAgo = new Date(now.getTime() - WEEK_MS)
  const thisWeek = submissions.filter((s) => new Date(s.created_at) >= weekAgo)

  if (kind === 'qualification') {
    const counts = new Map<string, number>()
    for (const s of submissions) {
      const key = s.outcome || 'unknown'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
    const tiles: StatTileData[] = ranked.slice(0, 3).map(([outcome, value]) => ({
      label: formatOutcomeLabel(outcome),
      value,
      variant: qualificationVariant(outcome),
    }))
    tiles.push({ label: 'This week', value: thisWeek.length, variant: 'accent' })
    return tiles
  }

  const submitted = submissions.filter(isSubmitted)
  const monthStart = startOfMonth(now)
  const thisMonth = submitted.filter((s) => new Date(s.created_at) >= monthStart)
  return [
    { label: 'Total', value: submitted.length, variant: 'default' },
    { label: 'This month', value: thisMonth.length, variant: 'default' },
    { label: 'This week', value: thisWeek.length, variant: 'accent' },
  ]
}

function qualificationVariant(outcome: string): StatTileData['variant'] {
  if (/disqual|lost|not_fit|invalid/i.test(outcome)) return 'warning'
  if (/qual|won|hot|booked|checked/i.test(outcome)) return 'success'
  return 'default'
}

export function getFilters(
  kind: SubmissionKind,
  submissions: SubmissionListItem[],
): FilterDef[] {
  const all: FilterDef = { key: 'all', label: 'All', count: submissions.length }

  if (kind === 'qualification') {
    const counts = new Map<string, number>()
    for (const s of submissions) {
      const key = s.outcome || 'unknown'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
    return [
      all,
      ...ranked.map(([outcome, count]) => ({
        key: outcome,
        label: formatOutcomeLabel(outcome),
        count,
      })),
    ]
  }

  const web = submissions.filter((s) => !s.psid).length
  const messenger = submissions.length - web
  return [
    all,
    { key: 'web', label: 'Web', count: web },
    { key: 'messenger', label: 'Messenger', count: messenger },
  ]
}

export function filterSubmissions<T extends SubmissionListItem>(
  submissions: T[],
  kind: SubmissionKind,
  activeKey: string,
  query: string,
): T[] {
  let list = submissions

  if (activeKey && activeKey !== 'all') {
    list = list.filter((s) => {
      if (kind === 'qualification') return (s.outcome || 'unknown') === activeKey
      if (activeKey === 'messenger') return Boolean(s.psid)
      if (activeKey === 'web') return !s.psid
      return true
    })
  }

  const q = query.trim().toLowerCase()
  if (q) {
    list = list.filter((s) => {
      const name = displayName(s).toLowerCase()
      const fieldText = JSON.stringify(s.data ?? {}).toLowerCase()
      return name.includes(q) || fieldText.includes(q)
    })
  }

  return list
}

/* ---- internal formatting helpers ---- */

function formatVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.map(formatVal).join(', ')
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${humanize(k)}: ${formatVal(val)}`)
      .join(' · ')
  }
  return String(v)
}

export function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
