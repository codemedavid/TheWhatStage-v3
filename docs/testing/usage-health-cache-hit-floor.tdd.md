# TDD Evidence — usage-health cache-hit watchdog false alarm

**Date:** 2026-06-22
**Trigger:** Vercel log
`[billing.usage-health] cache-hit rate 38.2% is below the 50% floor over the last hour (prompt=59385, cached=22690) — the prompt prefix may have lost byte-stability or traffic moved off the caching provider.`

## Diagnosis (read this first — the alert was a false positive)

Pulled the actual `llm_usage_events` rows for the flagged window. The scary causes named in
the alert are **both ruled out**:

- **Byte-stability intact.** Two classify/reclassify rows in the same hour hit **97.9%** and
  **97.2%** cache. A prefix that lost byte-stability could never fully hit — so the stable
  prefix is fine (`classify-cache-prefix.test.ts` still locks it).
- **No provider move.** Every row is still `deepseek/deepseek-v4-flash`, `priced=true`.

The sub-floor aggregate came from two benign, compounding effects:

1. **Mis-calibrated floor.** The 0.50 floor was set from one unusually-cacheable combined
   call (~95% hit). Representative chatbot prompts carry a large genuinely-dynamic tail
   (history + KB chunks + user message), so a perfectly-working prefix cache only covers
   ~40–50% of tokens. Warm rows landed 41/41/44/47/50% — the healthy ceiling, not a sag.
2. **UNKNOWN counted as zero-hit.** `recordUsage` coerced a null cache count (provider
   omitted the field = UNKNOWN) to `0`, identical to a genuine 0-hit. The watchdog then put
   those prompt tokens in the denominator with zero numerator, dragging the rate down.

Cost reality check: total spend for the whole flagged hour across 13 calls was **~$0.0087**.
Even billed fully fresh this is sub-cent/hour — informational, not a cost event.

## Fix

- `cached_prompt_tokens` made **nullable** (migration `20260621203059_cached_prompt_tokens_nullable.sql`).
- `recordUsage.ts` persists **NULL** for UNKNOWN (ledger), but keeps **0** for the cost
  estimate (conservative — no phantom cache discount).
- `usage-alerts.ts` excludes UNKNOWN (null) rows from the cache-hit denominator, and the
  floor default drops **0.50 → 0.30** (still env-overridable via `USAGE_ALERT_CACHE_HIT_FLOOR`).

## RED → GREEN

| Stage | Command | Result |
|-------|---------|--------|
| RED | `npx vitest run src/lib/billing/usage-alerts.test.ts src/lib/billing/recordUsage.test.ts` | 3 failed / 13 passed — denominator gave 0.21 (want 0.90); 32% tripped the old 0.50 floor; UNKNOWN stored as 0 (want null) |
| GREEN | same command | 16 passed |
| No regression | `npx vitest run src/lib/billing/` | 35 passed (5 files) |
| Typecheck | `npx tsc --noEmit` (touched files) | clean |

## Guarantees

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | UNKNOWN (null-cached) rows are excluded from the cache-hit denominator | `usage-alerts.test.ts › excludes UNKNOWN ... from the cache-hit rate` | unit | PASS |
| 2 | Alert fires when the KNOWN-row hit rate is below the floor | `usage-alerts.test.ts › fires when the KNOWN-row hit rate is below the floor` | unit | PASS |
| 3 | Floor is calibrated to 0.30 (32% no-fire, 28% fire) | `usage-alerts.test.ts › floor calibrated to 0.30` (2 cases) | unit | PASS |
| 4 | `recordUsage` persists NULL for an UNKNOWN cache count | `recordUsage.test.ts › persists cached_prompt_tokens as NULL when ... UNKNOWN` | unit | PASS |
| 5 | `recordUsage` persists the reported number when known | `recordUsage.test.ts › persists the reported number ...` | unit | PASS |
| 6 | Cost math uses 0 (not null) cached for UNKNOWN — finite, no phantom discount | `recordUsage.test.ts › treats UNKNOWN as 0 cached for the COST estimate` | unit | PASS |

## Known gaps / follow-ups (intentional, out of scope)

- **Historical rows are unchanged.** Pre-fix 0-rows can't be retro-classified as UNKNOWN; only
  new rows store NULL. The metric fix helps going forward; the 0.30 floor helps immediately.
- **Admin usage RPCs** (`admin-usage.ts` / `UsageAnalyticsPanel`) compute hit-rate as
  `sum(cached)/sum(prompt)` and now have the same UNKNOWN-in-denominator dilution. Not fixed
  here (watchdog-scoped). Apply the same `where cached_prompt_tokens is not null` filter if the
  panel's hit-% looks low.
