# TDD Evidence: AI-Customized Action-Page CTA

**Source plan:** inline `/ecc:plan` (chatbot + scheduled follow-ups; fallback = page `cta_label`).
**Goal:** When the bot sends an action page over Messenger, the AI writes (1) a stronger benefit-led caption above the button and (2) a punchy 2-3 word button label tuned for CTR, replacing the static "Open form" / "View".

## User journeys
1. As a lead chatting with the bot, when it sends me an action page, I see a compelling caption and a short, high-intent button label in my own language — not a generic "Open form".
2. As a lead who went quiet and gets a scheduled follow-up with an action page, the button is similarly customized (AI mode) or at least uses the page's configured label (manual mode), never the old hardcoded "View".
3. As the business, if the AI omits or fails to produce a label, the button falls back to the page's configured `cta_label` so it's never broken or empty.

## Task report

### Task 1 — Chatbot button_label + stronger caption (`classify.ts`, `route.ts`, `force-send.ts`)
- Added `button_label` to `ActionPageChoice`; exported & extended `coerceActionPage` (clamp to Messenger 20-char cap); added `button_label` to the structured JSON schema; added **BUTTON_LABEL RULES** and strengthened **BUTTON_TEXT RULES** in the classifier prompt. Wired `route.ts` button send + persisted/preview text to `button_label || cta_label`.
- RED: `npx vitest run src/lib/chatbot/classify.test.ts` → 7 failed (`coerceActionPage is not a function`, missing `BUTTON_LABEL RULES`, missing `"button_label"` in schema).
- GREEN: same command → 923 passed. Full affected: `classify.test.ts` + `force-send.test.ts` → 2138 passed.
- Guarantees: the model is instructed and the envelope accepts a 2-3 word label; coercion clamps/sanitizes it; an unknown id is rejected; absent/non-string label defaults to `''` (→ cta_label fallback downstream).

### Task 2 — Follow-up CTA generator (`generateCta.ts`)
- New `generateActionPageCta()` mirroring `generateMessage.ts`: classifier model, 8s timeout, tolerant JSON parse, per-field + full fallback to `{ caption: 'Tap below to continue 👇', label: cta_label }`. Caption keeps Tagalog hyphens/emoji (no `sanitizeFollowup`).
- RED: `npx vitest run src/lib/followups/generateCta.test.ts` → file failed (module did not exist).
- GREEN: same command → 8 passed.
- Guarantees: parses `{caption,label}`; clamps label to 20; falls back on throw/timeout/non-JSON/empty fields; prompt carries page title + personality + the 2-3 word rule.

### Task 3 — Wire follow-up button + extend `mintActionPageDeeplink` (`attachments.ts`, `fire.ts`)
- `mintActionPageDeeplink` now returns `{ url, ctaLabel, title, instructions } | null`. `fire.ts` generates the CTA in AI mode, uses `cta_label` + neutral caption in manual mode, and always falls back to `cta_label`.
- RED: `npx vitest run src/lib/followups/fire.test.ts src/lib/followups/attachments.test.ts` → 5 failed (button payload still hardcoded `text/ctaLabel`; deeplink returned a string not an object).
- GREEN: same command → 427 passed.
- Guarantees: AI mode generates from page context and uses the result; manual mode skips the LLM and uses `cta_label`; deeplink exposes CTA context with safe defaults.

## Test specification
| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | `coerceActionPage` parses & clamps `button_label`, rejects unknown id, defaults empty | `src/lib/chatbot/classify.test.ts` (coerceActionPage) | unit | PASS |
| 2 | Classifier prompt emits BUTTON_LABEL rules (2-3 words) + schema field | `src/lib/chatbot/classify.test.ts` (BUTTON_LABEL rule) | unit | PASS |
| 3 | CTA generator parses/clamps/falls back across failure modes | `src/lib/followups/generateCta.test.ts` | unit | PASS |
| 4 | Follow-up AI mode generates CTA from page context; manual mode uses cta_label | `src/lib/followups/fire.test.ts` (attachments) | unit | PASS |
| 5 | Deeplink returns url + CTA context with safe defaults | `src/lib/followups/attachments.test.ts` | unit | PASS |

## Coverage and known gaps
- `route.ts` button wiring is exercised indirectly (the handler is a large worker not unit-tested here); the label-selection logic is a one-line `button_label || cta_label` covered by type checks and the coercion tests. Behavior verified via `tsc --noEmit` (clean) and full `src/` suite.
- Out of scope (confirmed): manual operator send (`ActionPagePicker`) is unchanged.
- Full `src/` suite shows 2 pre-existing failures unrelated to this change — `src/lib/workflow/executor.test.ts > utility_template` and `src/app/api/action-pages/submit/route.test.ts > CAPI`. Verified by `git stash` of all feature files + re-run on the clean tree: both still fail without this change. (Remaining failures are nested `WhatStage_worktrees/*` fleet copies, not this repo.)
- Cost note: AI mode adds one bounded LLM call per follow-up action-page send (8s timeout, graceful fallback). Chatbot path adds zero new calls (label rides the existing classifier output).
