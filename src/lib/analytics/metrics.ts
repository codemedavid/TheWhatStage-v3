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
