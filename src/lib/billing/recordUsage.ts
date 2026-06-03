import type { SupabaseClient } from '@supabase/supabase-js'
import type { LlmCompletion } from '@/lib/rag/llm'
import { costMicros } from './pricing'
import type { LlmUsageScope } from './types'

/**
 * Persist one metered LLM call to the usage ledger (`llm_usage_events`), with
 * per-tenant attribution and write-time cost. Phase 1 of usage-based billing —
 * see USAGE_BILLING_PLAN.md.
 *
 * BEST-EFFORT BY DESIGN: this must NEVER break a customer reply. It runs after
 * the reply text is already produced, swallows every error, and skips silently
 * when the provider returned no usage object. `supabase` is expected to be the
 * service-role admin client used by the worker (RLS has no insert policy for
 * end users — the ledger is write-only from the trusted server side).
 */
export async function recordUsage(
  supabase: SupabaseClient,
  userId: string,
  scope: LlmUsageScope,
  completion: Pick<LlmCompletion, 'model' | 'usage'>,
  threadId?: string | null,
): Promise<void> {
  const u = completion.usage
  if (!u) return // provider didn't report usage — nothing to bill, don't pollute the ledger
  const cachedPromptTokens = u.cachedPromptTokens ?? 0
  try {
    await supabase.from('llm_usage_events').insert({
      user_id: userId,
      scope,
      model: completion.model,
      prompt_tokens: u.promptTokens,
      cached_prompt_tokens: cachedPromptTokens,
      completion_tokens: u.completionTokens,
      total_tokens: u.totalTokens,
      cost_micros: costMicros(completion.model, {
        promptTokens: u.promptTokens,
        cachedPromptTokens,
        completionTokens: u.completionTokens,
      }),
      thread_id: threadId ?? null,
    })
  } catch (e) {
    console.error('[billing.recordUsage] insert failed', { scope, userId, error: e })
  }
}
