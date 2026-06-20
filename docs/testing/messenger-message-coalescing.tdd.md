# TDD Evidence — Coalesce rapid-fire customer messages into one AI reply

**Source plan:** derived inline during the `/ecc:plan` → `/ecc:tdd-workflow` run (no `.plan.md` file).
**Branch:** `feat/projects-filters-search-stats`

## Feature

When a Messenger customer fires several messages in quick succession, the bot now
waits a short per-tenant **quiet window** (default 6s, configurable 0–15s) and
answers the whole burst in **one** reply instead of one robotic reply per
message. Messages typed after the LLM already started get a single follow-up
reply (simple path, by design).

Two mechanisms:
1. **Debounce** — webhook enqueues the reply job via an RPC that slides an
   existing queued job's `scheduled_at` forward (or inserts one), guaranteeing
   ≤1 queued reply job per thread.
2. **Coalescing** — the worker gathers every inbound message since the last
   outbound reply, concatenates them into one turn, and excludes them from
   history so they aren't double-counted.

## User journeys

- As a customer, when I send 3 quick messages, I want one thoughtful reply, so the
  bot doesn't feel like a machine answering each line.
- As an operator, I want to tune (or disable) the grouping window per tenant.
- As the system, I must not double-count burst messages as both the current turn
  and prior history.

## Task report

| Task | Validation command | RED → GREEN |
|---|---|---|
| `coalesceInbound` pure helper | `npx vitest run src/lib/chatbot/coalesce.test.ts` | RED: import fails (module absent) → GREEN: 9/9 |
| `messageDebounceSeconds` config field (clamped 0–15) | `npx vitest run src/lib/chatbot/config.test.ts` | RED: 3 new assertions fail → GREEN: 10/10 |
| Webhook enqueues reply via debounce RPC; muted path unchanged | `npx vitest run src/app/api/webhooks/facebook/route.test.ts` | RED: 4 fail → GREEN: 198/198 |
| Worker coalesces inbound burst; history excludes the set | `npx vitest run src/app/api/messenger/process/route.test.ts` | RED: 1 fail (coalesce) → GREEN: 199/199 |
| Per-tenant settings UI + API | `npx tsc --noEmit` (clean) | type-checked |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Empty input → empty result, no throw | `coalesce.test.ts` | unit | PASS |
| 2 | Multiple bodies joined by `\n` in created_at order | `coalesce.test.ts` | unit | PASS |
| 3 | Out-of-order rows sorted; ties broken by id | `coalesce.test.ts` | unit | PASS |
| 4 | Empty/whitespace/null bodies excluded from text | `coalesce.test.ts` | unit | PASS |
| 5 | Over the cap keeps only the most recent N | `coalesce.test.ts` | unit | PASS |
| 6 | `rowToConfig` maps + clamps `messageDebounceSeconds` to [0,15], defaults 6 | `config.test.ts` | unit | PASS |
| 7 | Reply path enqueues via `enqueue_or_extend_messenger_job` with the tenant window | `webhooks/facebook/route.test.ts` | integration | PASS |
| 8 | Muted/classify path keeps a per-message direct insert (cadence preserved) | `webhooks/facebook/route.test.ts` | integration | PASS |
| 9 | Worker passes the combined burst text as the LLM `message` | `messenger/process/route.test.ts` | integration | PASS |
| 10 | Worker falls back to the single inbound body when no burst rows | `messenger/process/route.test.ts` | integration | PASS |

## Coverage / known gaps

- Final scoped run: **416 passed (32 files)**; `npx tsc --noEmit` clean.
- **SQL-level coalescing** (the RPC's slide-or-insert and the ≤1-queued-job-per-thread
  guarantee) is covered-by-construction in `20260620100000_messenger_debounce.sql`
  and asserted at the webhook layer only as *delegation to the RPC* — it is not
  exercised against a live Postgres in unit tests.
- **Migration not yet applied to the remote DB.** Applying is an outward-facing
  step pending explicit confirmation (see project memory on MCP migration version
  reconcile / projects-feature-migration-state).
- The "customer keeps typing after the LLM started" case intentionally produces a
  single follow-up reply rather than re-coalescing mid-generation.
