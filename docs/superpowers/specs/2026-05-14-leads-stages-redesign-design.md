# Leads Stages Redesign — Smart Pipeline & Knowledge-Synced Suggestions

**Date:** 2026-05-14
**Status:** Design approved, plan pending

## Problem

Leads pile up in **New Lead** even when conversations have clearly progressed. Two root causes:

1. **Weak stage descriptions.** `_lib/defaults.ts` ships thin prose ("Initial outreach sent.", "Confirmed fit and interest."). The LLM reclassifier in `src/lib/chatbot/deep-reclassify.ts` is grounded *only* by stage `description`, so it has no concrete signal to match against.
2. **Hard confidence gate.** `coerceDecision` rejects anything below `confidence: 'high'` (`deep-reclassify.ts:313`). Combined with vague descriptions, the model rarely clears the bar — even when a lead is obviously progressing.

A third issue: even when stages have good descriptions, they drift out of sync with the user's knowledge base. If the user adds new pricing tiers, qualifying questions, or service offerings to their knowledge, the stages don't reflect that, and the classifier keeps using stale criteria.

We also discovered that `pipeline_stages` already has unused jsonb columns — `entry_signals`, `exit_signals`, `required_fields`, `next_best_action` — added in migration `20260521000000_pipeline_stage_semantics.sql` but never wired up anywhere (`grep` confirms zero references in `src/`). The previous author anticipated this exact need.

## Goals

- Replace the default stage set with a **9-stage, behavior-anchored pipeline** that includes Engaged, Interested, Objection (side-track), and Dormant.
- Wire `entry_signals` / `exit_signals` into the classifier so stage transitions are **gate-checked against observable conversation behavior**.
- **Loosen the confidence gate** in a structured way — adjacent forward moves accept `medium`, skip-ahead and terminal moves require `high`.
- Keep the **Objection** stage non-destructive: a lead in Objection has a `previous_stage_id` and pops back when the objection resolves.
- Add a **knowledge → stage suggestion pipeline**: when the user's knowledge base changes, propose stage description / signal updates to the user (never auto-apply).
- Make suggestions **visible**: sidebar badge, banner on the stages page, one-time-per-session toast.
- Give existing users a **safe opt-in upgrade path** with preview-diff and 30-day rollback. New users are seeded with the new defaults at signup.

## Non-Goals (v1)

- Bell-icon notification center in the topbar.
- Per-stage analytics view (avg dwell time, conversion).
- Email digest of pending suggestions.
- Multi-pipeline support (one pipeline per user remains the contract).
- Reverting individual *accepted* suggestions — user edits stage back manually.

---

## 1. The New Stage Set

Nine stages total. Seven appear in normal funnel order; **Objection** is a side-track stage; **Dormant** is a re-engagement bucket auto-populated by a daily sweeper.

Each stage ships with: `description` (human-readable), `entry_signals` jsonb array (the classifier checklist — ≥1 must be observed to enter), `exit_signals` jsonb array (when to leave), `required_fields` jsonb array (fields the lead must have populated before the stage applies; mostly empty for v1), and `kind` (existing taxonomy from `default-stage.ts`).

| Pos | Name | Kind | Description | Entry signals (≥1) | Exit signals |
|---|---|---|---|---|---|
| 1 | **New Lead** | entry | Captured from any source; no inbound message yet. | Lead row created; no inbound `message` exists yet. | Lead sends any inbound message. |
| 2 | **Engaged** | nurture | LEAD has started talking but hasn't shown buying intent yet. | LEAD has sent ≥1 inbound message; greeting, generic question, "what's this", or acknowledgment. | Asks a buying question (price/availability/process); requests a sample/demo; shares qualifying info. |
| 3 | **Interested** | nurture | LEAD is actively evaluating — buying questions, requests for samples, post-price follow-ups. | Asked price / stock / availability; asked about delivery, scheduling, location, or process *after* pricing/offer was shared; requested a sample / demo / menu. | Confirms budget/timing/decision-maker; submits qualification form; raises an objection; books. |
| 4 | **Qualified** | qualifying | Confirmed fit. Has explicitly said yes to budget/timing/decision-maker, or completed a qualifying form. | Completed qualification form with `qualified` outcome; explicitly confirmed budget + timing + decision-maker in chat; requested a proposal/quote. | Proposal/quote sent; booking made; objection raised; goes dark for >7 days. |
| 5 | **Objection** *(side-track)* | nurture | LEAD has raised a concern that's blocking progress, but hasn't rejected. | Raised any of: price too high / not now / need to think / has competitor / trust concern / waiting on someone. | Resolution: "ok let's proceed", asks a forward-moving question, schedules call, completes payment. OR hard reject. |
| 6 | **Proposal / Booked** | decision | Proposal/quote sent, booking confirmed, or order link created. | Proposal/quote sent; booking confirmed; cart created or order link sent. | Payment received → Won; explicitly declines → Lost; 14 days silence → Dormant. |
| 7 | **Won** | won (terminal) | Closed deal — payment confirmed or order checked out. | Payment confirmed; order checked out; deal explicitly closed-won. | — |
| 8 | **Lost** | lost (terminal) | Explicit no, hard reject, or disqualification outcome. | Explicit "no thanks / not interested / unsubscribe"; disqualification form outcome; hard reject after Objection. | — |
| 9 | **Dormant** | dormant | Active lead that has gone quiet for 14+ days. Auto-detected daily. | No inbound message for 14+ days in any non-terminal stage; was Engaged or further. | LEAD replies → returns to previous active stage. |

