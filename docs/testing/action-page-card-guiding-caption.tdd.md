# TDD Evidence — Action-page card: guiding caption + custom CTA (both paths)

## Source plan
Journeys derived during this TDD run from a user report + screenshot: the Messenger
action-page card showed the page **title** ("KantaMoKwentoMo fill up form") as its
description and the generic default **"Open form"** label, instead of a guiding
"what to do next" description and a custom CTA. The user also asked that the
description read as natural plain text (no styling/markdown).

## User journeys
- As a lead, when the bot sends an action-page card, I want the text above the
  button to guide me on what to do next (tap the button, fill the form) — not the
  page's title — so I know how to proceed.
- As a lead, I want that guidance to read as normal text (no asterisks/markdown).
- As the business, I want the button label to be a custom high-intent CTA, falling
  back to my configured `cta_label`, never the page title.
- Both the live-chat reply path and the scheduled follow-up path must behave the
  same way.

## Root cause
- Live chat (`src/app/api/messenger/process/route.ts`): `btnText = (aiBtnText || chosen.title)`
  fell back to the **page title** when the model omitted a caption → the screenshot's
  generic card. Label fell back to the page `cta_label`.
- Follow-ups (`generateCta.ts`/`fire.ts`) never used the title but did not strip
  markdown and used an inconsistent default caption.

## Change summary
- New shared helper `src/lib/messenger/action-page-card.ts`:
  `GUIDING_DEFAULT_CAPTION`, `cleanCardCaption` (strips markdown emphasis +
  surrounding quotes, keeps emoji/Tagalog hyphens), `resolveCardCaption`
  (guiding fallback, never the title, 640-cap), `resolveCardLabel`
  (AI → configured `cta_label` → "Open", 20-cap).
- Wired into `process/route.ts` (live chat) and `generateCta.ts` + `fire.ts`
  (follow-ups). Prompts in `classify.ts` and `generateCta.ts` now require plain,
  natural text (no markdown) and a non-empty, non-title caption.

## Task report
- RED: `npx vitest run src/lib/messenger/action-page-card.test.ts` → failed to
  resolve `./action-page-card` (module did not exist) — intended compile-time RED.
- GREEN: same command after implementing the module → 13 passed.
- Integration GREEN: `npx vitest run src/lib/messenger/action-page-card.test.ts
  src/lib/followups/generateCta.test.ts src/lib/followups/fire.test.ts
  src/lib/chatbot/classify.test.ts src/lib/chatbot/classify-cache-prefix.test.ts`
  → 33 files, 1286 passed (cache-prefix byte-identical-prefix test still passes
  after the prompt edits).
- Typecheck: `npx tsc --noEmit` → no errors in the touched files.

## Test specification
| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Caption uses AI text when present | `action-page-card.test.ts:resolveCardCaption uses the AI caption` | unit | PASS |
| 2 | Empty AI caption → guiding default, never the page title | `action-page-card.test.ts:falls back to the guiding default` | unit | PASS |
| 3 | Markdown emphasis + quotes stripped (natural font) | `action-page-card.test.ts:cleanCardCaption` | unit | PASS |
| 4 | Emoji + Tagalog hyphens preserved | `action-page-card.test.ts:keeps emoji and Tagalog hyphens` | unit | PASS |
| 5 | Caption clamped to 640, label to 20 | `action-page-card.test.ts:clamps ...` | unit | PASS |
| 6 | Label: AI → configured → "Open" | `action-page-card.test.ts:resolveCardLabel` | unit | PASS |
| 7 | Follow-up default caption = shared guiding default | `generateCta.test.ts`, `fire.test.ts` | unit | PASS |

## Known gaps
- The card text inherently renders in Messenger's button-template font (per the
  user's "keep inside the card" decision); the API cannot change that font, so the
  fix focuses on guiding, plain-text content.
- Process-route wiring is covered indirectly (helper unit tests + typecheck); the
  worker route has no isolated unit harness.
