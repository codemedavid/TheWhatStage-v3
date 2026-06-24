# TDD Evidence — Salvage reply from truncated combined-call JSON

**Branch:** `perf/classify-salvage-reply`
**Date:** 2026-06-24
**Scope:** cost reduction — Phase 1 of the LLM usage audit

## Problem

Ledger (`llm_usage_events`, trailing 7 days) showed **678 `chatbot.answer.fallback`
events against 3,356 `chatbot.classify`** — i.e. **~20% of replies pay for a second
full LLM call**. The fallback fires whenever the combined classify call's JSON fails
to parse (`classify.ts` `if (!text)`).

Root cause: the combined call emits the schema with **`reply` as the first field**
(`classify.ts:785`), followed by the structured tail (`stage_change`,
`proceed_intent`, `proceed_info`, `action_page`, …). The recently-added
`proceed_intent`/`proceed_info` fields inflate the output; when it crosses
`REPLY_WITH_STRUCTURE_MAX_TOKENS = 1024` the model truncates the **tail**, leaving
the JSON unterminated — even though a complete `reply` string is already present.
`parseJson` returns null, so we discard the finished reply and regenerate it.

## Fix

`salvageReply(raw)` extracts the `reply` value from the raw (possibly truncated)
output, tolerating escaped quotes/backslashes and a mid-value cutoff. The classify
fallback path now attempts salvage **before** the second LLM call; the structured
envelope is treated as untrusted (same field resets as the LLM fallback). The
`chatbot.answer.fallback` call only runs when salvage yields nothing usable.

No model, prompt, or token-cap change — strictly removes a redundant paid call.

## Tests (RED → GREEN)

`src/lib/chatbot/classify.test.ts` → `describe('salvageReply')`:

1. extracts reply from JSON truncated after the reply field
2. unescapes embedded quotes in the reply
3. recovers a reply string truncated mid-value (no closing quote)
4. returns the reply from a complete, well-formed envelope
5. returns null when there is no reply field
6. returns null for an empty reply value
7. returns null for empty input

- RED: `salvageReply is not a function` (7 failing).
- GREEN: 7/7 pass; full classify + classify-force-send suites **972 pass**; `tsc --noEmit` clean.

## Expected impact

Removes the second full reply on the truncation-driven share of the 20% fallback
rate (target fallback rate → <3%). `chatbot.classify` is 83% of weekly spend; this
is the highest single-lever ROI in the audit.

## Follow-ups (later phases)

- Phase 2: un-alias `RAG_CLASSIFIER_MODEL` (currently == main model) to a cheaper tier.
- Phase 3: recover cache-hit (~35% → 60%+) by restoring byte-stable prefix after recent feature merges.
- Consider persisting `finish_reason` to the ledger to measure truncation rate directly.
