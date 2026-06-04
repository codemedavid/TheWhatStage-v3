# WhatStage Chatbot — Token Health & Optimization Report

**Trigger:** Free-tier tenant "David Reyes" pulled 6,936 tokens in one chat / one metered call. Owner suspected token bloat.
**Date:** 2026-06-04 · **Branch:** `feat/usage-billing-metering`
**Method:** 19-agent workflow (measure → research → synthesize → adversarial verify → report). 5 of 10 candidate findings survived verification.

---

## 1. TL;DR — Health verdict

**The 6,936-token / one-call event is HEALTHY. It is not bloat. Do not change the prompt because of it.**

The single `llm_usage_events` row is one *combined* reply + stage-classify + action-page + recommendation call (`scope=chatbot.classify`) — the only metered call on the happy path.

| Metric | Value |
|---|---|
| `prompt_tokens` | 6,839 |
| `cached_prompt_tokens` | 6,528 (**95.5% cache hit**) |
| `completion_tokens` | 97 |
| `total_tokens` | 6,936 |
| `cost_micros` | 138 → **real cost $0.000138** (~PHP 0.008) |

**95.5% of those tokens were served from DeepSeek's KV/prefix cache** and billed at a fraction of fresh input. Only 311 prompt tokens were fresh, plus 97 output. A 95.5% cache hit is far above the industry-healthy target (>60%) and nowhere near the alert line (<50%).

**Why even the *first* observed call hit cache:** David Reyes is on the **DEFAULT persona**, whose static prefix is byte-identical across all tenants (`prompt-builder.ts:163-215` stable block + `classify.ts:798-815` stage prose; only the once-per-day date tail rotates). Other tenants' traffic pre-warms the shared prefix, so a brand-new default-persona tenant inherits a warm cache on turn one. This is the intended, working design.

### The owner's instinct is inverted
The number alarms only because the eye lands on raw `total_tokens` — economically meaningless on its own (the same total can cost 10–50× more or less depending on the cached/fresh split). The **`Est. cost` column already showed the truth: $0.0001.** The correct alarm is the *opposite* of high tokens: alert when **cache-hit-rate drops below 50%** or **fresh/output tokens spike >2× baseline**.

### Three real concerns — all *separate* from this call's health
1. The static prefix is ~78% of the prompt and is billed at **FULL price on cold or custom-persona tenants** (the Identity line at `prompt-builder.ts:171-173` is the first content-bearing line, so any custom persona busts the entire ~3k shared region).
2. The true cost driver at scale is the **volatile tail (KB context, never cached) and OUTPUT tokens** — not the cached prefix.
3. Satellite LLM calls (force-send prereq/proceed, reminder extract, `rewriteQuery`, `summarizeConversation`) are **unmetered**, so the ledger slightly *under*-counts true per-turn spend.

---

## 2. Token budget of one turn

Assembled as a contiguous **cacheable static prefix** + a **volatile tail** (`classify.ts:261-273`). The cache key is the longest byte-identical *leading* prefix.

| # | Section | Source | ~Tokens | Cached? | Notes |
|---|---|---|---|---|---|
| **[A]** | Persona / ground rules / reply-length / punctuation / discipline / DO / DON'T / grounding / fallback | `prompt-builder.ts:163-215` | ~1,200–1,500 | ✅ (default persona) | Identity line at :171-173 — custom persona busts everything below it |
| **[B]** | `## STAGE CLASSIFICATION` + schema + hierarchy/calibration/examples + attach-images + action-page preamble + recommend | `classify.ts:649-823` | ~3,000+ | ✅ (default persona) | Largest block. `apPreamble` alone ~1,300 tok; `attachImagesBlock` ~506; `examplesBlock` ~282 |
| **[C]** | Goal → instructions → summary → payment → **KB context** | volatile tail | 0 on greetings, up to ~6.1k worst-case | ❌ never cached | `maxContext=6` × up to 1,024 tok/chunk. **The real fresh-token lever.** ~0 on this row (greeting) |
| **[D]** | Current-stage banner + stage list + action-page list | volatile tail | ~100–300 | ❌ | Decisive volatile data — correctly near the user turn |
| **[E]–[G]** | Lead name / lead context / media context | volatile tail | small | ❌ | |
| **[H]** | `manilaNow` DATE tail | volatile tail | tiny | ✅ within a day | Rotates once/day |
| | **History** | `process/route.ts:71` `LLM_HISTORY_TURNS=12` | varies | ❌ | Most-recent 12 turns |
| | **Output** | completion | 97 | n/a | Output rate |

