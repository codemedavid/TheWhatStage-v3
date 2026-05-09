# Action page: property-as-effective-trigger + default stage moves

**Date:** 2026-05-09
**Status:** Approved (design)

## Problem

Two related issues with action page submissions and pipeline movement:

1. **Property submissions don't trigger property workflows.** When a customer books a viewing through a booking page that's linked from a property page (`config.linked_action_page_ids`), the submission fires `dispatchSubmissionReceived` with the *booking page's* id. Workflows the user configured on the *property* page never match. The same goes for the pipeline-rule stage move: it reads the booking page's `pipeline_rules`, not the property's. So a property configured to move to "Proposal" on `viewing_booked` does nothing.

2. **No default stage move when unconfigured.** A new action page has `pipeline_rules[].to_stage_id = null` until the user configures it explicitly. Until then, submissions never move the lead — even though the outcome (e.g., `checked_out`, `booked`, `viewing_booked`) has an obvious target stage. Users want sensible automatic moves out of the box, with the option to override.

## Goals

- A submission whose source is a property page fires workflows and pipeline moves *as if it had been submitted on the property page*.
- Every action page kind ships with sensible default stage moves keyed by outcome, applied automatically when the user hasn't set `to_stage_id`.
- Explicit user configuration always wins.

## Non-goals

- No UI for editing per-user defaults. Defaults are code-level.
- No data migration. Behavior is runtime only; existing rows untouched.
- No changes to booking-time-offset reminders (`-3d`, `-2h`, `-10m`) — they remain tied to the booking event, not page identity.
- No change to dispatcher logic (`src/lib/workflow/dispatcher.ts`); the fix is upstream in the submit handler.

## Design

### 1. Effective action page resolution

In `src/app/api/action-pages/submit/route.ts`, after we've validated `sourcePropertyActionPageId` (the existing `validatedSourceProperty` check, ~line 232–280), introduce:

```ts
type EffectivePage = {
  id: string
  user_id: string
  kind: ActionPageKind
  pipeline_rules: PipelineRule[]
}

async function resolveEffectivePage(
  admin,
  submittedPage,           // the page actually receiving the submission
  validatedSourceProperty, // already-validated property ref or null
): Promise<EffectivePage>
```

Logic:
- If `validatedSourceProperty` is non-null, fetch the property row's `id, user_id, kind, pipeline_rules` and return it.
- Else return `submittedPage`.

The fetch reuses the existing `validatedSourceProperty` ownership check (it already guarantees `user_id === page.user_id` and `kind === 'realestate'`); we just need its `pipeline_rules` which the original validation didn't select.

We use `effectivePage` for:
- `dispatchSubmissionReceived({ actionPageId: effectivePage.id, ... })` (currently passes `page.id`, ~line 396)
- Pipeline-rule lookup (currently `page.pipeline_rules.find(...)`, ~line 447)
- Default stage resolution (Section 2)

We continue to use `page` (the submitted page) for:
- The `action_page_submissions` insert (`action_page_id: page.id`) — submission still belongs to the page that rendered it. The property linkage stays in `meta.source_property_action_page_id` as today.
- Booking event capture and `dispatchBookingOffsets` — those are about the booking page's appointment config.
- `advanceLeadFunnelForActionPage({ actionPageId: page.id })` — funnels are wired to the submitted page.

### 2. Default stage moves

Extend `KindMeta.defaultPipelineRules[]` in `src/lib/action-pages/kinds.ts` with an optional `defaultStageKind`:

```ts
defaultPipelineRules: {
  outcome: string
  reason: string
  defaultStageKind?: PipelineStageKind  // 'entry'|'qualifying'|'nurture'|'decision'|'won'|'lost'|'dormant'
}[]
```

Mapping:

| Kind → outcome | `defaultStageKind` |
|---|---|
| form → submitted | qualifying |
| booking → booked | decision |
| qualification → qualified | qualifying |
| qualification → disqualified | lost |
| qualification → pending_review | — (omit; no default move) |
| sales → submitted | qualifying |
| sales → checked_out | won |
| catalog → checked_out | won |
| realestate → inquiry_submitted | qualifying |
| realestate → viewing_booked | decision |