**Behaviors worth calling out:**

- **Objection is non-blocking.** Leads in Objection still count in pipeline metrics. `previous_stage_id` decides where they pop back to on resolution.
- **Dormant is sweeper-driven, not per-message-LLM-driven.** A daily cron passes through non-terminal leads with `last_inbound_at < now() - 14 days` and moves them to Dormant. Cheap; doesn't burn LLM tokens. When a Dormant lead replies, the regular classifier returns them to their prior active stage (using `previous_stage_id`).

---

## 2. Classifier Changes (`src/lib/chatbot/deep-reclassify.ts`)

Three focused changes inside the existing file. No new infrastructure.

### 2.1 Prompt rewrite — structured signal checklists per stage

Today's prompt formats each stage as `id=... name="..." kind=... desc="..."`. The new format includes the signal arrays as gates:

```
- id=<uuid> name="Interested" kind=nurture pos=3
  description: LEAD is actively evaluating ...
  enter_when (≥1 must be observed):
    • asked price / stock / availability
    • asked about delivery / scheduling / location / process AFTER pricing was shared
    • requested a sample / demo / menu
  leave_when:
    • confirmed budget + timing + decision-maker
    • submitted qualification form
    • raised an objection
    • booked
```

This is the largest behavior change — explicit gates instead of vague prose.

### 2.2 Tiered confidence policy

Replace the blanket `confidence !== 'high'` reject in `coerceDecision`. The model is asked to additionally return `move_type` so the gate is deterministic in code:

| Move type | Required confidence |
|---|---|
| Adjacent forward (e.g. Engaged → Interested) | `medium` or `high` |
| Skip-ahead (e.g. New → Qualified) | `high` only |
| Into terminal (Won / Lost) | `high` only |
| Into Objection (from any stage) | `medium` or `high` |
| Out of Objection (resolution → `previous_stage_id`) | `medium` or `high` |
| Backward (e.g. Qualified → Engaged) | `high` + reason must mention regression |

### 2.3 New output field — `matched_signals: string[]`

The LLM lists the specific signals it observed, verbatim short phrases (e.g. `"asked price"`, `"asked schedule after pricing shared"`). This powers a "Why here?" tooltip on lead cards (see §6) and gives us auditability if we later want to layer a deterministic decider on top.

Stored in the existing `lead_stage_events.reason` field for v1 (formatted as `"matched: <signal>, <signal> — <free reason>"`). A dedicated `matched_signals jsonb` column on `lead_stage_events` is **out of scope for v1** — easy to add later if needed.

### 2.4 `previous_stage_id` handling

A new nullable column `leads.previous_stage_id` is set whenever a lead enters Objection. When the classifier returns a "resolution" decision (exit signal from Objection observed), the move helper restores the lead to `previous_stage_id` instead of advancing forward.

Two execution sites need this logic:
- The bot-driven move path inside / after `deep-reclassify.ts` (wherever the stage update is committed).
- The manual move path used by Kanban drag-and-drop in `actions/stages.ts` (manual moves into Objection should also capture `previous_stage_id`).

To keep behavior consistent, the centralized move helper (likely a new `src/lib/leads/move-stage.ts`) wraps both paths.

### Not changing

- When `deep-reclassify` runs (still after each LLM exchange).
- The messaging-worker integration.
- The `lead_stage_events` audit trail itself.

---

