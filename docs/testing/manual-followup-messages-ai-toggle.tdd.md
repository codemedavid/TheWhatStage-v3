# TDD Evidence — Manual Follow-Up Messages with AI Toggle

**Source plan:** Inline plan approved in session (no `.plan.md` file). Two product
decisions confirmed via AskUserQuestion:
- Existing users **default to Manual** (`ai_enabled` defaults to `false` for everyone).
- A blank manual message **falls back to the curated nudge pool** (never drops a touchpoint).

## User journeys

1. As an account owner, follow-up nudges send my own pre-written messages by
   default (no AI cost), so my bill drops.
2. As an account owner, a single toggle switches the engine to AI-generated
   messages when I want richer replies.
3. As an account owner, a blank manual message still sends a sensible nudge.

## What changed

| File | Change |
|---|---|
| `src/lib/followups/settings.ts` | Added top-level `ai_enabled` (default `false`) and per-touchpoint optional `message`; carried both into `SnapshotEntry` / `resolveEnabledOffsets`; populated default manual messages. No DB migration (JSONB). |
| `src/lib/followups/generateMessage.ts` | New `resolveManualMessage()` — `{name}` interpolation + sanitize, fallback pool when blank. No LLM call. |
| `src/lib/followups/fire.ts` | Branch on `entry.ai_enabled !== false`: manual path skips the LLM and the attachment-hint lookups; legacy snapshots (no `ai_enabled`) keep AI behavior. |
| `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx` + `chatbot.css` | Master "AI writes messages / Manual messages" toggle; per-row Message field always shown; AI guide shown only when AI is on. |

## RED → GREEN

- **RED:** `npx vitest run src/lib/followups/settings.test.ts src/lib/followups/generateMessage.test.ts src/lib/followups/fire.test.ts` → **15 failed / 977 passed**. Failures were the intended ones: `ai_enabled`/`message` undefined, `resolveManualMessage` not exported, manual branch absent.
- **GREEN (impl):** same command → all pass after implementing the four files.
- **GREEN (full suite):** `npx vitest run src/lib/followups src/app/api/chatbot/followup-settings` → **1547 passed (120 files)**.
- **Typecheck:** `npx tsc --noEmit` → clean (exit 0).
- **Lint:** changed files → 0 errors (1 pre-existing `<img>` warning, untouched line).

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | `ai_enabled` defaults to `false` when absent in stored settings | `settings.test.ts › defaults ai_enabled to false when missing` | unit | PASS |
| 2 | Schema accepts `ai_enabled: true` and rejects a manual message > 200 chars | `settings.test.ts › accepts ai_enabled set to true` / `rejects a manual message longer than 200 chars` | unit | PASS |
| 3 | Defaults ship AI off + a non-empty manual message per touchpoint | `settings.test.ts › DEFAULT_FOLLOWUP_SETTINGS — manual mode defaults` | unit | PASS |
| 4 | Snapshot carries `message` + `ai_enabled` for in-flight stability | `settings.test.ts › carries the manual message and ai_enabled... / stamps ai_enabled=true...` | unit | PASS |
| 5 | Manual message interpolates `{name}`, sanitizes, and never calls the LLM | `generateMessage.test.ts › resolveManualMessage` (5 cases) | unit | PASS |
| 6 | Blank / all-dash manual message falls back to the curated pool | `generateMessage.test.ts › falls back to the curated pool...` | unit | PASS |
| 7 | AI off ⇒ `resolveManualMessage` used, LLM **not** called, manual text sent | `fire.test.ts › uses resolveManualMessage and skips the LLM when ai_enabled is false` | unit | PASS |
| 8 | AI on ⇒ LLM called, manual resolver unused | `fire.test.ts › calls the LLM when ai_enabled is true` | unit | PASS |
| 9 | Legacy snapshot (no `ai_enabled`) preserves AI behavior | `fire.test.ts › preserves AI behavior for legacy snapshot entries...` | unit | PASS |
| 10 | Manual mode still sends configured attachments (text → image) | `fire.test.ts › still sends configured attachments in manual mode` | unit | PASS |
| 11 | PUT settings route accepts and persists the new fields via the schema | `src/app/api/chatbot/followup-settings/route.test.ts` (225 passed) | integration | PASS |

## Coverage & known gaps

- No coverage threshold command run this session; behavioral coverage of the new
  branch (manual vs AI vs legacy) and helper is complete across the table above.
- The `AutoFollowupForm` UI change has no component test (existing form has none);
  its logic is the pure `settingsToState`/`stateToSettings` mappers exercised
  indirectly via schema round-trips. A follow-up RTL test for the toggle could be
  added if the team wants UI coverage.
- No DB migration: both `followup_settings` and `offsets_snapshot` are JSONB; new
  fields flow through Zod (`ai_enabled` default, `message` optional) and the
  snapshot array, with defensive reads (`entry.ai_enabled !== false`,
  `?? ''`) for rows written before this change.
