# DeepSeek Cost Report — Clean-Sample Revalidation (DeepSeek-only profile)

*Date: 2026-06-02 · Scope: per-inbound Messenger reply path. **Nothing in this report is implemented — these are findings and recommendations only.** The prior audit's #1 item (GPT-4o-mini / DeepSeek-V4-Pro phantom spend) is RESOLVED and dropped — the owner already removed those models.*

*Supersedes the prioritization in `COST_OPTIMIZATION_AUDIT.md` for the DeepSeek-only reality.*

---

## 1. TL;DR

- **The clean sample confirms the prior audit's core thesis.** $0.00768 total / 55 req / 61K tok. DeepSeek-V4-Flash = 16 req / 57K tok = **~3,562 tok/req, ~96% input**. Embeds = 39 req / 3.25K tok ≈ **$0**. So **~99% of the dollar bill is DeepSeek *input* tokens** ($0.0076 of $0.00768).
- **With the phantom 30% gone, the #1 lever is unambiguously DeepSeek input-token reduction** — prompt caching first, then context/prose pruning. There is no GPT leak left to chase.
- **Absolute $ in testing is a rounding error. The danger is structural, not present-tense.** The cost lives in a **byte-identical static prefix (~5,300–5,770 tok) re-billed at full price on every single inbound turn** — no `cache_control` is wired (`src/lib/rag/llm.ts:79`), and `promptLayout='cache_friendly'` (`src/lib/rag/config.ts:77`) is a **pure billing no-op** until `cache_control` exists. At one tester that's $0; multiplied by thousands of concurrent client conversations, the per-message structure is what explodes.
- **The 3,562 tok/req figure is a *blended* average, not the dominant call's size.** The dominant `answerWithClassification` call (`classify.ts:237`) is **~2–2.4× larger** (~8,500 tok); it's averaged down by several sub-1K auxiliary calls in the 16-request bucket.

---

## 2. DeepSeek request anatomy (the 16 requests)

Both `RAG_LLM_MODEL` and `RAG_CLASSIFIER_MODEL` resolve to `deepseek/deepseek-v4-flash` (`.env.local:17,26`), so **every** `HfRouterLlm` call — "chat" or "classifier"-aliased — collapses into the same V4-Flash request bucket. That's why chat and classifier aren't separable in the sample.

**Most plausible breakdown of the 16 (real-Messenger reading, ~5–6 short test threads):**

| Call site | Type | Per-req tok | Likely count | Notes |
|---|---|---|---|---|
| `classify.ts:237` | **Main reply+classify envelope** (json_object, maxTok 600) | ~3,900–8,500 | **~9–11** | THE prod path (`process/route.ts:570`). Carries the full static prefix. ~93% of the 57K tokens. |
| `deep-reclassify.ts:288` | Deep stage re-eval over ~60 msgs (maxTok 400) | ~2,800 | ~1–2 | Cadence-gated: fires on 3rd inbound, then every 5th (`route.ts:1223`). |
| `extract.ts:77` | Reminder date/topic extraction (maxTok 200) | ~450 | ~1–2 | Pre-gated by `hasTimeMarker()` — only time-word messages reach the LLM. |
| `sequence-generate.ts:80` | Follow-up body generation (maxTok 160) | ~300 | **0 or 7** | **Bursty**: `seedReminderSequence` (`sequence-seed.ts:79`) fires **7 in parallel** when a reminder is created this turn. |
| `force-send.ts:161/179` | Qualification gate / proceed check (maxTok 60/30) | ~250–350 | ~0–1 | Heavily short-circuited by regex + stage-forward + per-lead cache. |
| `resolve.ts:49` | Resolve pending reminder topic (maxTok 200) | ~350 | ~0–1 | Needs a pre-existing pending reminder row. |
| `classify.ts:439` | classifyOnly (bot-muted branch) | ~1,800 | **0** | Mutually exclusive with `237`; only when bot is OFF. |
| `answer.ts:280` / `rag/llm.ts:126` / `comments/classify.ts:134` | rolling summary / CRAG rewrite / FB comments | 80–900 | **0** | Need >12-turn thread / empty retrieval / separate comments pipeline. |
| `test/route.ts:174` | Playground streaming reply (maxTok 800) | ~3,500 | 0 **or all 16** | If the sample came from in-app TestChat, the 16 are just 16 single streamed calls, no secondary passes. |

