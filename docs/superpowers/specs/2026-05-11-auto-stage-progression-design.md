# Auto Stage Progression — Design

**Date:** 2026-05-11
**Status:** Draft (pending user approval)

## Problem

The lead pipeline classifier already runs on every bot reply (`answerWithClassification` in `src/lib/chatbot/classify.ts`) and writes a `reason` via the `set_lead_stage` RPC, but operators are seeing three failure modes:

1. **Wrong calls.** The per-turn classifier jumps eagerly, occasionally moves leads backward on a single negative-sounding message, or misses obvious forward moves.
2. **No hierarchy reasoning.** The prompt lists stages as a flat set with description-only context; the model does not treat stage *names* as first-class signals and does not consistently respect that pipelines have a forward-by-default order.
3. **Reason notes invisible.** The `reason` is written to `lead_stage_events` but no UI surfaces it, so operators cannot audit why a lead moved.

## Goals

- The classifier reasons explicitly about stage **hierarchy** (position + kind) and **stage names**, not just descriptions.
- Backward moves require `high` confidence AND an explicit disqualifying signal cited in the reason.
- A periodic, deeper re-evaluation pass exists to audit and correct drift over the lifetime of a conversation, with full lead context.
- Operators see the AI's reasoning in two places: the kanban card (glanceable badge + tooltip) and a full per-lead timeline (audit trail).

## Non-Goals

- Replacing the existing per-turn classifier with a different model or rewriting `set_lead_stage` semantics.
- Changing how action-page submissions move stages — that path stays as is.
- Adding ML-based scoring or signal extraction beyond what the LLM already does.
- Tuning the deep re-eval cadence to be per-workspace configurable in this iteration (it ships at a fixed every-10).

---

## Architecture

Two layers, both writing through the existing `set_lead_stage` RPC so the audit trail (`lead_stage_events`) stays unified.

### Layer 1 — Per-turn classifier (improved, inline)

Stays inside `answerWithClassification` in `src/lib/chatbot/classify.ts`. The improvement is purely prompt-level:

- **Hierarchy block.** Stages are listed in `position` order, each row showing `[<position> · <kind>] <name>` followed by description. A HIERARCHY rules block precedes the list and explains:
  - *Forward moves* (later position, or terminal `won`/`lost` from any prior stage) are allowed when the customer's intent matches the destination stage.
  - *Backward moves* (earlier position) require `confidence: 'high'` AND the `reason` field must cite an explicit disqualifying signal — for example: customer cancelled, said "not interested", changed their mind, asked to be removed.
  - Stage **names** are first-class evidence. A customer message containing "cancel my booking" is direct evidence of leaving any stage named with "Booked" / "Booking" / "Decision".
- **Confidence floor unchanged.** `low` is still dropped server-side in `applyStageChange`. Same-stage and unknown-id rejections stay.

### Layer 2 — Deep re-evaluation (new, background, every 10 inbound messages)

New module: `src/lib/chatbot/deep-reclassify.ts`. Triggered fire-and-forget at the end of `src/app/api/messenger/process/route.ts`, after the bot reply has been sent to the customer.

Trigger condition: count inbound messenger messages on the thread; run only when `inboundCount % 10 === 0` and `inboundCount > 0`.

The deep call:

- Loads a rich context bundle (see Data Flow below).
- Uses the same model as `answerWithClassification` (not the small `classifierModel` used by `classifyOnly`) — the cost is amortized across 10 messages.
- Requires `confidence: 'high'` to apply a move. `medium`/`low` from the deep pass are dropped — the deep pass exists to deliberate, not to chase signals.
- Writes via `set_lead_stage` with `p_source: 'deep_classifier'` and idempotency key `deep:${threadId}:${leadId}:${windowIndex}` where `windowIndex = Math.floor(inboundCount / 10)`. This guarantees at most one deep move per 10-message window even on retries.

### Manual-move override semantics

The deep classifier is allowed to override a manually-set stage when its decision is `high` confidence AND the prompt instructs it to explicitly justify *why the manual stage no longer fits* in the `reason` field. We rely on:

- The prompt enforcing the justification requirement.
- `p_source: 'deep_classifier'` + reason being persisted on `lead_stage_events` so operators can audit.
- The kanban card badge styling overrides distinctly so operators notice when AI corrected a human placement.

We do *not* add a code-level cooldown or ban. This is option C from the brainstorming session: maximum AI autonomy, with full audit visibility as the safety mechanism.

---

## Data Flow

### Per-turn (Layer 1)

