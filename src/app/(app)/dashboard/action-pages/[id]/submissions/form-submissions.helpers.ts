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

const OUTCOME_LABELS: Record<string, string> = {
  qualified: 'Qualified',
  disqualified: 'Disqualified',
  pending_review: 'Pending review',
  submitted: 'Submitted',
  booked: 'Booked',
  checked_out: 'Checked out',
  invalid: 'Invalid',
}

export function submissionSource(s: Pick<SubmissionListItem, 'psid'>): SubmissionSource {
  return s.psid ? 'Messenger' : 'Web'
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
