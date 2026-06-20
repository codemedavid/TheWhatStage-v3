# TDD Evidence — Guiding CTA caption

**Date:** 2026-06-20
**Branch:** feat/projects-filters-search-stats

## Source

Derived during this TDD run from a user request: the action-page button caption
(e.g. "Simulan na ang kanta para sa carwash niyo 👇") was a terse benefit-led
one-liner. The user wants it to instead **guide the customer through what to do**
in warm, human Taglish — e.g. "Sige po, para masimulan na natin, i-click niyo
lang po yung button sa baba 👇 tapos fill-up niyo lang po yung form."

## User journey

> As a Messenger lead who just agreed to start, I want the action-page card to
> clearly tell me what to do next (tap the button below, then fill out the form),
> so that I don't get confused by a button with no instructions.

## What changed

The caption is **AI-generated** by prompt rules in two places (the button label
and fallback behavior are unchanged):

1. `src/lib/chatbot/classify.ts` — `BUTTON_TEXT RULES` (real-time chat path; the
   source of the screenshot caption).
2. `src/lib/followups/generateCta.ts` — `caption rules` in `buildSystemPrompt`
   (scheduled follow-up path).

Both now instruct the model to write a warm, guiding instruction walking the
customer through the steps (tap the button below → fill out the form), in a
polite Taglish "po" tone, max ~160 chars / 1–2 sentences (was ~80 chars,
benefit-led one-liner). The 200-char clamp (`CAPTION_MAX` / `coerceActionPage`)
already accommodates the longer copy.

## RED → GREEN

- RED: `npx vitest run src/lib/followups/generateCta.test.ts` — new test
  "instructs the model to guide the customer through what to do" FAILED because
  the old caption rules contained no "below / fill the form / guide" language.
- GREEN: after rewriting the caption rules, same command — 9 passed.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | The follow-up CTA system prompt instructs the model to guide the customer (button below + fill the form) | `src/lib/followups/generateCta.test.ts:instructs the model to guide the customer through what to do` | unit | PASS |
| 2 | Existing parse/clamp/fallback behavior is unchanged | `src/lib/followups/generateCta.test.ts` (8 existing) | unit | PASS |

## Regression check

`npx vitest run src/lib/chatbot/classify.test.ts src/lib/followups/ src/app/api/messenger/process/route.test.ts`
→ 136 files, 2456 tests, all PASS.

## Known gaps

- `classify.ts` BUTTON_TEXT RULES are not unit-asserted (the file builds one
  large composed prompt string); the change there mirrors the asserted
  `generateCta.ts` rules and is covered indirectly by the passing classify suite.
- The English fallback caption (`DEFAULT_CAPTION = "Tap below to continue 👇"`,
  used only on LLM timeout/error and in manual mode) was intentionally left
  unchanged.
