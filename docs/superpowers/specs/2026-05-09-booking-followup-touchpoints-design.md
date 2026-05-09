# Booking Follow-up Touchpoints — Design

**Date:** 2026-05-09
**Status:** Draft, pending review
**Owner:** sircjdigiworks@gmail.com

## Goal

Let users configure up to **7 Meta utility-template follow-up touchpoints** on a booking action page (and on realestate pages, since they also produce bookings). Each touchpoint fires at a configurable offset relative to the booking event (e.g. `-1d`, `-10m`, `+0`, `+1d`) and sends a chosen Meta utility template with per-slot variable mapping.

The booking-page editor exposes a friendly row-based UI; under the hood, it generates and maintains a real Workflow that the user can also open and edit in the workflow editor.

## Non-goals (explicit)

- **Reschedule support.** Reschedules are treated as cancel + new booking by the user (5a-iii).
- **User-visible failure notifications.** Skipped sends are logged to `workflow_run_events` only (5b-i). A dashboard surface is Phase 2.
- **Inline template creation** from the booking-page UI. Users go to `/dashboard/templates` to create/submit templates (Q4: option A).
- **Pre-seeded "booking reminder" templates.** Users pick from their own approved templates only.
- **Per-page "two follow-up sequences run together" semantics.** Property follow-ups *replace* booking-page follow-ups when the property has enabled touchpoints. We do not double-message.

## What already exists (and we reuse)

- **`booking_offset` workflow trigger** with 8 hardcoded offsets in `src/lib/workflow/dispatcher.ts` (`OFFSET_MS`). `dispatchBookingOffsets` schedules one waiting `workflow_runs` row per matching workflow per offset, dedup-keyed `wf:{wfId}:bk:{bookingEventId}:{offset}`.
- **Meta utility template registry** (`messenger_message_templates`), approval flow, and `sendMessengerUtilityTemplate` (`src/lib/facebook/messenger.ts`).
- **`renderTemplateVariables`** (`src/lib/messenger-templates/render.ts`) — used by Agent Campaigns shared-template mode.
- **`OutboundPayload.kind: 'utility_template'`** is wired in `src/lib/messenger/outbound.ts`. Approved templates carry their own permission outside the 24h Messenger window.
- **`effectivePage` resolution** in `src/app/api/action-pages/submit/route.ts` (per the 2026-05-09 effective-trigger plan): property-sourced submissions use the property page as the workflow trigger surface.

## Architecture

### Single auto-managed workflow per page

Each booking or realestate page that uses follow-ups owns **one** workflow:

- `workflows.managed_kind = 'booking_followups'`
- `workflows.managed_source_id = action_pages.id`
- `workflows.manually_edited = false` initially

**Graph shape** for N enabled touchpoints (max 7):

```
start (passthrough)
├── if(state.variables.offset === '<offset_1>') → send_utility_template_1 → stop
├── if(state.variables.offset === '<offset_2>') → send_utility_template_2 → stop
└── ... (one branch per touchpoint)
```

The workflow has **N `booking_offset` triggers**, each with config `{ offset, action_page_id }`. The dispatcher fires N independent waiting runs per booking; each run takes one branch based on `state.variables.offset`.

**Why one workflow with N branches:** dedup keys stay clean (`wf:{wfId}:bk:{bookingEventId}:{offset}`), one row in the workflows list per page, one editor view. Each run is independent so failure of one offset doesn't poison another.

### User edits in the workflow editor

If a user opens the auto-managed workflow in `/dashboard/workflows/[id]` and saves changes, we set `manually_edited = true`. The booking-page UI then shows a "Managed externally" banner with two options:

- **Open in workflow editor** (link)
- **Reset & take over** (sets `manually_edited = false`, regenerates from booking-page config on next save)

This prevents silent clobbering and keeps both UIs trustworthy.

### Free-form offsets

Replace the hardcoded `OFFSET_MS` table with a parser:

```ts
// src/lib/workflow/offsets.ts
export function parseOffset(s: string): number | null
// Accepts: [+-]?\d+[mhd]  e.g. '-30m', '+1h', '0', '-3d'
// Returns: milliseconds delta (negative=before event, positive=after)
// Clamps to [-30d, +30d]; returns null on invalid input.
```

`dispatchBookingOffsets` reads each candidate workflow's `triggers`, takes the **distinct set of `offset` strings present in that workflow's `booking_offset` triggers**, and creates one waiting run per offset. No more iterating a fixed table.

### Send node: new `utility_template` payload

Extend `SendNodeConfig.payload` in `src/lib/workflow/types.ts`:

```ts
payload:
  | { kind: 'text'; text: string }
  | { kind: 'button'; text: string; url: string; ctaLabel: string }
  | {
      kind: 'utility_template'
      template_id: string
      variables: Record<string,
        | { kind: 'static'; value: string }
        | { kind: 'lead_field'; field: string }
      >
      button_url_override?: string | null
      button_index?: number | null
    }
```

