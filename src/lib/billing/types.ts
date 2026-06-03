/**
 * Usage-billing scope taxonomy. Mirrors the `public.llm_usage_scope` Postgres
 * enum (migration 20260609000000_llm_usage_events.sql) — keep the two in sync.
 *
 * Phase 1 actively records the first three (the chat reply path, ~90% of spend).
 * The rest are reserved for Phase 2 when the summary / comment / deep-reclassify
 * / embedding call sites are wired up. See USAGE_BILLING_PLAN.md.
 */
export type LlmUsageScope =
  | 'chatbot.answer'
  | 'chatbot.classify'
  | 'chatbot.answer.fallback'
  | 'chatbot.summary'
  | 'comment.classify'
  | 'deep.reclassify'
  | 'embed.query'
  | 'embed.batch'
