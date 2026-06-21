# TDD Evidence: Always Send the Action Page on a Form Tease

**Date:** 2026-06-22
**Branch:** `fix/tease-always-send-action-page`
**Source plan:** journeys derived during this TDD run (no `*.plan.md`).

## Problem

Production log:

```
[classify.tease] model teased a link with no action_page attached {
  userId: '1c1f133e-...', actionPagesAvailable: 1,
  rawPreview: 'Perfect po! Sige, eto na po yung form para masimulan na natin 🎶',
  sanitizedPreview: 'Perfect po!'
}
```

The model teased a form in `reply` but left the structured `action_page` field
null. `classify.ts` only **logged** the tease and **stripped** the sentence, so
the customer received "Perfect po!" with **no button** — a dropped sale. The
existing `decideForceSend` net did not recover it because it requires passing a
qualification gate AND a readiness gate, neither of which a bare tease trips.

## User Journey

> As a sales operator, when my bot says it's sending a form, I want the action
> page button to actually attach every time, so that I never lose a ready buyer
> to a button-less reply.

**Decision (user-confirmed):** "Always send" — a tease + a sendable page →
attach the primary/fallback page, bypassing qualification + readiness. Keep only
the stage-sendable and page-exists guards.

## Behavior Change

`src/lib/action-pages/force-send.ts` — new `teasedLinkThisTurn` field on
`ForceSendContext`; new branch (after the stage + page + **cold-inbound** guards,
before the qualification/readiness path) that returns the fallback page with
`reason: 'override:tease'`. A shared `buildForcedChoice(pageId, reason)` helper
removes the duplicated `ActionPageChoice` shape across both override paths.

`src/lib/chatbot/classify.ts` — captures `teasedLink` in the existing
`[classify.tease]` block and threads `teasedLinkThisTurn` into `decideForceSend`.

## Review Hardening (post code-review)

A precision code review surfaced that `LINK_TEASE_RE` is a broad *detect-and-strip*
regex, so reusing it directly as a *send* trigger would force-send a form even on
NEGATED mentions ("hindi na kailangan i-fill up yung form", "optional lang yung
form") or loose matches ("check niyo na lang po schedule"). Fixes applied:

- **Negation/artifact gate** — recovery now fires only on a POSITIVE tease via the
  exported `hasPositiveLinkTease()`: a sentence must match `LINK_TEASE_RE`, name an
  action-page artifact (`TEASE_ARTIFACT_RE`), and NOT be negated/conditional
  (`TEASE_NEGATION_RE`). Unit-tested directly (the regex→decision seam).
- **Fallback path** — `teasedLink` is reset to `false` when the `!text` fallback
  regenerates a fresh reply, so we never attach a button under an unrelated reply.
- **Cold-inbound guard restored** — the tease branch sits *after* the cold-inbound
  check, so a tease never blasts a form on a first inbound. `leadId` is
  intentionally bypassed (deeplink is attributed by psid + page_id).
- **Scope** — the unrelated `stageInstructionParts` prompt edits that had leaked
  into the working tree (they belong to `fix/proceed-quote-grounding-tokens`) are
  excluded from this branch.

## Task Report

| Step | Command | Result |
|---|---|---|
| RED | `npx vitest run src/lib/action-pages/force-send.test.ts` | 2 failed / 1219 passed — tease branch absent; `overrideFired` false, `reason` `'override'` not `'override:tease'` |
| GREEN | `npx vitest run src/lib/action-pages/force-send.test.ts` | 1221 passed |
| Wiring GREEN | `npx vitest run src/lib/chatbot/classify-force-send.test.ts` | 17 passed |
| Regression | `npx vitest run src/lib/chatbot src/lib/action-pages --exclude '**/WhatStage_worktrees/**'` | 531 passed (40 files) |
| Typecheck | `npx tsc --noEmit` | clean (no errors in changed files) |

> Note: a bare `vitest run` over `src/lib/action-pages` also pulls in
> `WhatStage_worktrees/**` and shows 3 pre-existing failures in
> `WhatStage_V3-ap-validation/.../form.test.ts` — unrelated nested fleet
> worktree (known caveat). Excluded above.

## Test Specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A tease fires force-send even when unqualified AND no proceed signal | `force-send.test.ts:decideForceSend > tease recovery > fires for a tease even when unqualified AND no proceed signal` | unit | PASS |
| 2 | Tease recovery uses the first page when no primary configured | `force-send.test.ts:tease recovery > falls back to the first page when no primary configured` | unit | PASS |
| 3 | Tease recovery still respects the unsendable-stage guard (lost/dormant/won) | `force-send.test.ts:tease recovery > still respects the unsendable stage guard for kind %s` | unit | PASS |
| 4 | Tease recovery does nothing when no page exists | `force-send.test.ts:tease recovery > does nothing when there is no page to send` | unit | PASS |
| 5 | `answerWithClassification` passes `teasedLinkThisTurn: true` when the reply teases a form with no action_page | `classify-force-send.test.ts:passes teasedLinkThisTurn=true to decideForceSend ...` | integration | PASS |
| 6 | `answerWithClassification` passes `teasedLinkThisTurn: false` for a non-tease reply | `classify-force-send.test.ts:passes teasedLinkThisTurn=false when the reply has no tease` | integration | PASS |
| 7 | A NEGATED tease ("hindi na kailangan i-fill up") does NOT trigger recovery | `classify-force-send.test.ts:passes teasedLinkThisTurn=false when the tease is NEGATED` | integration | PASS |
| 8 | `hasPositiveLinkTease` returns true for genuine teases, false for negated/conditional/loose matches | `classify.test.ts:hasPositiveLinkTease` | unit | PASS |
| 9 | Tease recovery respects the cold-inbound guard and fires with `leadId: null` | `force-send.test.ts:tease recovery > still respects the cold-inbound guard / fires even when leadId is null` | unit | PASS |

## Known Gaps / Follow-ups

- When multiple action pages exist and the model picks none, recovery sends the
  **primary** page (best available guess). Operators with several pages should
  set `primaryActionPageId`. The production case had `actionPagesAvailable: 1`.
- Recovery intentionally bypasses qualification, so it can occasionally send a
  form a turn early — an accepted trade-off per the "Always send" decision. The
  stage guard still blocks lost/won/dormant.

## Merge Evidence

- RED commit: `test: add reproducer for tease-recovery force-send of action page`
- GREEN commit: `fix(chatbot): always send action page when model teases a form`
