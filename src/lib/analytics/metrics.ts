/**
 * Pure analytics math — ratios, conversion percentages, per-day rates, and
 * monotonic funnel step computation. No I/O, so every branch is unit-tested.
 *
 * Conversion is always expressed two ways (Hormozi-style): a RATIO ("how many
 * of A per 1 B") and a PERCENTAGE ("what % of A converts to B").
 */

/** Inclusive count of Asia/Manila calendar days between two YYYY-MM-DD bounds. */
export function daysInRange(from?: string | null, to?: string | null): number {
  if (!from || !to) return 0
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0
  return Math.floor((b - a) / 86_400_000) + 1
}

/** Average per calendar day across the range; 0 when the range is unknown. */
export function perDay(total: number, from?: string | null, to?: string | null): number {
  const days = daysInRange(from, to)
  return days > 0 ? total / days : 0
}

/** "How many `a` per 1 `b`" — e.g. leads per submission. 0 when b <= 0. */
export function ratio(a: number, b: number): number {
  return b > 0 ? a / b : 0
}

/** Conversion percentage: numerator / denominator * 100. 0 when denom <= 0. */
export function conversionPct(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0
}

/** "4.2 → 1" style ratio label, or em dash when undefined. */
export function formatRatio(a: number, b: number): string {
  if (b <= 0 || a <= 0) return '—'
  return `${(a / b).toFixed(1)} → 1`
}

