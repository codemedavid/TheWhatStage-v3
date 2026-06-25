# Inbox — "Needs Reply" unified lead hub (TDD evidence)

**Branch:** `perf/classify-salvage-reply` (feature added on top)
**Date:** 2026-06-26

## What shipped

A single dashboard surface (`/dashboard/inbox`) so the operator never has to dig
into a project or scroll an action page to see who is waiting. Four filter tabs,
every row deep-linking to the lead's existing conversation drawer
(`/dashboard/leads?lead={id}`):

| Tab | Source | Filter / order |
|---|---|---|
| **Needs reply** (default) | `messenger_threads` | `unread_count > 0 OR missed_count > 0`, `last_message_at desc` |
| **Important** | `messenger_threads` | `is_important = true` (manual pin), `last_message_at desc` |
| **Submissions** | `action_page_submissions` | all pages, `created_at desc` — includes leads with no chat yet |
| **Projects** | `projects` | active (non-archived), `updated_at desc` |

Plus a sidebar **"Inbox"** item with a live red badge = distinct conversations
waiting on a reply, and a manual **star pin** + one-click **mark-read** per row.

## Reuse (no reinvention)

- Counters read from `messenger_threads` (`unread_count`/`missed_count`/
  `last_message_at`/`last_message_preview`) — never recomputed.
- `UnreadBadge`, `normalizeThreadCounts`/`formatBadgeCount` (`lib/messenger/unread.ts`).
- Conversation view reached via the existing `/dashboard/leads?lead=` deep link
  (opening clears unread + revalidates) — no second viewer.
- Mark-read reuses `resetThreadCountersByLead` (`lib/messenger/reset-counters.ts`).
- Nav badge rides the `count_project_unread` → prop pattern in `layout.tsx`.

## Schema change

Migration `20260625201850_thread_is_important.sql` (applied to remote via MCP,
filename reconciled to the stamped version per the MCP-timestamp gotcha):

```sql
alter table public.messenger_threads
  add column if not exists is_important boolean not null default false;
create index if not exists messenger_threads_user_important_idx
  on public.messenger_threads (user_id, last_message_at desc) where is_important;
```

Idempotent + additive; existing RLS (`user_id = auth.uid()`) covers the new column.

## RED → GREEN

Pure view-model helpers (`_lib/rows.ts`) were unit-tested first
(`_lib/rows.test.ts`, 25 cases) covering: tab coercion of malformed `?tab=`,
project-chip selection (archived skipped, newest non-archived wins, object/array
join shapes), submission summarization + truncation, unread-over-missed badge
precedence, and all three row mappers (lead-name fallback to FB name to
"Unknown", negative-count clamping, pin reflection, threadless submissions).

## Verification

```
npx tsc --noEmit                                  # 0 src errors (2 pre-existing .next/ validator artifacts unrelated)
npx vitest run src/app/(app)/dashboard/inbox \
              src/lib/messenger                    # 424 passed (37 files)
npm run build                                      # ✓ Compiled; ƒ /dashboard/inbox
```

## Adversarial review (17 agents, each finding verified)

Multi-dimension review (correctness / tenancy / RSC-boundary / reuse). RSC
boundaries, tenancy scoping, and Zod validation all passed clean. Three findings
fixed in this change:
1. `markInboxThreadRead` now passes `userId` to `resetThreadCountersByLead`
   (defense-in-depth, matching `toggleThreadImportant`) — the shared helper gained
   an optional `userId` param + an explicit `.eq('user_id', userId)`.
2. Partial index corrected to `desc nulls last` to fully serve the ordered query
   (file + live remote index both updated).
3. Fixed a stale error-message label in `reset-counters.ts`.

Deferred (pre-existing codebase-wide DRY, out of scope for this feature PR):
extract shared `requireUser()` / `first<T>()` / relative-time helpers — these are
already duplicated across 5–15 existing files; consolidating is a separate refactor.

## Tenancy / security

- All reads use the **user's** RLS-scoped client **and** an explicit
  `.eq('user_id', userId)` (defense-in-depth on the cross-table joins).
- `toggleThreadImportant` / `markInboxThreadRead` validate input with Zod and
  scope the write by `lead_id` **and** `user_id`.

## Known limitations (v1, accepted)

- Not real-time — counts/list refresh on navigation + after server actions, like
  every existing badge. Realtime subscription is a deferred follow-up.
- Submissions tab shows event rows (newest-first), not one-row-per-lead.
- `.or(unread,missed)` is not index-sargable; bounded by `limit 50`. "Load more"
  / a cross-page `(user_id, created_at)` submissions index are follow-ups.
