# TDD Evidence — proceed-quote grounding: token matching (review-finding fixes)

**Date:** 2026-06-22
**Source plan:** none — derived from the 3 code-review findings on the v1 grounding gate
(`docs/testing/chat-implied-proceed-confirmation.tdd.md`).

## Background

v1 `isProceedQuoteGrounded` used normalized **substring** containment. Code review
surfaced three failure modes of that mechanism; this change replaces it with
**distinctive-token matching** against the redacted transcript.

## User journeys

- As an operator, I do NOT want genuine consent dropped just because the model
  lightly rephrased the quote or it spanned a redacted phone number.
- As an operator, I still do NOT want a fabricated/echoed example phrase to
  create a chat-implied submission.

## The 3 findings → fixes

| # | Finding (v1 substring) | Fix |
|---|------------------------|-----|
| 1 | Over-rejects a lightly paraphrased quote ("ituloy niyo na" vs transcript "ituloy nyo na"). | Match only DISTINCTIVE tokens; fillers (niyo/nyo) ignored. |
| 2 | Quote spanning a redacted phone never grounds (model saw `[phone]`, grounding used raw digits). | Ground against `redactForLlm(customerText)` — the same space the model saw. |
| 3 | Short quote matches inside an unrelated word ("go po" ⊂ "ago poll"). | Whole-token matching, not substring. |

## Task report — RED → GREEN

- **Validation command:** `npx vitest run src/lib/chatbot/virtual-submission.test.ts`
- **RED** (3 new finding tests against v1 substring impl):
  `Tests 3 failed | 24 passed (27)` — Finding 1, Finding 2, Finding 3 failed as intended.
- **GREEN** (after token-matching impl): `Tests 27 passed (27)`.
- **Full chatbot suite:** `npx vitest run src/lib/chatbot/` → only `classify-force-send.test.ts`
  fails, which is a **separate in-flight task's uncommitted WIP**, unrelated to this change.
  All `virtual-submission` + `classify` proceed tests pass.
- **Types:** `npx tsc --noEmit` → no errors in `virtual-submission.ts`.

## Test specification

| # | Guarantee | Test | Type | Result |
|---|-----------|------|------|--------|
| 1 | Paraphrased/contracted quote grounds when its distinctive word is present | `Finding 1: accepts a lightly paraphrased quote…` | unit | PASS |
| 2 | Quote with a `[phone]` placeholder grounds against the redacted transcript | `Finding 2: grounds a quote that spans a redacted phone…` | unit | PASS |
| 3 | Short quote is not grounded by a substring inside an unrelated word | `Finding 3: rejects a short quote that only matches inside an unrelated word` | unit | PASS |
| 4 | Fabricated multi-word example (distinctive word absent) still rejected | `still rejects a fabricated multi-word example…` | unit | PASS |
| 5 | All-filler quote grounds only on contiguous appearance | `grounds an all-filler quote only when it appears contiguously` | unit | PASS |
| 6 | All prior grounding guarantees preserved (verbatim, diacritic, empty, fabrication) | existing `isProceedQuoteGrounded` cases | unit | PASS |

## Coverage and known gaps

- Stopword list is intentionally conservative (particles/pronouns only; proceed
  verbs and "phone"/"email" stay distinctive). A quote whose only distinctive
  token is itself a stopword-adjacent filler falls back to contiguous-phrase
  containment.
- Grounding still only gates medium/high signals; low confidence continues to
  require the deterministic heuristic (unchanged).