1. Customer message arrives → `messenger/process/route.ts` → `answerWithClassification`.
2. `stageInstruction()` renders the new HIERARCHY block + position-ordered stage list with `kind` annotation.
3. LLM returns `{ reply, stage_change: { to_stage_id, confidence, reason } | null, ... }`.
4. `applyStageChange` runs `set_lead_stage` with `p_source: 'classifier'`. Already wired today.

### Deep re-eval (Layer 2)

1. After the reply is dispatched at the end of `messenger/process/route.ts`, count inbound messages for the thread (`messenger_messages` rows where `direction='inbound'` and `thread_id = ?`). No new column is added; the count is computed.
2. If `inboundCount > 0 && inboundCount % 10 === 0`, fire `runDeepReclassify({ adminClient, leadId, threadId, userId, windowIndex })` without `await` (caught for log only).
3. `runDeepReclassify` loads the context bundle:
   - **Lead profile.** `leads` row: name, contact info (first values from contact arrays), `score`, `entered_stage_at` (used to compute dwell hours in current stage).
   - **Conversation history.** Pull the recent message window. If above ~50 messages, fall back to a stored conversation summary (the existing `conversationSummary` plumbing) plus the last ~30 messages verbatim.
   - **Stage event history.** Last 10 `lead_stage_events` rows for the lead, oldest first, with `from_stage_id`, `to_stage_id`, `source`, `confidence`, `reason`, `created_at`.
   - **Action-page submissions.** Recent rows from `action_page_submissions` for this lead — outcome, page title, page kind, submitted_at.
   - **Pipeline stages.** All `pipeline_stages` for the user, ordered by `position`, with `name`, `description`, `kind`, `is_terminal`. The current stage is flagged.
4. Build the prompt:
   - System prompt explains: "You are auditing the lead's pipeline stage with full context. Decide whether the lead is in the correct stage NOW. Respect hierarchy. Output JSON only."
   - Include the same HIERARCHY rules as Layer 1, plus: "If the previous stage was set manually, you may still move the lead, but your `reason` MUST explain why the prior placement no longer fits."
   - Include the full context bundle in a structured user message.
   - Response schema: `{ stage_change: { to_stage_id: string, confidence: "low"|"medium"|"high", reason: string } | null }`.