**Two cleanest reconciliations of "16":** (a) ~9 main + one 7-call reminder burst = 16; or (b) ~11 main + 2 deep-reclassify + 1–2 extract + ~1 force-send. Either way the big `classify.ts:237` prefix owns the bill, matching the 96%-input / 3,562-avg signature. *(Distinguish real-traffic vs playground by checking logs for `[chatbot.classify]` vs `[chat.timing]`.)*

**DeepSeek calls per inbound message:**
- **Typical = 1.** A median turn is exactly one `answerWithClassification` (reply + stage + action-page + recommend in a single envelope). Everything else is gated off at $0.
- **Worst case = ~10–11.** A single `"follow me up bukas 3pm about pricing"` inbound = main reply (1) + `extractReminder` (1) + the **7-call reminder-sequence burst** (7) + `deep-reclassify` (1, if a cadence turn) + force-send checks (0–2). The dominant worst-case driver is the **reminder burst** — tiny in tokens, but a parallel request spike that can trip OpenRouter's request-rate limit.

---

## 3. The ~3,562 tokens, dissected

Per dominant `answerWithClassification` turn (`classify.ts:237`), measured raw text → tokens (@~4 ch/tok; dense Taglish prose is closer to ~3.7, which *under*-counts slightly):

| Bucket | File ref | Est. tok | Class |
|---|---|---|---|
| Persona + rules stable prefix | `prompt-builder.ts:135-187` (8,988 chars) | **2,247** | **static-cacheable** |
| KB context header line | `prompt-builder.ts:189` | 17 | **static-cacheable** |
| stageInstruction static prose (header/schema/hierarchy/calibration/examples/attach-images/AP preamble) | `classify.ts:559-712` (12,306 chars) | **3,077** | **static-cacheable** |
| manilaNowBlock (minute-resolution timestamp) | `manilaNow.ts:48-52` → `prompt-builder.ts:217` | 17 | volatile *(cache poison)* |
| RAG KB chunks (top `maxContext`=6) | `prompt-builder.ts:94-99` | 1,400 *(≤6,144 worst)* | semi-static |
| stageList + currentStageBanner | `classify.ts:818-834` / `715-727` | 1,800 | semi-static |
| actionPageList | `classify.ts:795-801` | 600 | semi-static |
| leadName + leadContext block | `classify.ts:197-201` / `leadContext.ts:205-231` | 610 | volatile |
| summary + paymentEnum + media | `prompt-builder.ts:118-128` / `classify.ts:225` | 300 | volatile |
| history (last 12 turns, redacted) | `classify.ts:232`, sliced `route.ts:566` | 389 | volatile |
| user message (redacted) | `classify.ts:233` | 30 | volatile |
| completion (reply + JSON envelope) | `classify.ts:246` (maxTok 600) | 300 | volatile (~4–8%) |

**Static-cacheable share ≈ 63%** (~5,340 tok byte-identical @4 ch/tok; ~5,770 @3.7) — re-billed at full price every turn today.

**Reconciliation with the observed 3,562:** the *static prefix alone* (2,247 + 17 + 3,077 = ~5,340 tok) already exceeds the sample mean. A full action-page classify turn projects to **~8,500 prompt tok**, so the dominant call **cannot** be 3,562 — that number is a **blended average** of one big classify call with several few-hundred-token auxiliary calls (reminder/force-send/extract), plus a skew toward **smalltalk / no-action-page tenants** (drop the ~1,277-tok `apPreamble` at `classify.ts:608` and thin/empty RAG → a no-AP smalltalk turn lands ~4–5K, blending down to 3,562). **The dominant classify call is ~2–2.4× the sample mean.**

**Per-turn token target after each lever** (raw prompt tok, baseline ~8,507 for a full classify turn):

| Lever | Mechanism | Result |
|---|---|---|
| **(d) Compress stage prose** | Tighten `apPreamble`/`attachImages`/`examples` (`classify.ts:559-712`); the AP preamble repeats "never mention link/button/form" ~6×. ~3,077 → ~1,200 static tok | 8,507 → **~6,381** |
| **(b) Prune context** | `maxContext` 6→3, `chunkMaxTokens` 1024→512 (`config.ts:65,42`): KB ~1,400 → ~750 | → **~5,731** |
| **(c) Trim history** | `LLM_HISTORY_TURNS` 12→8 (`route.ts:70`): ~389 → ~259; rolling summary already absorbs older turns | → **~5,601** |
| **(a) Cache static prefix** | Wire `cache_control` + fix contiguity; at ~0.1× cache-read rate on ~5,300 contiguous static tok | → **~2,319 effective billed** |