## 3. Knowledge → Stage Suggestion Pipeline

### 3.1 Trigger

A worker hook fires when a `knowledge_embedding_jobs` row settles to a successful state. The hook upserts a `stage_suggestion_jobs` row with `run_at = now() + 60s`. Subsequent embedding completions within the debounce window push `run_at` forward. Effect: bulk-uploading 20 FAQs causes one suggestion pass, not twenty.

A separate worker (or a cron-pump tick — pattern to be confirmed against `src/lib/rag/queue.ts` during planning) picks up rows whose `run_at <= now()` and runs the suggester.

### 3.2 The suggester (`src/lib/leads/stage-suggester.ts` — new)

Per user, on each run:

1. Load current stages with `description`, `entry_signals`, `exit_signals`, `required_fields`.
2. Load a compact knowledge summary: titles + summaries of pinned items, top tags, recent FAQs, qualification criteria pulled from any `qualification` action page. **Not** every chunk — just enough for the LLM to spot misalignment.
3. Call the LLM with: *"Compare these stages to the knowledge. For any stage whose signals or description don't match what the business actually offers, propose targeted edits. Output JSON only."*
4. For each proposed change, insert a row in `pipeline_stage_suggestions` (§7). Mark any older `pending` suggestion for the same `(stage_id, field)` as `superseded`.

**Cost guardrail.** One suggester run per user per 5 minutes maximum, regardless of trigger volume. Enforced by checking `last_completed_at` on `stage_suggestion_jobs` before invoking the LLM.

### 3.3 Surfaces (from Q4a: i + ii + iii)

- **Sidebar badge.** The `Leads` nav item shows a small dot + count via a server query of `pending` suggestions for the user. Refreshes on route change.
- **Banner on `/dashboard/leads/stages`.** *"3 suggested improvements based on your knowledge."* Expands to per-stage diff cards with Accept / Reject / "Edit & accept" (loads the proposed value into the stage editor for hand-tweaking before saving).
- **Toast.** Once per session, on first dashboard load, when pending count > 0. Dismissible, links to the stages page.

### 3.4 Accept path

Writes `proposed_value` into the corresponding `pipeline_stages` column, sets `status='accepted'`, `resolved_at`, `resolved_by`. The suggestion row is the audit trail for the description change; no separate stage-history table.

### 3.5 Stale handling

A nightly job (piggybacking on the existing daily housekeeping cron, or a new tiny cron) marks suggestions `stale` if the user manually edited the relevant stage column after the suggestion was created. This avoids stomping on the user's manual work when they accept an old suggestion.

---

## 4. Migration / Opt-In Upgrade Flow

### 4.1 New users

`_lib/seed.ts` is updated to insert the new 9 stages with all jsonb columns populated from `_lib/defaults.ts`. First login already has the smart pipeline; no banner shown.

### 4.2 Existing users — detection

