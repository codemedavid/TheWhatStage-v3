import { after } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LlmCompletion } from '@/lib/rag/llm'
import { costMicros, isModelPriced, microsFromUsd } from './pricing'
import type { LlmUsageScope } from './types'

/**
 * Persist one metered LLM call to the usage ledger (`llm_usage_events`), with
 * per-tenant attribution and write-time cost. See USAGE_BILLING_PLAN.md.
 *
 * BEST-EFFORT BY DESIGN: this must NEVER break or delay a customer reply. It runs
 * after the reply text is produced (callers on the hot path use
 * `recordUsageDeferred` so the DB write happens past the HTTP response), swallows
 * every error, and skips silently when the provider returned no usage object.
 * `supabase` is the service-role admin client used by the worker — RLS has no
 * insert policy for end users, so the ledger is write-only from the trusted side.
 *
 * IDEMPOTENCY: pass `idempotencyKey` (a per-turn token, e.g. the inbound message
 * id) so a requeued/retried job never double-counts. `event_key` is unique;
 * un-keyed rows (null) are always inserted since NULLs are distinct in a unique
 * index — so callers without a stable key keep their old append-only behavior.
 */

// Alert at most once per model per process when an unpriced model is metered:
// cost falls back to $0 and the row is flagged `priced = false` so it is
// detectable + back-fillable. Dedup avoids Sentry/log spam under burst load.
const alertedUnpricedModels = new Set<string>()

export async function recordUsage(
  supabase: SupabaseClient,
  userId: string,
  scope: LlmUsageScope,
  completion: Pick<LlmCompletion, 'model' | 'usage'>,
  threadId?: string | null,
  idempotencyKey?: string | null,
): Promise<void> {
  const u = completion.usage
  if (!u) return // provider didn't report usage — nothing to bill, don't pollute the ledger

  // Two readings of the cache count, deliberately divergent on the UNKNOWN case
  // (provider returned no cache field → u.cachedPromptTokens is null):
  //  • LEDGER: persist NULL so the row records UNKNOWN, NOT a 0-hit. The
  //    usage-health watchdog excludes UNKNOWN rows from its hit-rate denominator;
  //    storing 0 here would conflate "unreported" with "no cache" and bias the
  //    rate down, manufacturing false cache-collapse alerts.
  //  • COST: fall back to 0 (no cache discount) so the price-map math stays a
  //    finite, conservative estimate rather than NaN/under-charging.
  const cachedForLedger = u.cachedPromptTokens ?? null
  const cachedForCost = u.cachedPromptTokens ?? 0

  // Prefer the provider-reported exact cost (OpenRouter `usage.cost`) when
  // present; it already reflects real per-tier rates + cache discount + margin.
  // Fall back to the estimated price map only when the provider gives no cost.
  const providerCostUsd = typeof u.costUsd === 'number' ? u.costUsd : null

  // A row has a trustworthy cost if EITHER the provider reported one OR we have a
  // price-map entry. Only the neither-case records $0 and warrants the alert.
  const priced = providerCostUsd != null || isModelPriced(completion.model)
  if (!priced && !alertedUnpricedModels.has(completion.model)) {
    alertedUnpricedModels.add(completion.model)
    Sentry.captureMessage('[billing] metering unpriced model — cost recorded as $0', {
      level: 'warning',
      tags: { scope },
      extra: { model: completion.model },
    })
  }

  const cost_micros =
    providerCostUsd != null
      ? microsFromUsd(providerCostUsd)
      : costMicros(completion.model, {
          promptTokens: u.promptTokens,
          cachedPromptTokens: cachedForCost,
          completionTokens: u.completionTokens,
        })

  // event_key scopes the idempotency token by call type so one turn's distinct
  // scopes (answer / classify / fallback) never collide with each other.
  const eventKey = idempotencyKey ? `${idempotencyKey}:${scope}` : null

  try {
    await supabase.from('llm_usage_events').upsert(
      {
        user_id: userId,
        scope,
        model: completion.model,
        prompt_tokens: u.promptTokens,
        cached_prompt_tokens: cachedForLedger,
        completion_tokens: u.completionTokens,
        total_tokens: u.totalTokens,
        cost_micros,
        priced,
        thread_id: threadId ?? null,
        event_key: eventKey,
      },
      { onConflict: 'event_key', ignoreDuplicates: true },
    )
  } catch (e) {
    console.error('[billing.recordUsage] insert failed', { scope, userId, error: e })
  }
}

/**
 * Fire-and-forget `recordUsage` that NEVER delays a reply. Defers the DB write
 * past the HTTP response via Next's `after()` when inside a request scope, and
 * falls back to a detached promise outside one (tests/scripts). `recordUsage`
 * already swallows its own errors, so neither path can surface to the caller.
 */
export function recordUsageDeferred(
  supabase: SupabaseClient,
  userId: string,
  scope: LlmUsageScope,
  completion: Pick<LlmCompletion, 'model' | 'usage'>,
  threadId?: string | null,
  idempotencyKey?: string | null,
): void {
  const run = () => recordUsage(supabase, userId, scope, completion, threadId, idempotencyKey)
  try {
    after(run)
  } catch {
    // Not in a request scope (unit tests / scripts) — detached best-effort.
    void run()
  }
}
