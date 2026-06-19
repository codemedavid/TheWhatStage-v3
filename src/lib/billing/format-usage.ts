/**
 * Display helpers for admin-facing usage cost. Cost is stored as USD micros
 * (USD * 1e6) on the ledger; these convert it for the superadmin console.
 *
 * Admin-only by product decision — tenant-facing views stay tokens-only until
 * pricing/tiers are finalized. Provider-reported cost (OpenRouter `usage.cost`)
 * is authoritative per row, so these figures are accurate for internal use.
 */

const MICROS_PER_USD = 1e6

/** Convert USD micros to a plain USD number. */
export function usdFromMicros(costMicros: number): number {
  return (costMicros || 0) / MICROS_PER_USD
}

interface FormatUsdOptions {
  /** Use up to 4 decimals so sub-cent amounts don't round away to $0.01. */
  precise?: boolean
}

/** Format USD micros as a localized USD string, e.g. `$1,234.56`. */
export function formatUsd(costMicros: number, options: FormatUsdOptions = {}): string {
  const usd = usdFromMicros(costMicros)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: options.precise ? 4 : 2,
  }).format(usd)
}
