# Usage-Based Billing & Token Metering — Implementation Plan

**Status:** Phase 1 ✅ · Phase 2 ✅ · Phase 3 ✅ schema + display-only quota (PayMongo integration + enforcement still to come).
**Date:** 2026-06-03

> **Implemented (in working tree, MIGRATIONS APPLIED to remote via Supabase MCP; verified green):**
> - **Phase 1 — meter & persist.** `llm_usage_events` ledger + `llm_usage_scope` enum, `src/lib/billing/{types,pricing,recordUsage}.ts` (+pricing test), wired into the 3 chat call sites (`chatbot.answer`, `chatbot.classify`, `chatbot.answer.fallback`).
> - **Phase 2 — aggregate & expose.** `usage_daily` rollup + `rollup_llm_usage_daily()` fn, hourly pg_cron → `/api/cron/usage-rollup`. Superadmin cross-tenant table (`SuperadminUsage` via `admin_usage_by_tenant()` RPC, service_role-only). **Gap closure:** `deep.reclassify` records usage.
> - **Phase 3 — plans + display-only quota.** `billing_plans` (seeded `free`/`pro`, keyed on `profiles.subscription_tier`), `src/lib/billing/quota.ts` `getQuotaState()`, tenant **Settings → Billing & Usage** page (`settings/billing`, plan + usage bar + est cost), and tier + % of cap added to the superadmin table. **No enforcement — display only.**
> - **Applied migration versions (remote):** `llm_usage_events` `20260602134254` · `usage_daily` `…305` · `usage_rollup_cron` `…313` · `admin_usage_by_tenant` `20260603094412` · `billing_plans` `20260603105240` · `profiles_subscription_tier` `…345` (was the owner's unapplied `20260610…` file — applied + renamed) · `admin_usage_by_tenant_with_tier` `…404`. Local files renamed to match → `supabase db push` is safe.
> - **Deliberately deferred:** `chatbot.summary` / `comment.classify` usage (need signature changes), embedding usage (shared `Embedder` interface churn for ~$0), and `user_subscriptions` (lands with PayMongo).
> - **⚠️ `pricing.ts` rates AND `billing_plans.included_tokens` caps are PLACEHOLDERS** — set real values before they drive anything user-visible/billable.
> - **Ledger is empty until the Phase 1 code is DEPLOYED** to whatever serves traffic. Cost shown in **USD** for now; PHP display lands customer-side with PayMongo.
**Decisions locked in:**
- **Billing model:** Flat tiers + soft caps (sell "X conversations / month" style tiers; meter tokens internally only to enforce caps and trigger upgrade nudges).
- **Enforcement (now):** **Track only — never block a reply.** Overage is surfaced in the dashboard and logged; no degradation, no hard stop. (Hooks are left in place so soft-degrade can be switched on later without re-plumbing.)
- **Scope:** Per-tenant attribution, where one tenant = one `auth.users.id` (the existing single-owner model — no orgs/teams).
- **Payment provider:** **PayMongo** (PH-local — GCash/GrabPay/cards), NOT Stripe. See §4.3.
- **Currency:** internal usage cost is stored + shown in **USD** for now (admin + tenant views). Customer-facing **PHP** display with fixed rates lands later on the customer side (`pricing.ts` `USD_TO_PHP`/`pesoFromMicros` are staged for it but currently unused).

Read [`COST_OPTIMIZATION_AUDIT.md`](./COST_OPTIMIZATION_AUDIT.md) and [`DEEPSEEK_COST_RECHECK.md`](./DEEPSEEK_COST_RECHECK.md) first — pricing constants below depend on them.

---

## 0. Why this is cheap to build

The token data **already flows through the code** — it is just discarded at `console.log`. Two facts make this a small lift:

1. **Usage is already parsed.** `LlmService.completeWithUsage()` (`src/lib/rag/llm.ts:98`) returns a full breakdown:
   ```ts
   LlmUsage { promptTokens, completionTokens, totalTokens, cachedPromptTokens, cacheMissPromptTokens }
   ```
2. **The tenant key is already in scope** at every metered call site. `userId: uuid` is a live variable next to each `logChatbotUsage(...)` call (e.g. `src/lib/chatbot/answer.ts:178`). No new request plumbing is required.

The only structural gap is **persistence**: `logChatbotUsage()` (`src/lib/chatbot/answer.ts:265`) is a pure `console.log`. Nothing reaches Postgres.

> **Note on OpenRouter:** OpenRouter bills the *account owner* in aggregate only. There is **no API to see per-end-user usage** from OpenRouter. All per-tenant attribution must be metered inside our app, which is exactly what this plan does.

---

## 1. Current LLM call-site inventory

| Scope | File:line | Method | Usage captured today | Phase to wire |
|---|---|---|---|---|
| Chat reply | `chatbot/answer.ts:170` | `completeWithUsage` | ✅ parsed, logged, **not persisted** | **P1** |
| Classifier | `chatbot/classify.ts:279` | `completeWithUsage` | ✅ parsed, logged, **not persisted** | **P1** |
| Classify fallback | `chatbot/classify.ts:363` | `completeWithUsage` | ✅ parsed, logged, **not persisted** | **P1** |
| Conversation summary | `chatbot/answer.ts:289` | `complete` (no usage) | ❌ | P2 |
| Comment moderation | `comments/classify.ts:~134` | `complete` (no usage) | ❌ | P2 |
| Deep reclassify | `chatbot/deep-reclassify.ts` | `complete` (no usage) | ❌ | P2 |
| Personality adopt | `chatbot/personality/adopt.ts` | `complete` (no usage) | ❌ | P2 (low volume) |
| Query embedding | `rag/retriever.ts:62` | `embedder.embed` | ❌ (OpenRouter returns `res.usage`, discarded in `rag/openrouter-client.ts`) | P2 |
| KB / catalog embed | `rag/openrouter-client.ts:79`, `chatbot/recommend*.ts` | `embedBatch` | ❌ | P2 |

**~90% of spend is DeepSeek V4 Flash chat tokens** (per the cost audit), all in the three **P1** rows. So Phase 1 alone yields billing that is accurate enough to ship; embeddings/comments are a long-tail correction added in Phase 2.

---

## 2. Phase 1 — Meter & persist (the foundation)

### 2.1 New migration: `llm_usage_events` (append-only ledger)

`supabase/migrations/20260609000000_llm_usage_events.sql`

```sql
-- =========================================================================
-- LLM usage ledger: one row per metered model call, attributed to a tenant.
-- Append-only. Cost is computed AT WRITE TIME from the price map so later
-- price changes never rewrite history. Aggregation reads usage_daily, not
-- this table.
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
  cached_prompt_tokens  integer not null default 0,  -- subset of prompt_tokens (DeepSeek KV cache)
  completion_tokens     integer not null default 0,
  total_tokens          integer not null default 0,
  cost_micros           bigint  not null default 0,  -- USD * 1e6, computed at write time
  thread_id             uuid,                          -- nullable; messenger_threads.id when available
  created_at            timestamptz not null default now()
);

create index llm_usage_events_user_created_idx
  on public.llm_usage_events (user_id, created_at desc);

alter table public.llm_usage_events enable row level security;

-- Tenants may READ their own usage. No insert/update/delete for users —
-- writes happen via the service-role worker only (bypasses RLS).
create policy "own usage read"
  on public.llm_usage_events for select
  using (user_id = auth.uid());
```

### 2.2 Price map (single source of truth)

`src/lib/billing/pricing.ts` (new). Keep model strings aligned with the allow-list idea from the cost audit (`HfRouterLlm`, `llm.ts:51`).

```ts
// USD per 1M tokens. Update when provider prices change — never edit historical
// cost_micros rows; this only affects NEW events. Verify against DEEPSEEK_COST_RECHECK.md.
interface ModelPrice { inputPerM: number; cachedInputPerM: number; outputPerM: number }

const PRICES: Record<string, ModelPrice> = {
  'deepseek-v4-flash':  { inputPerM: /*…*/ 0, cachedInputPerM: /*…*/ 0, outputPerM: /*…*/ 0 },
  'openrouter-embed-0.6b': { inputPerM: /*…*/ 0, cachedInputPerM: 0, outputPerM: 0 },
}

export function costMicros(model: string, u: {
  promptTokens: number; cachedPromptTokens: number; completionTokens: number
}): number {
  const p = PRICES[model]
  if (!p) return 0 // unknown model → 0, but log a warning so we notice an unpriced model
  const freshInput = Math.max(0, u.promptTokens - u.cachedPromptTokens)
  const usd =
    (freshInput / 1e6) * p.inputPerM +
    (u.cachedPromptTokens / 1e6) * p.cachedInputPerM +
    (u.completionTokens / 1e6) * p.outputPerM
  return Math.round(usd * 1e6)
}
```

> **Why split cached vs. fresh input:** DeepSeek charges cached input tokens at a steep discount. The contiguous-prefix caching work already landed (`cachedPromptTokens` is populated), so billing on the split makes you cheaper to run *and* lets the dashboard prove cache savings to clients.

### 2.3 Persist at the existing log point

`logChatbotUsage()` is the natural funnel. Extend it to also insert — keep the `console.log` line for existing log aggregation.

`src/lib/billing/recordUsage.ts` (new):

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { costMicros } from './pricing'
import type { LlmUsageScope } from './types'

export async function recordUsage(
  supabase: SupabaseClient, // service-role admin client
  userId: string,
  scope: LlmUsageScope,
  args: { model: string; promptTokens: number; cachedPromptTokens: number;
          completionTokens: number; totalTokens: number; threadId?: string | null },
): Promise<void> {
  try {
    await supabase.from('llm_usage_events').insert({
      user_id: userId,
      scope,
      model: args.model,
      prompt_tokens: args.promptTokens,
      cached_prompt_tokens: args.cachedPromptTokens,
      completion_tokens: args.completionTokens,
      total_tokens: args.totalTokens,
      cost_micros: costMicros(args.model, args),
      thread_id: args.threadId ?? null,
    })
  } catch (e) {
    // NEVER let metering break a reply. Log and move on.
    console.error('[billing.recordUsage] insert failed', e)
  }
}
```

**Wiring (P1 — three call sites):**
- `answer.ts:178` — `userId` and `supabase` are already function params; after `logChatbotUsage('chatbot.answer', …)` add `await recordUsage(supabase, userId, 'chatbot.answer', {…completion.usage…, threadId})`.
- `classify.ts:279` & `classify.ts:363` — same pattern; confirm the admin `supabase` + `userId` are threaded into `classifyOnly`/`answerWithClassification` (they are, per the worker flow in `messenger/process/route.ts`).

Decision sub-point: either pass `supabase`+`userId` into `logChatbotUsage` directly (rename → `logAndRecordUsage`), or call `recordUsage` separately at each site. Separate call is less invasive and keeps the pure logger pure. **Recommend: separate call.**

**Critical invariant:** metering must be best-effort. The `try/catch` above and the fact that it runs *after* the reply is generated guarantee a DB hiccup never costs a customer message.

---

## 3. Phase 2 — Aggregate & expose

### 3.1 Rollup table `usage_daily`

`supabase/migrations/20260610000000_usage_daily.sql`

```sql
create table public.usage_daily (
  user_id      uuid not null references auth.users(id) on delete cascade,
  day          date not null,
  total_tokens bigint not null default 0,
  cost_micros  bigint not null default 0,
  event_count  integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.usage_daily enable row level security;
create policy "own daily usage read" on public.usage_daily for select
  using (user_id = auth.uid());
```

### 3.2 Rollup job (reuse existing pg_cron + vault pattern)

Mirror `20260502235749_supabase_cron_jobs.sql`: add a `whatstage-usage-rollup` cron entry hitting a new `/api/cron/usage-rollup` route (guarded by `whatstage_cron_secret`) that upserts yesterday's + today's aggregates from `llm_usage_events` into `usage_daily`. Hourly is fine for soft caps:

```sql
select cron.schedule(
  'whatstage-usage-rollup', '7 * * * *',
  $$select app_private.invoke_cron_route('/api/cron/usage-rollup', 60000);$$
);
```

The route runs a single `insert … select … group by user_id, date_trunc('day', created_at) … on conflict (user_id, day) do update`. Pure SQL aggregation; no per-tenant loop.

### 3.3 Close the measurement gaps (long tail)
- Add a `completeWithUsage`-equivalent path to summary / comment / deep-reclassify calls, then `recordUsage` with the matching scope.
- Extend `OpenRouterEmbedder.embed/embedBatch` (`rag/openrouter-client.ts`) to read `res.usage` (already in the response) and return it; record with scope `embed.query` / `embed.batch`. HF embeddings expose no usage — estimate from token count of input text (`knowledge_chunks.token_count` precedent) or leave unpriced and document it.

### 3.4 Dashboard widget
"X / Y conversations used this cycle" + "$Z estimated cost." Reads `usage_daily` filtered to the current period via RLS (`user_id = auth.uid()`). This transparency view is independently sellable.

---

## 4. Phase 3 — Plans & soft caps (track-only enforcement)

### 4.1 Plan + subscription schema

`supabase/migrations/20260611000000_billing_plans.sql`

```sql
create table public.billing_plans (
  id                  text primary key,          -- 'starter', 'pro', 'scale'
  name                text not null,
  monthly_price_usd   numeric(10,2) not null,
  included_tokens     bigint not null,           -- soft cap per cycle
  included_messages   integer,                    -- optional friendlier unit for marketing
  sort_order          integer not null default 0,
  active              boolean not null default true
);

create table public.user_subscriptions (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  plan_id        text not null references public.billing_plans(id),
  status         text not null default 'active',  -- active | past_due | canceled
  period_start   timestamptz not null default now(),
  period_end     timestamptz not null,
  paymongo_customer_id     text,  -- PayMongo customer
  paymongo_subscription_id text,  -- PayMongo subscription/plan link
  updated_at     timestamptz not null default now()
);

alter table public.billing_plans enable row level security;
alter table public.user_subscriptions enable row level security;
create policy "plans readable" on public.billing_plans for select using (true);
create policy "own subscription read" on public.user_subscriptions for select
  using (user_id = auth.uid());
```

### 4.2 Soft-cap check (no blocking now)

Add `src/lib/billing/quota.ts` → `getQuotaState(supabase, userId)` returning `{ usedTokens, includedTokens, ratio, overage: ratio > 1 }` by summing `usage_daily` over `[period_start, period_end)` against the user's plan.

**Now:** call it only for **display + logging** (dashboard banner, an internal `console.warn` when `ratio > 1`). Replies are never blocked.

**Enforcement hook (left dormant):** put a single `enforceQuota(quotaState)` call in the worker right before the reply generation in `messenger/process/route.ts`, returning a policy enum. Today it always returns `'allow'`. Flipping to soft-degrade later means: over cap → route classify/non-critical calls to a cheaper tier via `model-router.ts`, or cached-only — **without** ever silencing the bot. This is where the cost-audit's un-aliased classifier model (`RAG_CLASSIFIER_MODEL`) becomes the degrade lever.

### 4.3 PayMongo (payment provider — decided; none exists today)
**Not Stripe — PayMongo** (PH-local; supports GCash, GrabPay, cards, etc.). For flat tiers:
- Use PayMongo **recurring/subscription** billing (one plan per tier). PayMongo plans are priced in **PHP centavos**, so the tier's PHP price is the source of truth for charging; the internal USD token cost is for cap display + margin analysis only, never the charge amount.
- New webhook route `/api/webhooks/paymongo` → verify the PayMongo signature (`Paymongo-Signature` header + webhook secret), then on subscription/payment events upsert `user_subscriptions` (plan_id, status, period_start/end, `paymongo_customer_id`, `paymongo_subscription_id`).
- Checkout via PayMongo Links / Checkout Sessions from the dashboard. Token metering stays internal — used only for cap display + upgrade nudges, not for per-token charging.
- **Currency:** customer-facing amounts are PHP (this is where the peso display + fixed rates land — see `pricing.ts` `USD_TO_PHP`/`pesoFromMicros`, currently unused). Internal usage cost stays USD micros on the ledger.

---

## 5. Rollout order & risk

| Step | Deliverable | Risk | Reversible? |
|---|---|---|---|
| P1.1 | `llm_usage_events` migration + price map | none (additive) | drop table |
| P1.2 | `recordUsage` wired into 3 chat call sites | low — best-effort, post-reply, try/catch | remove calls |
| P2.1 | `usage_daily` + hourly rollup cron | low (reuses cron/vault pattern) | unschedule |
| P2.2 | embeddings/summary/comment usage capture | low | per-site |
| P2.3 | dashboard usage widget | none | feature flag |
| P3.1 | plans + subscriptions schema | low (additive) | drop |
| P3.2 | quota state (display-only) | none — no blocking | — |
| P3.3 | PayMongo + webhook | medium (external) | test mode first |

**Guardrails to honor (from cost-audit memory):** don't touch the combined reply+classify envelope, the chat model, `json_object` format, or the 1024-dim embedding model. This plan is purely additive to those.

**Verification per phase:** `tsc` exit 0; `vitest run --dir src` (baseline = 1143 pass + 2 known pre-existing fails — see `preexisting-capi-test-failure`); add unit tests for `costMicros` (cached/fresh split, unknown model → 0) and `getQuotaState` (period boundaries, over/under cap).

---

## 6. Open items needing a product decision later (not blocking P1)
1. **Cycle anchoring:** calendar month vs. per-user signup-anniversary period (`period_start/end` supports either).
2. **Token→message conversion ratio** for the marketing-facing "conversations" unit (derive empirically from `usage_daily` once data exists).
3. **What counts toward the cap:** chat only, or chat + embeddings + comments? (Recommend: chat + comments user-facing; embeddings absorbed as platform cost.)
4. **Overage policy when enforcement turns on:** soft-degrade tier mapping (which scopes drop to the cheaper classifier model).
