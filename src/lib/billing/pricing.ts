/**
 * Model price map — the single source of truth for converting token counts to
 * USD micros (USD * 1e6). Used at write time by recordUsage(); the resulting
 * cost_micros is frozen on the ledger row, so editing these numbers only
 * affects NEW events, never history.
 *
 * Keys MUST match the runtime model string returned by `LlmCompletion.model`
 * (i.e. the value of RAG_LLM_MODEL / OPENROUTER_EMBED_MODEL), not a friendly
 * alias.
 *
 * ⚠️  RATES BELOW ARE ESTIMATES derived from the project's own cost analysis
 * (DEEPSEEK_COST_RECHECK.md: blended ~$0.13/M, ~96% input; cache reads modeled
 * at ~0.1× the input rate). VERIFY against the live OpenRouter dashboard and
 * replace with the provider's exact per-tier rates before invoicing anyone.
 */

interface ModelPrice {
  /** USD per 1M fresh (uncached) input tokens. */
  inputPerM: number
  /** USD per 1M cached input tokens (DeepSeek KV-cache reads). */
  cachedInputPerM: number
  /** USD per 1M output (completion) tokens. */
  outputPerM: number
}

const PRICES: Record<string, ModelPrice> = {
  // Chat + classifier (RAG_LLM_MODEL / RAG_CLASSIFIER_MODEL).
  'deepseek/deepseek-v4-flash': {
    inputPerM: 0.13,
    cachedInputPerM: 0.013, // ~0.1× input (audit model for prefix-cache reads)
    outputPerM: 0.13,
  },
  // Query/ingest embeddings (OPENROUTER_EMBED_MODEL). Audit: rounds to ~$0;
  // tracked for completeness, not for material billing.
  'perplexity/pplx-embed-v1-0.6b': {
    inputPerM: 0.01,
    cachedInputPerM: 0.01,
    outputPerM: 0,
  },
}

export interface TokenCounts {
  promptTokens: number
  /** Subset of promptTokens served from cache; billed at cachedInputPerM. */
  cachedPromptTokens: number
  completionTokens: number
}

/**
 * Convert a call's token counts to USD micros for the given model. Splits the
 * prompt into fresh vs. cached input so the live DeepSeek prefix cache shows up
 * as real savings. Returns 0 for an unknown model (and warns once via console)
 * so an unpriced model never silently bills as huge or crashes the worker.
 */
export function costMicros(model: string, t: TokenCounts): number {
  const p = PRICES[model]
  if (!p) {
    console.warn('[billing.pricing] no price entry for model — billing as $0', { model })
    return 0
  }
  const freshInput = Math.max(0, t.promptTokens - t.cachedPromptTokens)
  const usd =
    (freshInput / 1e6) * p.inputPerM +
    (t.cachedPromptTokens / 1e6) * p.cachedInputPerM +
    (t.completionTokens / 1e6) * p.outputPerM
  return Math.round(usd * 1e6)
}

/**
 * USD→PHP conversion rate, for display only. The ledger always stores cost in
 * USD micros (USD * 1e6); we convert to pesos at render time so the rate can
 * change without rewriting history. Override via the USD_TO_PHP env var if the
 * rate drifts materially. The default is a rough working figure — treat the
 * peso amount as a transparency estimate, not an invoice.
 */
export const USD_TO_PHP = Number(process.env.USD_TO_PHP) || 58

/** Convert USD micros (USD * 1e6) to a PHP peso amount for display. */
export function pesoFromMicros(costMicros: number): number {
  return (costMicros / 1e6) * USD_TO_PHP
}