A helper `needsStageUpgrade(userId)` returns true when:
- the user has stages and *none* have `entry_signals` populated (signal that they're on the old schema), **and**
- they haven't dismissed (`users.dismissed_stage_upgrade_at` is null or older than 7 days) or accepted the upgrade.

### 4.3 Upgrade banner UI (`/dashboard/leads/stages`)

*"Upgrade to the smart pipeline — better movement, signal-based stages."* Includes **Preview changes** button. The preview modal shows four sections:

1. **Stages added** — new stages (Engaged, Objection, Dormant) with descriptions and signals.
2. **Stages renamed / enriched** — e.g. *Contacted → Interested*, with new description and signals diff'd against current.
3. **Stages kept as-is** — Won, Lost, Qualified (kept under same names; only signals added).
4. **Lead impact** — count: *"42 leads will stay in their current stage. 0 leads will move."*

Buttons: **Apply upgrade**, **Not now** (snooze 7d), **Customize first** (drops them into stage editor).

### 4.4 Apply-step remap rules (non-destructive)

For each existing stage on the user's pipeline:
- Match against canonical defaults by `kind` first, then by name (case-insensitive).
- Matched stages get `description` / `entry_signals` / `exit_signals` / `required_fields` updated **in place**; row `id` preserved → every `leads.stage_id` reference still resolves, no lead moves involuntarily.
- Canonical default stages with no match are inserted at their canonical position.
- User-renamed custom stages that don't map cleanly (e.g. a custom "Follow-Up" stage) are **kept untouched** — we don't delete or rename anything the user customized.

After apply, the suggester job is enqueued immediately so the user sees pending suggestions tuned to their knowledge.

### 4.5 Rollback

Before any in-place update, write a single row to `pipeline_stage_upgrade_snapshots`: `(user_id pk, snapshot jsonb, created_at)` containing the full pre-upgrade stage list. **Undo upgrade** button stays visible on the stages page for 30 days. After 30 days, daily housekeeping removes the snapshot.

### 4.6 No global migration script

All changes are per-user, dashboard-triggered. Supabase migrations only create new columns / tables.

---

## 5. Notification Surfaces (Q4a — locked: i + ii + iii)

- **i. Sidebar badge.** Dot + count on `Leads` nav item. Server query on each route change. Cleared when user views the stages page.
- **ii. Banner on stages page.** Full diff UI per suggestion. Always visible while `pending` count > 0.
- **iii. Toast.** One-time per session, on first dashboard load. Dismissible. Links to stages page.

**Not in v1:** topbar bell-icon notification center, email digest.

---

## 6. UI Touchpoints Summary

- `_components/StageManager.tsx` — extend stage editor with chip-style array editors for `entry_signals`, `exit_signals`, `required_fields`.
- `_components/LeadCard.tsx` — add a "Why here?" tooltip rendering `matched_signals` parsed from the latest `lead_stage_events.reason`.
- `_components/KanbanBoard.tsx` — surface Objection as a visually distinct column (side-track styling).
- `stages/_components/UpgradeBanner.tsx` *(new)* — opt-in upgrade UI.
- `stages/_components/StageSuggestionsPanel.tsx` *(new)* — pending-suggestion review UI.
- Sidebar nav — pending-suggestion dot badge on `Leads`.

---

## 7. Schema Changes — Supabase Migrations

All additive. Safe to run anytime.

### `20260514100000_pipeline_stage_suggestions.sql`
```sql
create table public.pipeline_stage_suggestions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  stage_id        uuid not null references public.pipeline_stages(id) on delete cascade,
  field           text not null check (field in ('description','entry_signals','exit_signals','required_fields')),
  current_value   jsonb not null,
  proposed_value  jsonb not null,
  reason          text,
  source_refs     jsonb not null default '[]'::jsonb,
  status          text not null default 'pending'
                    check (status in ('pending','accepted','rejected','superseded','stale')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users(id)
);

create index pipeline_stage_suggestions_user_pending_idx
  on public.pipeline_stage_suggestions (user_id) where status = 'pending';
-- RLS: user reads/writes own rows; service role bypasses.

create table public.stage_suggestion_jobs (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  run_at            timestamptz not null,
  last_completed_at timestamptz,
  status            text not null default 'queued'
                      check (status in ('queued','running','idle'))
);
```

### `20260514100100_leads_previous_stage_id.sql`
```sql
alter table public.leads
  add column if not exists previous_stage_id uuid null
    references public.pipeline_stages(id) on delete set null;
```

### `20260514100200_pipeline_stage_upgrade_snapshots.sql`
```sql
create table public.pipeline_stage_upgrade_snapshots (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  snapshot   jsonb not null,
  created_at timestamptz not null default now()
);
-- RLS scoped to user_id.
```

### `20260514100300_users_dismissed_stage_upgrade.sql`
```sql
-- Confirm target table during planning (users / profiles / user_settings).
alter table public.<users_table>
  add column if not exists dismissed_stage_upgrade_at timestamptz null;
```

---

## 8. File Plan

| Area | Path | Change |
|---|---|---|
| Defaults | `src/app/(app)/dashboard/leads/_lib/defaults.ts` | Rewrite — 9 stages with `entry_signals`, `exit_signals`, `description`, `required_fields` |
| Seed | `src/app/(app)/dashboard/leads/_lib/seed.ts` | Populate new jsonb columns from defaults |
| Classifier | `src/lib/chatbot/deep-reclassify.ts` | Prompt rebuild w/ signal checklists; tiered confidence; `matched_signals` output; objection-resolution path |
| Move helper | `src/lib/leads/move-stage.ts` *(new)* | Centralized stage-move logic; sets/restores `previous_stage_id` for Objection |
| Suggester | `src/lib/leads/stage-suggester.ts` *(new)* | Runs the diff-against-knowledge pass; writes `pipeline_stage_suggestions` rows |
| Suggester trigger | `src/lib/rag/queue.ts` (or adjacent) | Enqueue debounced suggestion run on embedding-job success |
| Dormant cron | `src/lib/leads/dormant-sweeper.ts` *(new)* + Vercel cron entry in `vercel.ts` or existing cron route | Daily pass: move stale active leads → Dormant |
| Upgrade lib | `src/lib/leads/upgrade.ts` *(new)* | `needsStageUpgrade`, `previewUpgrade`, `applyUpgrade`, `undoUpgrade` |
| Upgrade banner | `src/app/(app)/dashboard/leads/stages/_components/UpgradeBanner.tsx` *(new)* + diff modal | UI for §4 |
| Suggestion UI | `src/app/(app)/dashboard/leads/stages/_components/StageSuggestionsPanel.tsx` *(new)* | Banner + diff cards on stages page |
| Sidebar badge | Sidebar nav component (location TBD in planning) | Pending-suggestion count badge on `Leads` item |
| Session toast | Dashboard layout client mount or small component | One-time-per-session toast when pending > 0 |
| Stage editor | `_components/StageManager.tsx` | Chip-style array editors for signals/required-fields |
| Lead card | `_components/LeadCard.tsx` | "Why here?" tooltip from `matched_signals` |
| Kanban | `_components/KanbanBoard.tsx` | Objection column gets side-track styling |

---

## 9. Testing Strategy

**Unit:**
- `defaults.test.ts` — snapshot of canonical stage set (catches accidental drift).
- `deep-reclassify.test.ts` — table-driven cases with mocked LLM responses:
  - Explicit price ask in English and Tagalog → Engaged → Interested.
  - Forward-moving question after objection → Objection exit, restore `previous_stage_id`.
  - Hard reject after Objection → Lost.
  - Idle conversation → no move.
  - LLM returns `medium` confidence for adjacent forward → accepted.
  - LLM returns `medium` confidence for skip-ahead → rejected.
- `upgrade.test.ts` — remap logic against synthetic existing-user stage sets (custom names, renamed default, missing kinds).
- `stage-suggester.test.ts` — given fixture knowledge corpus + stages, asserts expected diff fields are proposed (mock LLM).
- `dormant-sweeper.test.ts` — leads inactive > 14d in non-terminal active stages move to Dormant; terminal leads stay.

**Integration (Vitest + Supabase test schema):**
- Apply upgrade end-to-end → stages enriched, snapshot written, `previous_stage_id` column present, `leads.stage_id` references unchanged.

**Manual QA checklist** (run at end of implementation):
- [ ] Legacy synthetic user sees the upgrade banner on stages page.
- [ ] Apply upgrade — preview-diff lead count matches actuals; stages enriched in place; suggester runs immediately.
- [ ] Undo upgrade restores pre-upgrade stages exactly.
- [ ] Edit a FAQ in knowledge base; within ~60s a pending suggestion appears.
- [ ] Send a synthetic conversation that asks for price in Tagalog; lead moves Engaged → Interested.
- [ ] Synthetic objection conversation → lead enters Objection; `previous_stage_id` set.
- [ ] Resolution message → lead returns to `previous_stage_id`, not forward.
- [ ] Sidebar badge appears when pending > 0; clears after viewing stages page (or session toast acknowledged).

---

## 10. Open Items for Implementation Plan

These are intentionally left for the writing-plans skill to resolve:

- Confirm the exact user-profile table for `dismissed_stage_upgrade_at`.
- Confirm the cron mechanism — existing routes or `vercel.ts` config — for the dormant sweeper and stale-suggestion housekeeping.
- Confirm where the embedding-job completion hook should attach inside `src/lib/rag/queue.ts` (or wherever).
- Pick the chip-array editor pattern that's consistent with existing UI (likely an existing primitive in `_components/`).
- Decide whether `move-stage.ts` should also be the centralized move target for existing manual moves (drag-and-drop, bulk actions) — incremental refactor opportunity.

---

## 11. Decisions Locked During Brainstorm

- **Stage set:** Option A — 9 stages with Objection as side-track.
- **Existing-user migration:** Option A — opt-in upgrade banner with preview-diff; 30-day snapshot rollback.
- **Classifier evaluation:** Option A — pure LLM with structured signal checklists; tiered confidence policy.
- **Knowledge → stage sync:** Option A — suggestion queue (`pipeline_stage_suggestions`), debounced on embedding-job completion.
- **Notification surfaces:** sidebar badge + stages-page banner + once-per-session toast. (No bell-icon in v1.)
- **Objection mechanics:** Option A — `leads.previous_stage_id` set on entry, restored on resolution.
