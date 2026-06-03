-- =========================================================================
-- LLM usage ledger (Phase 1 of usage-based billing — see USAGE_BILLING_PLAN.md).
--
-- One row per metered model call, attributed to a tenant (user_id). Append-only.
-- Cost is computed AT WRITE TIME from the app's price map (src/lib/billing/
-- pricing.ts) and stored as cost_micros so later price changes never rewrite
-- history. Aggregation/dashboards read usage_daily (Phase 2), not this table.
--
-- This migration is purely additive: no existing table or behavior changes.
-- =========================================================================

create type public.llm_usage_scope as enum (
  'chatbot.answer',
  'chatbot.classify',
  'chatbot.answer.fallback',
  'chatbot.summary',
  'comment.classify',
  'deep.reclassify',
  'embed.query',
  'embed.batch'
);

create table public.llm_usage_events (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  scope                 public.llm_usage_scope not null,
  model                 text not null,
  prompt_tokens         integer not null default 0,
  cached_prompt_tokens  integer not null default 0,  -- subset of prompt_tokens (DeepSeek KV cache hits)
  completion_tokens     integer not null default 0,
  total_tokens          integer not null default 0,
  cost_micros           bigint  not null default 0,  -- USD * 1e6, computed at write time
  thread_id             uuid,                          -- messenger_threads.id when available; nullable
  created_at            timestamptz not null default now()
);

-- Hot path for the dashboard + Phase 2 rollup: "this tenant's usage over a window".
create index llm_usage_events_user_created_idx
  on public.llm_usage_events (user_id, created_at desc);

alter table public.llm_usage_events enable row level security;

-- Tenants may READ their own usage. There is deliberately NO insert/update/delete
-- policy for end users — writes happen only via the service-role worker, which
-- bypasses RLS. This keeps the ledger tamper-proof from the client side.
create policy "own usage read"
  on public.llm_usage_events for select
  using (user_id = auth.uid());
