# TDD Evidence — chat-implied proceed: quote grounding + confirm-first

**Date:** 2026-06-22
**Source plan:** none (journeys derived during this TDD run from a bug report + screenshot of the chat-implied submissions list).

## The two bugs

1. **Fabricated proceed (Niña — "Kayo na po bahala"):** a lead who only asked a
   question got a CHAT-IMPLIED submission whose quote was `"Kayo na po bahala"` —
   the **first example phrase in the proceed-intent prompt** (`classify.ts`). The
   model echoed the canonical example into `quote`; nothing verified it against
   the customer's actual words.
2. **Auto-proceed (John — "ok go po"):** the bot immediately confirmed and fired
   a submission on the first go-ahead, with no confirm-first step and no offer to
   fill the real action-page form.

## User journeys

- As an operator, I do NOT want a chat-implied submission created when the lead
  never actually signaled proceed (no fabricated/echoed quotes).
- As an operator, when a lead says "go po", I want the bot to confirm first and
  guide them to the action-page form, and only fall back to a chat-implied
  record if they skip/decline the form.

## What changed

| Layer | Change | Bug |
|---|---|---|
| `virtual-submission.ts` | New pure `isProceedQuoteGrounded(quote, customerText)` (normalized substring containment). `decideVirtualSubmission` now rejects any medium/high signal whose quote is not grounded (`ungrounded_quote`). `createVirtualSubmission` takes `customerText` and computes grounding. | 2 |
| `messenger/process/route.ts` | Passes `customerText` = prior inbound turns + current message. | 2 |
| `classify.ts` prompt | `quote` must be the customer's verbatim words this thread (never an example/translation) else null; bare "go po/ok/sige" → low/null. | 2 |
| `classify.ts` prompt | `ackBlock` rewritten: CONFIRM FIRST → OFFER THE FORM → PROCEED ANYWAY IF THEY SKIP IT (chat-implied is the fallback). | 1 |

## Task report — RED → GREEN

- **Validation command:** `npx vitest run src/lib/chatbot/virtual-submission.test.ts`
- **RED:** added grounding tests + a `coerce`-free IO repro (fabricated quote) →
  `Tests 7 failed | 15 passed (22)` (incl. `expected { submissionId: 'sub_1' } to be null`).
- **GREEN after implementation:** `Tests 22 passed (22)`.
- **Full chatbot suite (GREEN):** `npx vitest run src/lib/chatbot/` → `Test Files 228 passed (228) · Tests 2398 passed (2398)`.
- **Types:** `npx tsc --noEmit` → no errors in the touched files.

## Test specification

| # | Guarantee | Test | Type | Result |
|---|-----------|------|------|--------|
| 1 | Medium/high signal with a quote NOT in the customer text is rejected | `virtual-submission.test.ts:rejects a high/medium signal whose quote is NOT grounded` | unit | PASS |
| 2 | `isProceedQuoteGrounded` accepts verbatim / fragment / accent-insensitive, rejects fabricated + empty | `isProceedQuoteGrounded` block (5 cases) | unit | PASS |
| 3 | IO: a fabricated proceed quote inserts NO submission row (Niña repro) | `does NOT insert when the proceed quote is fabricated` | integration-ish | PASS |
| 4 | Low confidence still needs heuristic (grounding not required) | `requires heuristic corroboration for low confidence` | unit | PASS |
| 5 | Prompt carries the confirm-first/offer-form/fallback policy | `classify.test.ts:adds proceed_info schema + capture + acknowledge guidance` | unit | PASS |

## Known gaps

- The confirm-first conversational flow (Bug 1) is prompt-policy — verified by the
  prompt-assembly unit test, not by an LLM behavioral test (no deterministic harness).
- Grounding uses strict normalized substring (no fuzzy token overlap) on purpose:
  common Tagalog fillers ("kayo/na/po") would let fuzzy matching wave fabricated
  phrases through. A verbatim quote (which the prompt now mandates) is always a
  substring of the transcript.