**On the David Reyes row:** 6,528 cached ([A]+[B], shared & pre-warmed) + 311 fresh (a greeting, little/no KB) + 97 output. The expensive sections [C] and history were near-empty — which is exactly why the call was so cheap, and exactly why "trim the KB context" would have saved **$0 on this incident** (it's a real scale lever, just not relevant to this trigger).

---

## 3. Ranked optimization roadmap (survived adversarial verification)

**None of these is a "fix" for the David Reyes alarm** — that is a presentation matter. These are genuine hardening improvements, highest ROI first.

### #1 — Capture OpenRouter's provider-exact `usage.cost`; correct the price map as fallback
**ID F3 · Effort S–M · Risk Low–Med (billing, new events only) · Confidence High**

`pricing.ts` self-flags its rates as ESTIMATES (`pricing.ts:11-14`). The DeepSeek V4-Flash entry (`:28-32`) over-models cache reads (`cachedInputPerM=0.013` ≈ 0.1× when DeepSeek charges ~0.02×) and under-models output (`outputPerM=0.13`) — and **output is the real cost driver at scale.**

**Do NOT blindly hardcode DeepSeek first-party rates** — this app bills through **OpenRouter** (`RAG_LLM_BASE_URL=openrouter.ai`), whose live V4-Flash rates differ from DeepSeek's first-party page. Swapping in `0.14/0.0028/0.28` replaces one wrong estimate with another (over-billing input ~42%).

**Fix (primary):** capture OpenRouter's inline `usage.cost` in `recordUsage` and store it as `cost_micros`; keep the price map only as a fallback. `llm.ts` reads only token fields today (verified — no `usage.cost`), so extend `LlmUsage`.
**Fix (fallback):** only after confirming the **live OpenRouter dashboard** rates, update constants and cite the source.

### #2 — Add cache-drop / fresh-token / cost-spike alerting (the inverse of the instinct)
**ID F8 · Effort S–M · Risk Low (read-only) · Confidence High**

The genuinely expensive failure modes are invisible on a token dashboard: the prefix changing so cache-hit collapses (previously-cached input re-billed fresh at ~10×), or output ballooning. **Nothing alerts on these today.**

**The data backbone already exists:** `usage_daily` stores `cached_prompt_tokens`; hourly pg_cron rollup runs; superadmin RPCs expose cached tokens + per-tenant cost. Add a lightweight check (reuse the rollup cadence) that fires Sentry when: cache-hit rate **< 50%**; cost **> 2× trailing-7-day-same-hour baseline**; any one `user_id` **> ~1% of the day's cost_micros** (with an absolute floor so it doesn't fire on penny days). **Do NOT build a keep-warm pinger** — net-negative on sparse traffic.

### #3 — Fail-fast startup assertion: model is priced AND on the caching provider
**ID F9 · Effort S · Risk Low · Confidence High**

`config.ts:15-17` hard-defaults `llmModel` to Llama on the HF router. The whole cache strategy depends on **prod env** setting `RAG_LLM_MODEL=deepseek-v4-flash` + an OpenRouter base URL. If that regresses, Groq/HF does no cross-request prefix caching (every turn pays full uncached input on the ~3k prefix) and `pricing.ts` has no Llama entry so cost records as **$0** — masking the regression. `recordUsage.ts:42-50` already warns + stamps `priced=false` (so not *fully* silent), but a **boot-time** assertion (model has a `PRICES` entry AND base URL is the caching provider) catches it before any traffic. **Do NOT** add a Llama price entry — wrong numbers are worse than an explicit `priced=false`.

### #4 — Keep the byte-stable cache prefix locked (already done — verify it holds)
**ID F10 · Effort ~0 · Risk None · Confidence High**