New module `src/lib/action-pages/default-stage.ts`:

```ts
export type PipelineStageKind =
  | 'entry' | 'qualifying' | 'nurture' | 'decision' | 'won' | 'lost' | 'dormant'

export function getDefaultStageKind(
  pageKind: ActionPageKind,
  outcome: string,
): PipelineStageKind | null

export async function resolveDefaultStageId(
  admin,
  userId: string,
  kind: PipelineStageKind,
): Promise<string | null>
```

`resolveDefaultStageId` queries `pipeline_stages` where `user_id = $1 AND kind = $2`, ordered by `position` ascending, returns the first `id` or `null`.

### 3. Application order in `submit/route.ts`

Replace the current rule-only block (~line 446–465) with:

```ts
if (leadId) {
  const rule = effectivePage.pipeline_rules.find(r => r.outcome === parsed.outcome)
  let toStageId: string | null = rule?.to_stage_id ?? null

  if (!toStageId) {
    const kind = getDefaultStageKind(effectivePage.kind, parsed.outcome)
    if (kind) {
      toStageId = await resolveDefaultStageId(admin, effectivePage.user_id, kind)
    }
  }

  if (toStageId) {
    try {
      await applyStageMove({ adminClient: admin, userId: page.user_id, leadId, toStageId, outcome: parsed.outcome, submissionId: subInsert?.id ?? null, threadId: messengerThreadId })
    } catch (e) { /* warn, no throw */ }
  }
  // funnel advance unchanged — uses submitted page.id
}
```

Resolution order:
1. Explicit `rule.to_stage_id` on the effective page → use it.
2. Else `defaultStageKind` for `(effectivePage.kind, outcome)` → first matching stage.
3. Else no move (silent, same as today).

### 4. Workflow dispatch

Single one-line change:
```ts
dispatchSubmissionReceived(admin, {
  ...,
  actionPageId: effectivePage.id,  // was: page.id
})
```

This makes property-configured `submission_received` workflows match (per `dispatcher.ts:255`). Per the user-confirmed scope, the property page is the **only** trigger when a property source is present — booking-page workflows do not also fire. (Booking-time-offset triggers are unaffected and continue to fire independently.)

## Files changed

| File | Change |
|---|---|
| `src/lib/action-pages/kinds.ts` | Add optional `defaultStageKind` to `KindMeta.defaultPipelineRules[]`; populate per mapping table |
| `src/lib/action-pages/default-stage.ts` | New: `getDefaultStageKind`, `resolveDefaultStageId`, `PipelineStageKind` type |
| `src/app/api/action-pages/submit/route.ts` | New `resolveEffectivePage`; use `effectivePage` for dispatch + rule lookup + default fallback |

## Tests

Add to (or alongside) the submit route's existing tests:

1. **Property source — workflow trigger.** Submission to a booking page with `source_property_action_page_id` set → `dispatchSubmissionReceived` payload's `actionPageId` is the property's id.
2. **Property source — explicit rule.** Property page has `pipeline_rules: [{ outcome: 'viewing_booked', to_stage_id: STAGE_X }]` → lead moves to `STAGE_X`.
3. **Property source — default fallback.** Property page has no `to_stage_id` → lead moves to user's first `decision` stage.
4. **No property source.** Submission to a standalone booking page → uses booking page's pipeline rules; default = first `decision` stage.
5. **No matching default stage.** User has no stage of the default kind → no move, no error logged at error level.
6. **Disqualified outcome.** Qualification page, `disqualified` outcome → moves to first `lost` stage by default.

## Risk and rollback

- Pure runtime logic; no schema migration. Rollback = revert commit.
- Behavior change for *unconfigured* action pages: leads that previously stayed put will now move. Acceptable per user request; documented in commit message.
- Behavior change for property-linked bookings: workflows configured on the *booking page* (not the property) for property-sourced submissions will stop firing. This matches the user's stated intent (option A in brainstorming).
