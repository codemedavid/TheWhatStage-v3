# TDD Evidence — Leads Contacts Export (phones + project status)

## Source plan
No `*.plan.md`. Journeys derived during this TDD run from the request:
"export everything on the contacts including their phone number and their project status."

## User journeys
- As a sales user on the **Contacts** tab, I want to export a CSV that includes every
  phone number and email for each contact (not just the legacy single `phone`), so I can
  reach customers through any captured channel.
- As a sales user, I want each contact's **project status** (the stage of their most
  recent project) in the export, so I can see where each customer's deal stands.
- Board/Table exports are unchanged (decision: contacts-only export).

## Decisions
- **Project status** = stage name of the lead's **most recent project** (by `created_at`).
  Blank when the lead has no project.
- **Scope** = dedicated **contacts-only** CSV; Board/Table keep `exportLeadsCsv`.

## Task report

| Task | Summary | Validation command | Result |
|------|---------|---------------------|--------|
| Pure CSV serialiser | New `contactsToCsv` emits all phones/emails, latest contact value, lead stage, project status, custom fields | `npx vitest run src/app/(app)/dashboard/leads/_lib/contacts-csv.test.ts` | RED (module missing) → GREEN 7/7 |
| Data layer | `fetchContactsForExport` (unpaginated) + `fetchLatestProjectStatusByLead` (single batched query, no N+1); extracted shared `applyContactFilter` / `attachLatestContactValues` | `npx tsc --noEmit` (0 errors); full leads suite | 66 files / 347 tests PASS |
| Wiring | `exportContactsCsv` server action; `ExportMenu` view-aware (Contacts → contacts CSV, filename `contacts-<scope>-<date>.csv`) | `npx tsc --noEmit` | 0 errors |
| PGRST201 fix | `projects` has 2 FKs to `project_stages`; used `STAGE_EMBED` to disambiguate the stage embed | `npx tsc --noEmit`; contacts-csv suite | 0 errors / 7 PASS |

### RED evidence
```
Error: Failed to resolve import "./contacts-csv" from
"src/app/(app)/dashboard/leads/_lib/contacts-csv.test.ts". Does the file exist?
Test Files  1 failed (1) | Tests  no tests
```

### GREEN evidence
```
Test Files  1 passed (1)
Tests  7 passed (7)
```
Full leads suite after refactor: `Test Files 66 passed (66) | Tests 347 passed (347)`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Header row includes phones/latest_phone/project_status/lead_stage + custom field keys | `contacts-csv.test.ts:writes a header row…` | unit | PASS |
| 2 | Every number in `phones[]` is exported (`; ` joined) | `…joins every phone number…` | unit | PASS |
| 3 | Falls back to legacy `phone` when `phones[]` empty | `…falls back to the legacy phone field…` | unit | PASS |
| 4 | Most recent project status is exported | `…includes the most recent project status` | unit | PASS |
| 5 | Empty cell when contact has no project | `…emits an empty cell when…no project` | unit | PASS |
| 6 | Lead pipeline stage resolved from `stage_id` | `…resolves the lead pipeline stage name…` | unit | PASS |
| 7 | CSV escaping (commas/quotes/newlines) | `…escapes commas, quotes, and newlines` | unit | PASS |

## Coverage and known gaps
- The pure serialiser (`contactsToCsv`) — the core logic — is fully unit-tested.
- The server action `exportContactsCsv` and the DB fetch helpers are integration glue over
  Supabase auth + PostgREST; verified via `tsc` and the PGRST201 embed correction rather than
  a live-DB integration test. A follow-up E2E (download the CSV from the Contacts tab) would
  close this gap.
- "Most recent project" uses `created_at` desc. If the product later wants "most recently
  updated", switch the order column in `fetchLatestProjectStatusByLead`.
