import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Usage-health watchdog (Phase 2 — usage-based billing). Runs on the existing
 * hourly usage-rollup cron. Detects the failure modes that a raw token-count
 * dashboard CANNOT show — and that are the ones actually worth paging on:
 *
 *  1. Cache-hit rate COLLAPSE — the byte-stable prompt prefix lost stability,
 *     or traffic moved off the caching provider, so previously-cached input is
 *     re-billed fresh at ~10x. `total_tokens` stays flat while cost jumps.
 *  2. Cost SPIKE vs the trailing baseline (with an absolute floor so a quiet
 *     hour of pennies never trips it).
 *
 * Read-only + best-effort: it queries the ledger and raises a Sentry warning;
 * it never blocks the rollup. Thresholds are env-overridable.
 */

/** Alert when the windowed cache-hit rate falls below this fraction. */
const CACHE_HIT_FLOOR = Number(process.env.USAGE_ALERT_CACHE_HIT_FLOOR) || 0.5
/** Alert when windowed cost exceeds baseline by this factor. */
const COST_SPIKE_FACTOR = Number(process.env.USAGE_ALERT_COST_SPIKE_FACTOR) || 2
/** Absolute floor (USD micros) below which the cost-spike alert never fires. */
const COST_SPIKE_MIN_MICROS = Number(process.env.USAGE_ALERT_COST_MIN_MICROS) || 50_000 // $0.05
/** Min prompt tokens in the window before the cache-hit alert is meaningful. */
const CACHE_HIT_MIN_PROMPT = Number(process.env.USAGE_ALERT_CACHE_MIN_PROMPT) || 5_000

const HOUR_MS = 60 * 60 * 1000
const WEEK_MS = 7 * 24 * HOUR_MS

export interface UsageHealth {
  promptTokens: number
  cachedPromptTokens: number
  cacheHitRate: number | null
  costMicros: number
  baselineHourlyCostMicros: number
  alerts: string[]
}

interface LedgerRow {
  prompt_tokens: number | null
  cached_prompt_tokens: number | null
  cost_micros: number | null
}

function sum(rows: LedgerRow[] | null, key: keyof LedgerRow): number {
  if (!rows) return 0
  let total = 0
  for (const r of rows) {
    const v = r[key]
    if (typeof v === 'number') total += v
  }
  return total
}

/**
 * Inspect the last hour of `llm_usage_events`, compare against a trailing-7-day
 * hourly baseline, and raise a Sentry warning on anomaly. Returns the computed
 * metrics so the caller (cron route) can echo them in its JSON response.
 *
 * NOTE: pulls raw event rows for the window. Fine at current volume; swap to a
 * SQL aggregate RPC if the hourly event count grows large.
 */
export async function checkUsageHealth(admin: SupabaseClient): Promise<UsageHealth> {
  const now = Date.now()
  const windowStart = new Date(now - HOUR_MS).toISOString()

  const { data: recent, error } = await admin
    .from('llm_usage_events')
    .select('prompt_tokens, cached_prompt_tokens, cost_micros')
    .gte('created_at', windowStart)
  if (error) throw new Error(`checkUsageHealth: recent query failed: ${error.message}`)

  const rows = (recent ?? []) as LedgerRow[]
  const promptTokens = sum(rows, 'prompt_tokens')
  const cachedPromptTokens = sum(rows, 'cached_prompt_tokens')
  const costMicros = sum(rows, 'cost_micros')
  const cacheHitRate = promptTokens > 0 ? cachedPromptTokens / promptTokens : null

  // Baseline: mean hourly cost over the trailing 7 days, EXCLUDING the last hour
  // so a spike doesn't inflate its own baseline.
  const { data: weekRows, error: weekErr } = await admin
    .from('llm_usage_events')
    .select('cost_micros')
    .gte('created_at', new Date(now - WEEK_MS).toISOString())
    .lt('created_at', windowStart)
  if (weekErr) throw new Error(`checkUsageHealth: baseline query failed: ${weekErr.message}`)
  const weekCost = sum((weekRows ?? []) as LedgerRow[], 'cost_micros')
  const baselineHourlyCostMicros =
    weekRows && weekRows.length > 0 ? Math.round(weekCost / (7 * 24 - 1)) : 0

  const alerts: string[] = []

  if (
    cacheHitRate != null &&
    promptTokens >= CACHE_HIT_MIN_PROMPT &&
    cacheHitRate < CACHE_HIT_FLOOR
  ) {
    alerts.push(
      `cache-hit rate ${(cacheHitRate * 100).toFixed(1)}% is below the ` +
        `${Math.round(CACHE_HIT_FLOOR * 100)}% floor over the last hour ` +
        `(prompt=${promptTokens}, cached=${cachedPromptTokens}) — the prompt prefix ` +
        `may have lost byte-stability or traffic moved off the caching provider.`,
    )
  }

  if (
    costMicros > COST_SPIKE_MIN_MICROS &&
    baselineHourlyCostMicros > 0 &&
    costMicros > baselineHourlyCostMicros * COST_SPIKE_FACTOR
  ) {
    alerts.push(
      `hourly cost ${costMicros}µ$ exceeds ${COST_SPIKE_FACTOR}x the trailing-7d ` +
        `hourly baseline (${baselineHourlyCostMicros}µ$).`,
    )
  }

  if (alerts.length > 0) {
    console.warn('[billing.usage-health]', alerts.join(' | '))
    Sentry.captureMessage('[billing.usage-health] anomaly detected', {
      level: 'warning',
      extra: {
        promptTokens,
        cachedPromptTokens,
        cacheHitRate,
        costMicros,
        baselineHourlyCostMicros,
        alerts,
      },
    })
  }

  return {
    promptTokens,
    cachedPromptTokens,
    cacheHitRate,
    costMicros,
    baselineHourlyCostMicros,
    alerts,
  }
}