/** "23.8%" style label. */
export function formatPct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`
}

/** Locale thousands-separated integer. */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

export interface FunnelInputRow {
  stageId: string
  name: string
  kind: string
  rank: number
  reached: number
}

export interface FunnelStep extends FunnelInputRow {
  /** % reaching this stage vs the immediately previous stage (drop-off). */
  stepPct: number
  /** % reaching this stage vs the first stage (overall conversion). */
  overallPct: number
}

/**
 * Turn raw per-stage reached counts into a funnel with step-to-step and overall
 * conversion percentages. Rows are sorted by rank; the first stage is the 100%
 * baseline. Counts are monotonic by construction (see the SQL), so percentages
 * never exceed 100.
 */
export function buildFunnel(rows: readonly FunnelInputRow[]): FunnelStep[] {
  const sorted = [...rows].sort((a, b) => a.rank - b.rank)
  const top = sorted[0]?.reached ?? 0
  return sorted.map((row, i) => {
    const prev = i > 0 ? sorted[i - 1].reached : row.reached
    return {
      ...row,
      stepPct: conversionPct(row.reached, prev),
      overallPct: conversionPct(row.reached, top),
    }
  })
}

/** Reached count for a stage by id, or 0 when absent. */
export function reachedFor(rows: readonly FunnelInputRow[], stageId: string): number {
  return rows.find((r) => r.stageId === stageId)?.reached ?? 0
}

// ---- Lead current-stage distribution -----------------------------------

/**
 * One lead pipeline stage with the number of leads CURRENTLY sitting in it —
 * exactly what the kanban board column shows. This is deliberately NOT the
 * monotonic "reached or beyond" funnel: it never relies on the stage `kind`
 * being curated, so it stays accurate even when every column is the default
 * `nurture` kind (the common case for custom boards).
 */
export interface StageCount {
  stageId: string
  name: string
  kind: string
  position: number
  count: number
}

export interface StageShare extends StageCount {
  /** % of all cohort leads currently in this stage. */
  share: number
  /** Bar width relative to the largest stage (0–100). */
  barPct: number
}

export interface StageDistribution {
  rows: StageShare[]
  /** Total leads across all stages (the cohort size on the board). */
  total: number
}

/**
 * Turn raw per-stage current counts into a board-ordered distribution with each
 * stage's share of the cohort and a relative bar width. Sorted by `position`
 * (board order), so the view mirrors the kanban columns left-to-right.
 */
export function buildStageDistribution(rows: readonly StageCount[]): StageDistribution {
  const sorted = [...rows].sort((a, b) => a.position - b.position)
  const total = sorted.reduce((sum, r) => sum + r.count, 0)
  const max = sorted.reduce((m, r) => Math.max(m, r.count), 0)
  return {
    total,
    rows: sorted.map((r) => ({
      ...r,
      share: conversionPct(r.count, total),
      barPct: max > 0 ? (r.count / max) * 100 : 0,
    })),
  }
}

export type StageKindGroup = 'won' | 'lost' | 'active'

/**
 * Collapse a stage `kind` into a display group: the won terminal, an off-ramp
 * (lost / objection / dormant), or an active forward stage. Uncurated kinds
 * (including the default `nurture` and the empty string) fall back to `active`.
 */
export function stageKindGroup(kind: string): StageKindGroup {
  if (kind === 'won') return 'won'
  if (kind === 'lost' || kind === 'objection' || kind === 'dormant') return 'lost'
  return 'active'
}

// ---- Period-over-period comparison -------------------------------------

/** A YYYY-MM-DD date range. */
export interface DateRange {
  from: string
  to: string
}

/**
 * The immediately-preceding range of equal length, ending the day before
 * `from`. Returns null for all-time / missing / inverted ranges (no prior
 * period exists to compare against).
 */
export function previousPeriod(from?: string | null, to?: string | null): DateRange | null {
  const days = daysInRange(from, to)
  if (days <= 0 || !from) return null
  const fromMs = Date.parse(`${from}T00:00:00Z`)
  const prevToMs = fromMs - 86_400_000
  const prevFromMs = prevToMs - (days - 1) * 86_400_000
  return { from: isoDay(prevFromMs), to: isoDay(prevToMs) }
}

/** Format a UTC millisecond instant as a YYYY-MM-DD calendar day. */
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export type DeltaDirection = 'up' | 'down' | 'flat'

export interface Delta {
  /** current - previous. */
  abs: number
  /** Percentage change vs the baseline, or null when the baseline is 0. */
  pct: number | null
  direction: DeltaDirection
}

/** Absolute + percentage change of `current` against `previous`. */
export function computeDelta(current: number, previous: number): Delta {
  const abs = current - previous
  const direction: DeltaDirection = abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat'
  const pct = previous > 0 ? (abs / previous) * 100 : null
  return { abs, pct, direction }
}

/** "+20.0%" / "-12.5%" / "New" (no baseline) / "No change" (flat). */
export function formatDelta(delta: Delta): string {
  if (delta.direction === 'flat') return 'No change'
  if (delta.pct === null) return 'New'
  const sign = delta.pct > 0 ? '+' : ''
  return `${sign}${delta.pct.toFixed(1)}%`
}

// ---- Lead-stage x project-stage cross-tab ------------------------------

/**
 * One cell of the lead-stage x project-stage cross-tab: the count of distinct
 * leads whose furthest lead stage reached `leadRank` AND whose best project
 * reached `projectRank` (monotonic, see the SQL). `leadStageTotal` is the count
 * reaching `leadRank` regardless of any project — the conversion denominator.
 */
export interface CrosstabCell {
  leadStageId: string
  leadStageName: string
  leadKind?: string
  leadRank: number
  leadStageTotal: number
  projectStageId: string
  projectStageName: string
  projectKind: string
  projectRank: number
  leads: number
}

export interface CrosstabResult {
  /** Leads at the chosen lead stage that also reached the chosen project stage. */
  leads: number
  /** Leads at the chosen lead stage (the denominator). */
  total: number
  /** leads / total * 100. */
  pct: number
  /** "how many leads per 1 conversion" — total / leads. */
  ratio: number
}

/** One distinct stage rung on an explorer axis (deduped from the cross-tab). */
export interface StageRef {
  rank: number
  name: string
  kind: string
}

/**
 * Collapse cross-tab cells to one {@link StageRef} per rank, sorted by rank. The
 * cross-tab is a lead-rung x project-rung product, so each rung repeats once per
 * opposite-axis rung; this keeps the first occurrence per rank. With the
 * project-stage axis grouped by `kind` in the SQL, "Won" is a single rung across
 * every project — not one entry per project.
 */
function uniqueStages(
  cells: readonly CrosstabCell[],
  rankOf: (c: CrosstabCell) => number,
  nameOf: (c: CrosstabCell) => string,
  kindOf: (c: CrosstabCell) => string,
): StageRef[] {
  const byRank = new Map<number, StageRef>()
  for (const c of cells) {
    const rank = rankOf(c)
    if (!byRank.has(rank)) byRank.set(rank, { rank, name: nameOf(c), kind: kindOf(c) })
  }
  return [...byRank.values()].sort((a, b) => a.rank - b.rank)
}

/** Distinct lead-stage rungs from the cross-tab, in rank order. */
export function leadStageRefs(cells: readonly CrosstabCell[]): StageRef[] {
  return uniqueStages(cells, (c) => c.leadRank, (c) => c.leadStageName, (c) => c.leadKind ?? '')
}

/** Distinct project-stage rungs from the cross-tab, in rank order. */
export function projectStageRefs(cells: readonly CrosstabCell[]): StageRef[] {
  return uniqueStages(cells, (c) => c.projectRank, (c) => c.projectStageName, (c) => c.projectKind)
}

/** Look up a cross-tab cell and derive its conversion percentage and ratio. */
export function crosstabLookup(
  cells: readonly CrosstabCell[],
  leadRank: number,
  projectRank: number,
): CrosstabResult {
  const cell = cells.find((c) => c.leadRank === leadRank && c.projectRank === projectRank)
  if (!cell) return { leads: 0, total: 0, pct: 0, ratio: 0 }
  return {
    leads: cell.leads,
    total: cell.leadStageTotal,
    pct: conversionPct(cell.leads, cell.leadStageTotal),
    ratio: ratio(cell.leadStageTotal, cell.leads),
  }
}

// ---- CSV export --------------------------------------------------------

/** Wrap a CSV field in quotes (escaping internal quotes) when it needs it. */
function csvField(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Serialize a header row + data rows into RFC-4180-style CSV text. */
export function toCsv(headers: readonly string[], rows: readonly (string | number)[][]): string {
  const lines = [headers.map(csvField).join(',')]
  for (const row of rows) lines.push(row.map(csvField).join(','))
  return lines.join('\n')
}
