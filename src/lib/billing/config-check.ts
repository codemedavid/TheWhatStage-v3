import * as Sentry from '@sentry/nextjs'
import { ragConfig } from '@/lib/rag/config'
import { isModelPriced } from './pricing'

/**
 * Hosts whose OpenAI-compatible endpoints do AUTOMATIC cross-request prefix
 * caching, so the byte-stable prompt prefix is billed at the cached rate
 * (DeepSeek KV cache via OpenRouter, or DeepSeek first-party). Groq / the HF
 * inference router do NOT cache across requests — a regression to those silently
 * loses the ~95% cache benefit (every turn re-pays full input on the ~3k-token
 * static prefix) AND, for an unpriced model, records cost as $0, masking it.
 */
const CACHING_PROVIDER_HOSTS = ['openrouter', 'deepseek']

export interface BillingConfigCheck {
  ok: boolean
  problems: string[]
  model: string
  baseUrl: string
}

/**
 * Fail-fast (warn-loud) check of the LLM billing/caching configuration, run once
 * at server startup (see src/instrumentation.ts). Verifies the configured chat
 * model is priced AND points at an auto-caching provider, so an env-var
 * regression surfaces BEFORE traffic instead of as a silent $0 ledger or a
 * silent cache miss. Non-throwing: it warns (console + Sentry) and returns the
 * result so the boot sequence is never blocked.
 */
export function verifyLlmBillingConfig(): BillingConfigCheck {
  const model = ragConfig.llmModel
  const baseUrl = ragConfig.llmBaseUrl
  const problems: string[] = []

  if (!isModelPriced(model)) {
    problems.push(
      `RAG_LLM_MODEL="${model}" has no entry in pricing.ts PRICES — metered cost ` +
        `falls back to $0 unless the provider returns usage.cost. Add a price entry ` +
        `or confirm the provider reports cost.`,
    )
  }

  const onCachingProvider = CACHING_PROVIDER_HOSTS.some((h) => baseUrl.includes(h))
  if (!onCachingProvider) {
    problems.push(
      `RAG_LLM_BASE_URL="${baseUrl}" is not a known automatic-prefix-caching ` +
        `provider (${CACHING_PROVIDER_HOSTS.join('/')}). The cache_friendly prompt ` +
        `layout will not yield cached tokens — every turn pays full input price on ` +
        `the static prefix.`,
    )
  }

  if (problems.length > 0) {
    console.warn(
      `[billing.config] LLM model/provider config check FAILED:\n- ${problems.join('\n- ')}`,
    )
    Sentry.captureMessage('[billing.config] LLM model/provider config check failed', {
      level: 'warning',
      extra: { model, baseUrl, problems },
    })
  } else {
    console.log('[billing.config] LLM model/provider config OK', { model, baseUrl })
  }

  return { ok: problems.length === 0, problems, model, baseUrl }
}
