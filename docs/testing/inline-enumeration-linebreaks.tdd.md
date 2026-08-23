# TDD Evidence — inline A) B) C) option runs break onto their own lines

**Source plan:** none — journeys derived from a live bug report (screenshot of a
Messenger thread where the bot sent "A) Better Ordering Experience 😎 Mas
mapalaki orders C) …" as one flat paragraph; the 😎 is Messenger
emoticon-converting the inline `B)`).

## User journeys

- As a lead chatting with the bot, I want each option in an option list on its
  own line, so the choices are easy to scan on a phone and don't look AI-generated.
- As an operator, I want this to hold even when the LLM ignores the structured
  prompt and runs the options into one line.

## Root cause (two independent gaps)

1. **Remote DB never got the feature migration.** `structured_messages_enabled`
   / `structured_message_layout` / `reply_length_limit_enabled` /
   `reply_max_sentences` columns did not exist in the remote `chatbot_configs`
   (verified via information_schema query), so the "# Message structure" prompt
   section never fired and every tenant ran legacy flat-paragraph behaviour.
2. **No safety net for inline enumerations.** `splitStructuredLines` only
   splits on newlines the model already produced; a one-line `A) x B) y C) z`
   reply passed through untouched. Bonus defect: inline `B)` is
   emoticon-converted by Messenger into 😎.

## Task report

| Task | Command run | Result |
|---|---|---|
| RED: reproducer tests for `breakInlineEnumeration` + delivery wiring | `npx vitest run src/lib/chatbot/inline-enumeration.test.ts src/lib/chatbot/reply-delivery.test.ts` | 13 failed / 5 passed — failing for the intended reason (export missing; segments un-normalized). Commit `40f94bc`. |
| GREEN: implement normalizer, wire into `selectReplySegments`, send `segments[0]` on single-segment path | same command, then `npx vitest run src/lib/chatbot src/lib/rag` | 36/36 in the touched files; full scoped suite **403 files / 3690 tests passed**. `npx tsc --noEmit` exit 0. Commit `5c1119a`. |
| Apply migration `20260722000000_chatbot_structured_messages` to remote | Supabase MCP `apply_migration` + version reconcile to `20260722000000` in `supabase_migrations.schema_migrations` | success; history row now matches the file version (db push safe). |
| Enable feature for the active tenant | `update chatbot_configs set structured_messages_enabled=true, structured_message_layout='single' where user_id='6ba4362f-…'` | 1 row updated. |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Lettered inline run `A) x B) y C) z D) w` becomes lead line + one option per line with `X.` markers | `inline-enumeration.test.ts: breaks a lettered inline option run` | unit | PASS |
| 2 | Numbered runs `1) … 2) …` and `1. … 2. …` break the same way | two tests in same file | unit | PASS |
| 3 | Output never contains an emoticon-convertible `X)` marker | `never emits an emoticon-convertible ")" marker` | unit | PASS |
| 4 | Text the model already line-broke passes through byte-identical | `leaves text unchanged when the model already used line breaks` | unit | PASS |
| 5 | Prose with a single stray marker, runs not starting at A/1, and non-consecutive markers are untouched | three tests in same file | unit | PASS |
| 6 | Normalization applies in structured+bubbles, structured+single, AND legacy mode | `reply-delivery.test.ts` (3 new tests) | unit | PASS |
| 7 | Existing delivery/splitter behaviour unchanged | full `src/lib/chatbot` + `src/lib/rag` suites | unit/integration | PASS (3690) |

## Coverage and known gaps

- The worker route change (`text: segments[0] ?? reply`) is covered by type
  check + the delivery-unit contract, not a route-level integration test (the
  route has no existing test harness).
- `segmentReply` (split-messages mode) may split the normalized `A.` lines on
  sentence boundaries; each option still lands in its own bubble, so readability
  holds. Not separately tested.
- **Deploy dependency:** production only reads the new columns once
  `feat/structured-messages` is merged and deployed. The DB toggle is already on
  for tenant `6ba4362f`, harmless to main (unknown columns ignored).

## Merge evidence

RED `40f94bc` → GREEN `5c1119a` on `feat/structured-messages`; no refactor
commit needed (implementation landed clean). If squashed, this file preserves
the RED/GREEN trail.
