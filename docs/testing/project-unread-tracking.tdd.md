# TDD Evidence: Per-Project Unread / Missed Message Tracking

**Source plan:** inline `/ecc:plan` output (this session), confirmed by user.
**Date:** 2026-06-19 → 2026-06-20

## User journeys

1. As an operator, I want each project/lead card to show how many unread messages a client has sent, so I can see who's waiting without opening Facebook.
2. As an operator, I want a running "messages we missed" tally that survives a passive glance, so I can see who I never actually attended to.
3. As an operator, opening a conversation clears its unread badge; only an explicit "Mark as read" (or creating the project) clears the missed tally.
4. As an operator, I want a global nav counter summing unread across all my projects.

## What changed (by task)

| Task | Summary | Validation | Result |
|---|---|---|---|
| Helpers | `normalizeThreadCounts`, `formatBadgeCount`, `sumUnread` | `vitest run src/lib/messenger/unread.test.ts` | RED (module missing) → GREEN 12/12 |
| Migration | `missed_count`, `last_read_at`; `increment_thread_counters`, `count_project_unread` RPCs | `information_schema` + `pg_proc` checks via MCP | columns + funcs present |
| Webhook | `bumpThreadOnInbound` replaces dead `unread_count` no-op (route.ts:472); increments both counters once per inbound | `vitest run src/lib/messenger/inbound-counters.test.ts` | RED → GREEN 5/5 |
| Resets | `resetThreadCountersByLead` + `buildCounterResetPatch`; wired into loadConversation (unread only), markThreadRead (both), createProject (both) | `vitest run src/lib/messenger/reset-counters.test.ts` | RED → GREEN 5/5 |
| Query plumbing | counts surfaced in project / lead / submission queries | `vitest run .../project-info-query.test.ts` | RED 3/6 → GREEN 6/6 |
| UI | `UnreadBadge`, badges on project & lead cards + submissions, conversation Mark-as-read, sidebar nav counter | `tsc --noEmit`, `eslint` | clean (0 errors) |
| Review fixes | `REVOKE … FROM PUBLIC` on both RPCs (anon inherited EXECUTE); explicit owner scope in `count_project_unread`; `revalidatePath` after passive-view reset | `tsc`, `vitest run src/lib/messenger` | GREEN 384 |

## Test specification

| # | Guarantee | Test | Type | Result |
|---|---|---|---|---|
| 1 | Thread-count join (object/array/null) normalizes to non-negative pair | `unread.test.ts` | unit | PASS |
| 2 | Badge hides at 0, caps at `${max}+`, floors fractions | `unread.test.ts` | unit | PASS |
| 3 | Inbound bump calls RPC once with computed preview; failure is best-effort (warns, no throw) | `inbound-counters.test.ts` | unit | PASS |
| 4 | Passive view clears unread only; mark-read/project-create clear both | `reset-counters.test.ts` | unit | PASS |
| 5 | Submission info surfaces unread/missed, defaulting to 0 on missing joins | `project-info-query.test.ts` | unit | PASS |

## Coverage / known gaps

- New pure logic (`src/lib/messenger/unread.ts`, `inbound-counters.ts`, `reset-counters.ts`) is unit-tested at the function level.
- Not unit-tested (integration surfaces, verified via tsc + lint + manual reasoning): the webhook route wiring, the three server-action reset call sites, and React components. The repo has no harness for the large `facebook/route.ts` handler; the bump logic was extracted specifically to make it testable.
- **TOCTOU (accepted):** counts shown in the conversation header are read before the open-clears-unread update; a concurrent `markThreadRead` could briefly show stale values. Low impact for single-operator orgs; documented, not fixed.
- **Multi-project-per-lead (accepted simplification):** counters live on the lead's thread, so multiple projects for one lead share the count.
- `vitest` was scoped to `src/` per the fleet-worktree caveat; the pre-existing CAPI test failure on main is unrelated.