Already shipped and must NOT be redone: (1) combined reply+classify+action-page+recommend in one metered call; (2) `cache_friendly` layout with byte-stable prefix + date-only tail; (3) `maxContext` 20→6; (4) DeepSeek auto-caching with **no `cache_control`** (correct). The guardrail test already exists and passes: `classify-cache-prefix.test.ts` (5/5 green). **Do NOT** add `cache_control` breakpoints; **do NOT** hoist KB/stage-list into the static prefix (lost-in-the-middle says decisive volatile data belongs near the user turn).

### #5 — Compress overlapping static prose (quality + cold-start hygiene, NOT a cost win)
**ID F7 · Effort L · Risk Medium · Confidence High**

Heavy redundancy in the static prefix: em-dash ban / 1–2-sentence cap / one-question / no-repeat / not-sure-twice / Taglish each stated 2–3× across HARD RULES + DO/DON'T (e.g. not-sure stated **three times**: `prompt-builder.ts:189`, `doRules[4]`, `dontRules[7]`); the action-page no-link rule restated **~5×** inside the ~1,300-tok `apPreamble` (`classify.ts:724,726,727,731,734`); the forbidden-control-token enumeration (`classify.ts:803`) duplicates what `sanitizeReply()` already does programmatically; 5 stage examples where 2–3 would do.

**Honest framing — this is NOT a cost lever.** These tokens are ~95% cache-served → steady-state savings ≈ **$0**. Realistic compressible ≈ **600–900 tokens** (not 1,500+; that figure wrongly includes `attachImagesBlock`, which carries distinct behavior). The value is **reply quality** (de-conflicting stacked rules can hurt instruction-following), **cold-start cost**, and a calmer dashboard number. Keep ONE authoritative statement per rule; collapse the 5 no-link restatements to one rule + one bad/good pair (link-leaking was a real prod bug — keep at least one); replace the token enumeration with one line. **Do NOT** gut `attachImagesBlock` or the qualify-before-sending logic. Ship as a deliberate cutover behind `RAG_PROMPT_LAYOUT`, re-run byte-stability tests, eval on ≥50 Taglish threads before/after.

---

## 4. Rejected / already-done (do not chase these)

| ID | Title | Reason |
|---|---|---|
| **F1** | Lead dashboard with cost, demote raw tokens | Targets a **dead file** — `SuperadminUsage.tsx` has zero importers (verified). The live `UsageAnalyticsPanel.tsx` **already shows cache-hit %**; staying tokens-primary is a deliberate decision until rates are verified (`pricing.ts:11-14`). Residual: delete the orphan. |
| **F2** | Plumb `cached_prompt_tokens` through rollup + RPC | **Already done** (`usage_daily` regrain + analytics RPCs carry it). Re-applying additive ALTERs would conflict with the regrain. |
| **F4** | Trim `maxContext` 6→3 + per-chunk cap | **Irrelevant to the trigger** (David Reyes row had KB empty → $0 saved) and the per-chunk-cap half is **risky**: `grounding`/`guardReply` validate against full chunk content, so truncating LLM input desyncs the hallucination guard. The `maxContext 6→3` default alone is a defensible scaling-prep change behind an eval — not a fix for this alarm. |
| **F5** | Reorder prefix persona-last | Sub-cent savings for a cohort that excludes the trigger; persona-last **breaks documented cross-references** (`prompt-builder.ts:173` voice "flows from the Identity above") — a voice regression for a sales bot. |
| **F6** | Gate `attachImagesBlock` on has-media | **Correctness break** — the signal means "no image relevant *this turn*", not "tenant owns no media", so it would silently disable image attach for media-rich businesses, and would fragment the shared prefix. |

---

## 5. Best-practices appendix