**(a) does ~70% of the total savings.** It is currently blocked by a **prefix-contiguity break**: `classify.ts:226` joins `[built.system, stageSystem, …]`, but `built.system` *ends* with volatile KB chunks + the minute-resolution `manilaNowBlock` (`prompt-builder.ts:217`) **before** the 3,077-tok static stageInstruction prose is appended. The cacheable static is split by a volatile block, so a single cache breakpoint can't cover it. Fix: (i) drop `manilaNow` to **date-resolution** (changes daily, not per-minute) or hoist it to the tail, and (ii) reorder to `[stable persona | static stageInstruction prose | THEN volatile: stageList/AP/banner/KB/leadCtx/summary/manila]`.

---

## 4. Embeds: 39 vs 16 explained

**Why 2.4:1.** It's *where embeds sit*, not redundant fan-out. Per inbound there's exactly **one** main DeepSeek call, but that turn is bracketed by independent, un-cached embeds:

- **Guaranteed every turn (~1.0):** retriever query embed (`retriever.ts:53`).
- **Conditional, mostly mutually-exclusive (~1.4):** media semantic ranking only on folder-ref replies (`selector.ts:85`, gated `:127/:155`); CRAG rewrite only on zero-candidate retrieval (`retriever.ts:168`, gated `:159`); `recommend_product`/`recommend_property` only on recommend intent (`recommend.ts:109` / `recommend-property.ts:114`, gated `route.ts:767/869`).