5. Coerce response. If `null`, no-op. If `confidence !== 'high'`, no-op. Otherwise call `set_lead_stage` with `p_source: 'deep_classifier'`, `p_reason: reason.slice(0, 500)`, `p_confidence: 'high'`, `p_idempotency_key: deep:${threadId}:${leadId}:${windowIndex}`.
6. On success the `dispatchStageEntered` workflow path fires automatically (existing behavior of `applyStageChange`'s pattern, but we duplicate the dispatch in `runDeepReclassify` to keep the modules decoupled).

### Idempotency / race

- Both layers funnel through `set_lead_stage`. Same-stage moves are no-ops (already enforced).
- Layer 2's idempotency key is keyed by `windowIndex`, so it can fire at most once per 10-inbound-message window even on retries or duplicate triggers.
- If Layer 1 moves the lead during a window and Layer 2 disagrees, Layer 2's high-confidence override applies. If Layer 2 agrees, the same-stage check makes it a no-op.

---

## UI Surfaces — Reason Note

### A. Kanban card badge

`src/app/(app)/dashboard/leads/_components/StageColumn.tsx` (or the lead-card component it renders).

- Render a small badge in the corner of any card whose latest `lead_stage_events` row has `source IN ('classifier', 'deep_classifier')`.
- On hover/tap, show a tooltip:
  - "Auto-moved to *<stage name>* — <relative time>"
  - Confidence label (`Medium` / `High`).
  - First ~120 characters of `reason`.
  - "View history" link → opens the lead detail drawer scrolled to the timeline.
- Manual moves render no badge (the card stays clean).
- Deep-classifier overrides of a manual move (i.e. previous event was `manual` and current is `deep_classifier`) render with a distinct icon/color so operators notice corrections.

Required data: the latest stage event per lead. Add to the existing leads list query, or fetch in a small follow-up query keyed by lead id.

### B. Lead detail timeline

Extend the existing `src/app/(app)/dashboard/leads/_components/StageJourney.tsx` component (already rendered in the lead drawer; backed by `loadStageJourney` in `src/app/(app)/dashboard/leads/actions/messenger.ts`). It currently shows stage-to-stage hops but does not surface `source`, `confidence`, or `reason`.

Changes:

- Extend `loadStageJourney` (or add a sibling `loadLeadStageHistory`) to return `lead_stage_events` rows with `source`, `confidence`, `reason`, plus joined from/to stage names and positions. RLS already restricts to the user's leads.
- Update `StageJourney.tsx` to render, per row: from-stage name → to-stage name, timestamp (absolute + relative), source pill, confidence (when present), full reason text, and a backward-move indicator (↩) when `to.position < from.position`.
- Source pills:
  - `Manual` (gray)
  - `AI (per-turn)` for `classifier` (blue)
  - `AI (audit)` for `deep_classifier` (purple)
  - `Form: <page title>` for `action_page` (green)
- Empty state: "No stage history yet."

---

## Files Affected

### Modified

- `src/lib/chatbot/classify.ts` — extend `stageInstruction()` to render position-ordered stages with `[<position> · <kind>]` prefix and add the HIERARCHY rules block.
- `src/app/api/messenger/process/route.ts` — after reply dispatch, count inbound messages and fire `runDeepReclassify` when the cadence hits.
- `src/app/(app)/dashboard/leads/_components/LeadCard.tsx` — render the auto-move badge + tooltip on cards.
- `src/app/(app)/dashboard/leads/_components/StageJourney.tsx` — surface source / confidence / reason on each row.
- `src/app/(app)/dashboard/leads/actions/messenger.ts` — extend `loadStageJourney` (or add `loadLeadStageHistory`) to return source/confidence/reason + stage positions.

### New

- `src/lib/chatbot/deep-reclassify.ts` — the deep re-eval module: context bundle loader, prompt builder, LLM call, coercion, RPC apply.
- `src/lib/chatbot/deep-reclassify.test.ts` — unit tests with mocked LLM + Supabase admin.

### Schema

None. `pipeline_stages.kind` + `position`, `lead_stage_events.source/reason/confidence`, and `leads.entered_stage_at` already exist.

---

## Error Handling

- Deep re-eval is fire-and-forget. The trigger site catches all throws and logs `[deep-reclassify] threw` — never blocks the reply.
- Inside `runDeepReclassify`:
  - Context loading: any DB error → log + return (no move).
  - LLM call: wrapped in try/catch. On throw or empty response → log + return.
  - JSON parse: same lenient extraction pattern as `parseJson` in `classify.ts`. On failure → return.
  - `set_lead_stage` RPC: on error → log + return.
- Idempotency key prevents double-apply on retries.
- Timeline UI tolerates rows with missing `reason` or `confidence` — render "—".
- Leads without a thread (action-page-only) never trigger Layer 2; Layer 1 also doesn't run for them. That's intentional.

---

## Testing Plan

### Unit

- `src/lib/chatbot/classify.test.ts`
  - Prompt rendering includes the HIERARCHY block.
  - Stages are rendered in `position` order with `[<position> · <kind>] <name>` prefix.
  - Backward-move rule text is present.
  - Existing coercion and apply tests still pass.

- `src/lib/chatbot/deep-reclassify.test.ts` (new)
  - Returns `null` → no RPC call.
  - Returns `medium` confidence → no RPC call.
  - Returns `high` forward move → calls `set_lead_stage` with `p_source='deep_classifier'` + window-keyed idempotency.
  - Returns `high` backward move with disqualifying reason → calls RPC.
  - Same `to_stage_id` as current → no-op.
  - Context bundle contains lead profile, stage event history, action-page submissions, full stage list ordered by position.
  - Throws inside LLM call → caller does not throw.

### Integration

- `src/app/api/messenger/process/route.test.ts`
  - Inbound count = 10 → `runDeepReclassify` invoked.
  - Inbound count = 5 → not invoked.
  - Inbound count = 11 → not invoked.
  - `runDeepReclassify` throws → reply still returned, no 500.

### Component

- `LeadStageTimeline.tsx`
  - Renders source pills correctly.
  - Renders backward-move indicator when `to.position < from.position`.
  - Handles missing `reason` / `confidence` gracefully.
  - Empty state when no events.

---

## Rollout

**Phase 1 — Per-turn improvements + UI surfaces.** Ship the prompt changes and the kanban badge + timeline. Low risk; immediate operator value (they can audit the existing classifier).

**Phase 2 — Deep re-eval module.** Add `runDeepReclassify` and the messenger trigger, gated behind a feature flag `chatbot.deep_reclassify_enabled` on `chatbot_configs` (defaulting to false). Flip it on per workspace after internal validation.

**Observability.** Log every deep-reclassify decision with: `leadId`, `windowIndex`, `fromStageId`, `toStageId`, `confidence`, first 200 chars of `reason`. Review the first week's logs for false-positive overrides before defaulting the flag on.

**Schema migration.** None.
