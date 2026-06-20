# TDD Evidence — Comments: always reply to "hm?" / price inquiries

**Source plan:** none — journeys derived during this TDD run from the bug report
("AI is avoiding the `hm?` comments and doesn't reply / doesn't message the
client. `Hm` means how much, and sometimes it's missing other comments too").

## Root cause

Short, context-free comments such as `hm?` (Taglish for "magkano / how much")
were sent to the LLM classifier in `src/lib/comments/classify.ts`. With no
business context the model returns `category: needs_no_action` /
`moderation_action: none`. In `src/app/api/comments/process/route.ts`,
`chooseGraphAction` then returns `'none'`, so the worker marks the job
`skipped` and **never posts a reply or sends a DM**. The same LLM fragility
explains why other genuine questions were occasionally dropped.

## Fix

Added a deterministic price/buying-inquiry detector (mirroring the existing
`classifyIntentHeuristic` pattern) that short-circuits `classifyComment` to a
guaranteed `question → private_reply` decision for these high-value comments —
independent of the LLM. Placeholders are replaced by the RAG answer in the
worker; the non-null public placeholder preserves the existing public-reply
fallback when private replies are not permitted.

## User journeys

1. As a page owner, when a customer comments `hm?` (or `magkano po?`,
   `how much?`, `pm price`, `interested`, `available?`), I want the bot to
   always reply and DM them, so I never miss a buying lead.
2. As a page owner, I do not want plain engagement comments ("Nice photo!",
   "salamat po") to trigger a sales DM.

## Task report

- **Detector + short-circuit** — Added `src/lib/comments/inquiry.ts`
  (`isPriceInquiry`, `priceInquiryDecision`) and wired `classifyComment` to
  return the guaranteed decision before the LLM call.
  - RED: `npx vitest run src/lib/comments/inquiry.test.ts src/lib/comments/classify.test.ts`
    → `Test Files 2 failed | 14 passed`, `Tests 1 failed | 165 passed`
    (`expected true to be false` on `llmCalled`; `inquiry.test.ts` failed to
    import the missing module).
  - GREEN: same command → `Test Files 16 passed`, `Tests 172 passed`.
  - Guarantee: `hm?`-style comments are classified `question` /
    `private_reply` deterministically, so the worker always replies/DMs.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | `hm` / `hmm` / `hm po?` is detected as a price inquiry | `src/lib/comments/inquiry.test.ts:detects "hm?" shorthand` | unit | PASS | `npx vitest run src/lib/comments/inquiry.test.ts` |
| 2 | Taglish/English price questions (`magkano`, `how much`, `presyo`, `price`, `pricelist`) are detected | `inquiry.test.ts:detects Taglish/English price questions` | unit | PASS | same |
| 3 | Buying/availability shorthands (`pm`, `interested`, `available`, `how to order`, `paano`) are detected | `inquiry.test.ts:detects buying / availability intent` | unit | PASS | same |
| 4 | Plain engagement comments are NOT treated as inquiries | `inquiry.test.ts:returns false for non-inquiry engagement` | unit | PASS | same |
| 5 | No misfire on substrings (`3pm`, `rhythm`) | `inquiry.test.ts:does not misfire on words that merely contain a keyword` | unit | PASS | same |
| 6 | `priceInquiryDecision` is high-confidence `private_reply` with non-null replies | `inquiry.test.ts:priceInquiryDecision` | unit | PASS | same |
| 7 | `classifyComment('hm?')` short-circuits to `private_reply` WITHOUT calling the LLM | `src/lib/comments/classify.test.ts:short-circuits "hm?" price inquiries` | unit | PASS | `npx vitest run src/lib/comments/classify.test.ts` |

## Coverage and known gaps

- Full comments suite: `npx vitest run src/lib/comments/` → 172 passed (16 files).
- Worker regression: `npx vitest run src/app/api/comments/process/route.test.ts`
  → 120 passed (15 files). `npx tsc --noEmit` reports no errors in changed files.
- Known gap: the detector is keyword-based by design (KISS). Inquiries phrased
  with no recognised keyword still fall through to the LLM classifier, which is
  unchanged. Extending the keyword list is the follow-up lever if more phrasings
  are reported.