`executor.ts` send handler gets one new branch:

1. Load template by `template_id`.
2. **Approval guard (5b-i):** if `meta_status !== 'approved'`, append `workflow_run_events` row `{ kind: 'send_skipped', reason: 'template_not_approved', template_id, meta_status }`, emit edge `policy_blocked`, terminate run.
3. Resolve booking + property data from `state.variables` (`booking_event_id`, optional `source_property_action_page_id`).
4. Render variables via extended `renderTemplateVariables` (see below).
5. Call `sendOutbound({ kind: 'utility_template', templateName, language, bodyParameters, buttonUrlOverrides })`.
6. On render failure (missing required `lead_field`): log `{ kind: 'send_skipped', reason: 'render_failed' }`, emit `policy_blocked`.

### Variable field tokens

Extend `renderTemplateVariables` to resolve, in addition to existing `name` and `custom_fields.*`:

- `booking.event_at` — ISO timestamp of the booking event
- `booking.event_at_relative` — humanized: "in 24 hours", "in 10 minutes", "now", "1 day ago"
- `booking.title` — booking event title (page title fallback)
- `property.title`, `property.address`, `property.price`, `property.deeplink_url` — present only when `state.variables.source_property_action_page_id` is set; otherwise empty string + log warning.

A new helper `loadFollowupContext(admin, runState)` performs the lookups in a single batch (booking_events row + optional property action_page row) so render is sync after one DB roundtrip.

### Trigger filter: action_page_id

The `booking_offset` trigger today only filters by `offset`. We extend `matchFn` in `dispatchBookingOffsets`:

```ts
matchFn: (trigger) => {
  const cfg = trigger.config as { offset?: string; action_page_id?: string }
  if (cfg.offset && cfg.offset !== offset) return false
  if (cfg.action_page_id && cfg.action_page_id !== payload.actionPageId) return false
  return true
}
```

Auto-managed workflows always set `action_page_id`. Hand-built workflows can omit it (matches all bookings), preserving back-compat.

### Property fallback resolution

In `src/app/api/action-pages/submit/route.ts`, immediately before the existing `dispatchBookingOffsets` call (when the submission produces a booking event), insert:

```ts
const followupPageId = await resolveFollowupPageId(admin, {
  effectivePageId: effectivePage.id,
  submittedPageId: page.id,
})
// dispatch using followupPageId instead of effectivePage.id (booking case only)
```

`resolveFollowupPageId` (new helper in `src/lib/workflow/booking-followups.ts`):

1. Look up active `booking_followups` workflows (`status='active'`) for both page ids.
2. For each, count enabled `booking_offset` triggers (i.e. triggers with valid `offset` config).
3. If `effectivePage` has ≥1 enabled touchpoint → return `effectivePageId`.
4. Else if `submittedPage` has ≥1 enabled touchpoint → return `submittedPageId`.
5. Else → return `effectivePageId` (no-op; nothing matches; safe).

This means: **a property's follow-up sequence overrides a booking-page sequence; if the property has no enabled touchpoints, the booking page's sequence fires.** Never both.

`dispatchSubmissionReceived` continues to use `effectivePage.id` for general submission triggers (unchanged from the 2026-05-09 plan). Only `dispatchBookingOffsets` uses the resolved follow-up page id.

### Cancel hook

New helper `cancelBookingFollowups(admin, bookingEventId)`:

```ts
// Update workflow_runs
//   set status='cancelled', next_run_at=null, cancel_reason='booking_cancelled'
//   where status='waiting' and dedup_key like 'wf:%:bk:{bookingEventId}:%'
```

Wired into the booking cancel path (action-pages submit handler when `outcome='cancelled'`, and any future authenticated dashboard cancel endpoint). Reschedule is out of scope.

## Data model

**Migration `20260520000000_booking_followups.sql`:**

```sql
alter table workflows
  add column managed_kind text check (managed_kind in ('booking_followups')),
  add column managed_source_id uuid,
  add column manually_edited boolean not null default false;

create unique index workflows_managed_unique
  on workflows(managed_source_id) where managed_kind = 'booking_followups';
```

No new tables. Touchpoint config lives inside the workflow's `triggers` + `nodes` arrays (single source of truth, naturally edited via either UI).

`KIND_REGISTRY` (`src/lib/action-pages/kinds.ts`) gains:

```ts
supportsFollowups?: boolean   // booking: true, realestate: true
```

## UI

### Booking & realestate editor section

New shared component **`<FollowupTouchpointsEditor pageId pageKind />`** mounted in:

- `src/app/(app)/dashboard/action-pages/_kinds/booking/Editor.tsx`
- `src/app/(app)/dashboard/action-pages/_kinds/realestate/Editor.tsx`

Layout: list of up to 7 touchpoint rows + "Add touchpoint" button.

Each row:

```
[ ⋮⋮ drag ] [ Offset: -1d ▾ ] [ Template: "Booking in 24h" ▾ ]   [ Enabled ☑ ] [ ✕ ]
            └─ {{1}} = [Field ▾] lead.name
            └─ {{2}} = [Field ▾] booking.event_at_relative
            └─ Button URL: ( ) Default (booking page)  ( ) Override: [____]
            └─ Preview: "Hi Sarah, your booking is in 24 hours."
```

**Offset picker:** dropdown of common presets + "Custom..." (number + unit + before/after). Resolved offset shown in helper text.

**Template picker:** lists user's `messenger_message_templates` rows where `meta_status='approved'`. Empty state: "No approved templates yet — [Create one →](/dashboard/templates)".

**Variable editor:** mirrors AgentClient's. For each `{{N}}` slot the template declares: toggle Static/Field, value input or field dropdown. Field dropdown:

- `lead.name`, `lead.custom_fields.<key>`
- `booking.event_at`, `booking.event_at_relative`, `booking.title`
- `property.title`, `property.address`, `property.price`, `property.deeplink_url` (shown only on realestate or when booking page has property attachments)

**Live preview** under each row, rendered with sample lead + sample booking time (uses the same `renderTemplateVariables` to guarantee parity).

### Save flow

Server action `saveFollowups(pageId, touchpoints[])`:

1. Validate: ≤7 rows, each has `offset` (parsed valid), `template_id` (exists and `meta_status='approved'` at save time — picker only shows approved; the executor's fire-time guard exists to catch templates that get *rejected/disabled later*), variable map covers all `{{N}}` slots the template declares.
2. Read existing managed workflow.
3. If exists and `manually_edited=true`: refuse. UI shows banner.
4. Else: regenerate `triggers`, `nodes`, `edges`, bump `version`, upsert. Existing waiting runs remain on their old `workflow_version` (engine handles this).

Manually-edited workflows can be reset via "Reset & take over" → flips `manually_edited=false`, regenerates from saved config.

## Phasing

| Phase | Scope |
|---|---|
| 1 — Engine | `parseOffset`, `utility_template` send payload + executor + approval guard, `action_page_id` filter on `booking_offset` trigger, `loadFollowupContext`, `cancelBookingFollowups` helper. No UI yet — testable from workflow editor. |
| 2 — Generator + UI | `booking-followups.ts` workflow generator (build/regenerate), `<FollowupTouchpointsEditor>` mounted on booking-page editor only. Saves round-trip safely. |
| 3 — Cancel + manual-edit guard | Wire `cancelBookingFollowups` into booking cancel flow. Add `manually_edited` enforcement, banner, "Reset & take over". |
| 4 — Property integration | `<FollowupTouchpointsEditor>` mounted on realestate editor, `resolveFollowupPageId`, `property.*` variable fields, integration tests for property-sourced fallback. |

## Test plan

| Layer | What | File |
|---|---|---|
| Pure | `parseOffset` round-trip, clamp, invalid input | `src/lib/workflow/offsets.test.ts` |
| Pure | `renderTemplateVariables` with `booking.*` + `property.*` fields | `src/lib/messenger-templates/render.test.ts` (extend) |
| Unit | `cancelBookingFollowups` filters dedup keys, only cancels `waiting` | `src/lib/workflow/dispatcher.test.ts` |
| Unit | Auto-managed workflow generator: 7 touchpoints → expected triggers/nodes/edges, idempotent regeneration | `src/lib/workflow/booking-followups.test.ts` |
| Unit | Executor `utility_template`: approved sends, non-approved skips with `policy_blocked`, render-failure path | `src/lib/workflow/executor.test.ts` (extend) |
| Unit | `resolveFollowupPageId`: property wins when enabled, falls back to booking page, no-op when neither | `src/lib/workflow/booking-followups.test.ts` |
| Integration | Submit booking → N runs created with correct `next_run_at` per offset | `src/app/api/action-pages/submit/route.test.ts` (extend) |
| Integration | Cancel booking → all pending follow-up runs cancelled | `src/app/api/action-pages/submit/route.test.ts` (extend) |
| Integration | Property-sourced booking with property follow-ups → property workflow fires, booking-page workflow does not | `src/app/api/action-pages/submit/route.test.ts` (extend) |
| Integration | Property-sourced booking, property has 0 enabled touchpoints, booking page has 3 → booking page's fire | same |

## Open questions / risks

- **Workflow `version` semantics with regeneration.** Each save bumps `version`; old waiting runs keep their version. Confirm `executor.ts` resolves the right graph by version (it should — that's the existing model).
- **Realestate booking surface.** Realestate pages don't have a uniform "booking" submodule today. We assume the existing `viewing_booked` outcome already produces a `booking_events` row; if not, Phase 4 needs a small extension to make that explicit. Verify in `src/app/api/action-pages/submit/route.ts` before starting Phase 4.
- **Time-zone of `event_at_relative`.** Render uses the user's timezone (from `users.timezone`?) or UTC? Default to user timezone with UTC fallback; document in `renderTemplateVariables`.