Secondary DeepSeek calls (deep-reclassify, classifyOnly, follow-up, force-send) emit **zero embeds**, which *deflates* the ratio — so the per-*retrieval*-turn embed count is actually higher than 2.4. The **~83 tok/embed** average confirms these are short query-side strings, **not** ingest chunks (ingest embeds run ~800–1024 tok, `config.ts:41-42` → ingest didn't run during the sample). `factory.ts:5` mints a **fresh embedder per call** with no shared state and **no cache** (`openrouter-client.ts:28`), so even identical query strings re-embed.

**Verdict: ≈$0 cost, do NOT optimize embeds for money.** Embeds are ~3.25K of 61K tokens (~5%) and round to zero in dollars. They are purely a **request-count / rate-limit** concern at scale: at 100–1000 clients on one shared `OPENROUTER_API_KEY` (`openrouter-client.ts:18`), embeds are the *single largest contributor to raw request count* on the chat path, on a cheaper tier with tighter RPM ceilings. A 429 on the query embed currently **throws and can fail the whole turn** (`retriever.ts:53-56`), and `withRetry` retries into the same limit. **Recommendations (hardening, not cost):** add a process-level LRU cache keyed `sha256(model+text)` in `OpenRouterEmbedder.embed` (`openrouter-client.ts:28`); reuse the `retriever.ts:53` vector in `selectMediaForReply` + `recommend*` instead of re-embedding (roughly halves per-turn embeds); make `createEmbedder` (`factory.ts:5`) a shared singleton; degrade a 429 to BM25-only instead of failing the turn.

---

## 5. Re-prioritized roadmap (DeepSeek-only)

*GPT/phantom-leak item removed — resolved.*

| # | Change | Mechanism (file:line) | Est. savings | Effort | Risk |
|---|---|---|---|---|---|
| **1** | **Prompt-cache the static prefix + fix contiguity** | Wire `cache_control` in `llm.ts:79-87` (currently none); make `promptLayout='cache_friendly'` real (`config.ts:77`); reorder so ~5,300 static tok are contiguous; drop `manilaNow` to date-resolution (`prompt-builder.ts:217`) | **~61% of prompt cost** (8,507 → ~3,311 billed); ~96% of bill is here | **M** | **Low** ($0 quality cost; correctness-only reorder) |
| **2** | **Classifier-alias separation** (config hygiene) | `RAG_CLASSIFIER_MODEL` (`.env.local:26`) aliases to the same `deepseek-v4-flash`; either intentionally route classify/reminder/extract to a cheaper/smaller model or document that they're identical so caching strategy is per-call-type | Enables right-sizing the ~6 small call types | **S** | **Low** |
| **3** | **Compress stage prose** | Tighten verbose/repetitive `apPreamble` + `attachImages` + `examples` (`classify.ts:559-712`); ~3,077 → ~1,200 tok | **−~1,900 raw tok/turn** (best non-cache lever) | **M** | **Med** — AP tease-suppression is load-bearing (`LINK_TEASE_RE` guard, `classify.ts:289`); compress, don't delete |
| **4** | **Prune RAG context** | `maxContext` 6→3, `chunkMaxTokens` 1024→512 (`config.ts:65,42`); pair with reranker (`rerankTopK=8`) | **−~650 tok/turn** (−4,600 worst case) | **S** | **Med** — mild recall risk on long-doc tenants |
| **5** | **Deep-reclassify gating** | Today cadence-gated (3rd inbound + every 5th, `route.ts:1223`), **not signal-gated** — fires on big ~2,800-tok prompts regardless of whether stage signals changed. Add a signal gate (skip if no stage-relevant delta) | Removes ~1–2 of every ~16 calls; ~2,800 tok each | **S** | **Low** |
| **6** | **Follow-up / reminder-burst batching** | `seedReminderSequence` fires **7 parallel** `generateSequenceMessage` (`sequence-generate.ts:80` / `sequence-seed.ts:79`). Batch into 1 multi-output call or throttle | Cuts request burst 7→1 (rate-limit relief; tokens already small) | **M** | **Low** |
| **7** | **Trim history** 12→8 turns | `LLM_HISTORY_TURNS` (`route.ts:70`); rolling summary (`route.ts:706`) covers older context | **−~130 tok/turn** (smallest lever) | **S** | **Low** |

**Work order:** #1 (cache + contiguity) → #3 (compress) → #4 (prune) → #7 (trim). #5/#6 are request-count/rate-limit wins.

---

## 6. Recomputed scale projection

**Assumptions (stated explicitly):**
- Baseline = clean-sample blended **3,562 tok/req**, **~96% input**, DeepSeek-V4-Flash.
- Price modeled at a **blended ~$0.13/M tokens** (input-dominated, so treat as a single blended rate). Embeds ≈ $0 and excluded.
- **Typical 1 DeepSeek call per inbound message** (§2).
- Engagement model: **30 inbound messages/active lead/month**, **200 active leads/client/month** = **6,000 billed reply turns/client/month**.
- "AFTER" = levers #1+#3+#4+#7 applied → conservatively model AFTER at **~2,300 tok/req** (a ~35% cut on the blended 3,562; caching does most of it). *(If you model AFTER against the true dominant ~8,507-tok turn rather than the blended average, the absolute savings are ~2–2.4× larger — these figures are deliberately conservative.)*

**Per turn:** $0.13/M × 3,562 tok = **$0.000463/turn** (before) → ~$0.000299/turn (after).

| Scale | Turns/mo | **BEFORE** /mo | **AFTER** /mo | Saved/mo |
|---|---|---|---|---|
| **1 client** | 6,000 | **$2.78** | $1.79 | $0.99 (~35%) |
| **10 clients** | 60,000 | **$27.78** | $17.94 | $9.84 |
| **100 clients** | 600,000 | **$277.84** | $179.40 | $98.44 |
| **1000 clients** | 6,000,000 | **$2,778** | $1,794 | **$984** |

**Reading:** at testing scale this is invisible (cents). At 1000 clients it's ~$2.8K/mo trending to ~$1.8K/mo after the levers — still modest *in dollars*, but two caveats dominate: (1) **worst-case turns (§2) can be 10×** the typical, and a single reminder-bearing message issues a 7-call burst — so a heavy-reminder workload multiplies both cost and request count well past this linear projection; (2) **request-count limits bite before dollars do** — embeds (§4) plus reminder bursts on a single shared API key are the real ceiling at 100–1000 clients, independent of spend.

---

## 7. Bottom line

**Yes — stay on DeepSeek-V4-Flash.** The clean sample confirms the model itself is cheap and input-dominated; the cost is not the model, it's that the **same ~5,300-token static prefix is re-billed at full price on every inbound turn with no cache** (`llm.ts:79`, `cache_friendly` is a no-op). The three changes that buy the most headroom before paying clients arrive:

1. **Wire prompt caching and fix the prefix-contiguity break** (`classify.ts:226` + `prompt-builder.ts:217`) — ~70% of all savings at near-zero quality risk; the single highest-leverage item.
2. **Compress the repetitive stage/action-page prose** (`classify.ts:559-712`, ~−1,900 tok/turn) — the best non-cache lever.
3. **Tame the request-count surface** — add an embed cache + reuse the retriever vector (`openrouter-client.ts:28`, `retriever.ts:53`) and batch the 7-call reminder burst (`sequence-generate.ts:80`), which is what actually breaks first at 100–1000 concurrent clients on one shared key.

**Nothing here is implemented yet** — all items are findings and recommendations.