**Prompt caching**
- DeepSeek Context Caching — https://api-docs.deepseek.com/guides/kv_cache — automatic disk KV cache, no `cache_control`; reports `prompt_cache_hit/miss_tokens`
- DeepSeek pricing — https://api-docs.deepseek.com/quick_start/pricing — cache-hit ≈ 0.02× fresh; output is the cost driver
- OpenRouter prompt caching — https://openrouter.ai/docs/guides/best-practices/prompt-caching — "keep the initial portion identical, push variation to the end"
- OpenRouter usage accounting — https://openrouter.ai/docs/cookbook/administration/usage-accounting — `usage.cost` = provider-exact charge (the F3 fix)
- Anthropic prompt caching — https://platform.claude.com/docs/en/build-with-claude/prompt-caching — static-first/volatile-last; "breakpoint after a timestamp" anti-pattern
- ProjectDiscovery case study — https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching — relocation trick lifted hit-rate 7%→84%; one provider route
- vLLM prefix caching — https://docs.vllm.ai/en/stable/design/prefix_caching — unique prefixes get LRU-evicted first

**RAG context minimization**
- Databricks long-context RAG — https://www.databricks.com/blog/long-context-rag-performance-llms — more chunks → diminishing then negative returns; worst for small models
- "The Distracting Effect" — https://arxiv.org/abs/2505.06914 — near-relevant distractors cost 6–11 accuracy points → use a real score floor
- Cohere rerank best-practices — https://docs.cohere.com/docs/reranking-best-practices — calibrate a score threshold from 30–50 queries
- Lost-in-the-middle — https://aclanthology.org/2024.tacl-1.9/ — keep decisive data near the end
- RAGAS context precision/recall — https://docs.ragas.io/ — pick the smallest K that keeps recall high, measurably

**Prompt compression & history**
- Anthropic effective context engineering — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents — "smallest high-signal set"; examples over edge-case lists
- LangChain `trim_messages` / `ConversationSummaryBufferMemory` — token-bounded window + rolling summary; trigger on token budget, not turn count

**Metering & health**
- Helicone cost tracking — https://docs.helicone.ai/guides/cookbooks/cost-tracking — cache-hit-rate + cost-per-request as headline tiles
- Langfuse token/cost tracking — https://langfuse.com/docs/observability/features/token-and-cost-tracking — cached_tokens as a first-class usage type
- LLM token economics — https://thesoogroup.com/blog/hidden-cost-of-llm-apis-token-economics — thresholds: healthy >60%, alert <50%, spike >2× baseline (the F8 numbers)

---

## 6. "Pull only what's related" — direct answer

Your bot **already does this well.** The 6,936-token call is 95.5% a *shared, reusable* template, not per-turn waste.

**Already correct (leave it):** one combined call (not four); cache-friendly layout; satellite calls fire conditionally (`rewriteQuery` only on zero candidates, `summarizeConversation` only when a roll is due, media uses an embedder not an LLM); the action-page/recommend blocks already ship only when configured (`hasActionPages`/`hasRecommend`).

**The knobs that control the volatile tail (the part billed fresh every turn):**

| Knob | Location | Default | Recommendation |
|---|---|---|---|
| `maxContext` (KB chunks sent) | `chatbot/config.ts:65` | 6 (was 20) | Consider 6→3 for new configs **behind a RAGAS eval** — biggest fresh-token lever, but scale-prep, not a fix for this alarm |
| Score floor / CRAG band | `retriever.ts:153-154` (`high=0.3`) | sends 0.1–0.3 "ambiguous" band | Calibrate a floor from 30–50 queries; stop sending the ambiguous band by default — improves quality *and* trims tokens |
| History window | `process/route.ts:71` `=12` | 12 | Measure how often threads even reach 12 turns first; long-term, bound by a token budget not a turn count |
| Conditional blocks | `classify.ts` | already gated | Keep; do **not** extend to `attachImagesBlock` via the per-turn media signal (breaks image attach — F6) |
| Per-chunk size (future ingests) | `rag/config.ts:41-42` (`max=1024`) | 1024 | 512 is the literature sweet spot for short FAQs; defer until cheaper knobs are measured + reconcile with `grounding`/`guardReply` |

**Bottom line:** the bot already does only what's needed per turn; the 6,936 is 95.5% a cached shared template, not bloat. The change that directly answers your complaint is **reading the `Est. cost` ($0.0001) instead of the token count** — and hardening so a *real* regression (cache-hit dropping) can't hide behind a flat token number (F8).
