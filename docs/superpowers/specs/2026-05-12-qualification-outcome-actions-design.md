# Qualification Outcome Actions

**Date:** 2026-05-12
**Status:** Approved direction, pending implementation plan

## Problem

The current qualification action page is configurable at the question level, but it is not easy to set up as a real workflow. Operators have to think across several disconnected areas:

- quiz questions and scores in the qualification editor,
- stage movement in the generic pipeline-rules editor,
- one global Messenger echo,
- separate bot-send instructions for sending action pages later.

That creates two practical problems:

1. **Stage movement appears broken.** A newly created qualification page ships with pipeline rules for `qualified`, `disqualified`, and `pending_review`, but each rule has `to_stage_id: null`. The submit handler only calls `applyStageMove()` when the matched rule has a concrete `to_stage_id`, so a submitted qualification often records an outcome without moving the lead.

2. **Outcomes cannot drive next actions clearly.** The product need is: when a lead gets a certain qualification outcome, the system should be able to move the lead, send an outcome-specific message, and optionally attach the next action page. Today that behavior is spread across generic pipeline rules, global notification text, workflow triggers, and bot instructions.

## Goals

- Make qualification setup feel like configuring outcomes, not wiring separate technical systems.
- Preserve the current simple quiz model while making it useful out of the box.
- Ensure qualification submissions can move stages reliably.
- Let each qualification outcome define:
  - how it is matched,
  - which stage the lead moves to,
  - what Messenger reply is sent,
  - which action page, if any, is attached next,
  - what public thank-you message is shown.
- Keep existing qualification pages working through backward-compatible parsing.

## Non-goals

- No full branching quiz builder in this phase.
- No drag-and-drop condition graph.
- No database migration required for v1; this can live inside the existing action page `config` and `pipeline_rules` JSON fields.
- No replacement of the workflow engine. Qualification outcome actions should complement workflow triggers, not remove them.

## Current Implementation Notes

- Public qualification config is defined in `src/app/a/[slug]/_kinds/qualification/schema.ts`.
- Dashboard configuration lives in `src/app/(app)/dashboard/action-pages/_kinds/qualification/Editor.tsx`.
- Public quiz rendering and form submission live in `src/app/a/[slug]/_kinds/qualification/Renderer.client.tsx`.
- Qualification submission parsing lives in `src/lib/action-pages/handlers/qualification.ts`.
- Score calculation lives in `src/lib/action-pages/handlers/qualification.score.ts`.
- Stage movement happens in `src/app/api/action-pages/submit/route.ts`, but only if a matched pipeline rule has `to_stage_id`.
- Generic pipeline-rule outcome choices are hard-coded in `src/app/(app)/dashboard/action-pages/_components/PipelineRulesEditor.tsx`.
- Messenger button sending and signed action page deeplinks already exist in the Messenger send path.

## Design

### 1. Qualification outcome actions

Extend qualification config with an `outcomes` array.

Each outcome represents a business result and its immediate actions:

```ts
type QualificationOutcomeAction = {
  id: string
  label: string
  outcome: string
  match:
    | { kind: 'score_at_least'; value: number }
    | { kind: 'score_below'; value: number }
    | { kind: 'manual_review' }
    | {
        kind: 'answer_equals'
        question_id: string
        value: string | number | boolean
      }
    | {
        kind: 'answer_includes'
        question_id: string
        value: string
      }
  to_stage_id: string | null
  messenger_text: string
  attach_action_page_id: string | null
  attach_cta_label: string
  public_message: string
}
```

Initial presets:

- `qualified`: score at least threshold, move to a qualifying or decision stage when configured.
- `disqualified`: score below threshold, move to a lost stage when configured.
- `pending_review`: manual review, optional stage move.

Existing `scoring.threshold`, `qualified_outcome`, and `disqualified_outcome` stay readable for compatibility. If `config.outcomes` is missing, the parser derives equivalent outcome actions from the current scoring settings and pipeline rules.

### 2. Outcome evaluation

Add a pure helper near the scoring code:

```ts
evaluateQualificationOutcome(config, answers): {
  outcome: string
  score: number | null
  matchedOutcome: QualificationOutcomeAction
  missing_required: string[]
}
```

Evaluation order:

1. Parse answers.
2. Check required questions. Missing required answers should produce a validation result and should not accidentally qualify the lead.
3. If scoring mode is `manual_review`, return the manual-review outcome.
4. Calculate score.
5. Evaluate outcome actions in editor order.
6. Use the first matching outcome.
7. If no outcome matches, use a safe fallback:
   - `pending_review` if present,
   - otherwise `disqualified`.

This replaces the current single `score >= threshold` decision in the qualification handler while preserving that behavior as the default preset.

### 3. Submission data shape

Qualification submissions should save enough data for debugging and reporting:

```ts
{
  answers: DisplayAnswer[],
  score: number | null,
  outcome_action_id: string,
  outcome_label: string,
  meta: {
    validation_errors?: { missing_required: string[] }
  }
}
```

The top-level `action_page_submissions.outcome` remains the stable outcome string, such as `qualified`, `disqualified`, `pending_review`, or a custom outcome.

### 4. Stage movement

Move qualification stage behavior closer to the outcome action:

- If the matched qualification outcome has `to_stage_id`, use it.
- Else, preserve existing generic pipeline-rule lookup.
- Else, use code-level default stage fallback from the broader action-page default-stage design:
  - `qualified` -> first appropriate qualifying or decision stage,
  - `disqualified` -> first lost stage,
  - `pending_review` -> no automatic move unless configured.

This makes a simple page work even when the user has not manually opened generic pipeline rules.

### 5. Messenger reply and attached action page

For a Messenger-attributed submission:

1. If the matched outcome has `messenger_text`, send it.
2. If it has `attach_action_page_id`, send a second Messenger button/card with a signed deeplink for that action page.
3. If the attached page is catalog or realestate, reuse the existing carousel behavior where practical; otherwise send a normal button.
4. If no outcome-level message exists, fall back to the existing per-rule `notify_text`, then global `notification_template.text`.

The attached action page should be stored by id, not slug, and resolved at send time. It must be published and owned by the same user.

### 6. Public thank-you message

The public submit redirect currently shows a generic success message for non-standalone rich page kinds. Qualification should show the matched outcome's `public_message` when available.

Implementation can use one of these approaches:

- redirect to `/a/[slug]?submitted=1&submission=<id>` and server-load the submission message,
- or return JSON for the client stepper and render the message without a full redirect.

Prefer the submission-id redirect first because it matches the current form-post structure and avoids changing the public renderer into a fully fetch-driven flow.

### 7. Editor UX

Reshape the qualification editor into these sections:

1. **Questions**
   - keep the existing simple question list,
   - keep scores visible but explain them as inputs to outcomes,
   - remove or implement confusing unused fields such as `min_rating_to_pass`.

2. **Outcomes**
   - show preset cards for Qualified, Not qualified, and Needs review,
   - each card contains:
     - matching rule,
     - move-to-stage select,
     - Messenger reply textarea,
     - attach-action-page select,
     - button label,
     - public thank-you message.

3. **Advanced**
   - optional custom outcome rows,
   - optional legacy/generic pipeline rules only when needed.

This makes the expected workflow obvious: questions produce outcomes, outcomes perform actions.

### 8. Workflow compatibility

Keep `dispatchSubmissionReceived()` unchanged at the contract level. It should continue to receive:

- `actionPageId`,
- `submissionId`,
- `outcome`,
- `leadId`,
- `threadId`.

Custom qualification outcomes become usable in workflow triggers because the submitted outcome string remains stable.

### 9. Backward compatibility

Existing pages without `config.outcomes` should continue to work:

- `manual_review` mode maps to `pending_review`.
- `rule_based` mode maps to score threshold outcomes.
- Existing `pipeline_rules[].to_stage_id` and `notify_text` are used as fallback action settings.
- Existing submissions remain readable because dashboard submission cards already tolerate unknown outcome labels.

## Proposed File Responsibilities

| File | Responsibility |
|---|---|
| `src/app/a/[slug]/_kinds/qualification/schema.ts` | Add outcome-action schema and parser normalization |
| `src/lib/action-pages/handlers/qualification.score.ts` | Keep pure score calculation; add or neighbor outcome evaluation helper |
| `src/lib/action-pages/handlers/qualification.ts` | Return matched outcome and richer submission data |
| `src/app/api/action-pages/submit/route.ts` | Apply matched outcome actions: stage move, Messenger reply, attached page send, public message support |
| `src/app/(app)/dashboard/action-pages/_kinds/qualification/Editor.tsx` | Replace scoring UI with outcome cards |
| `src/app/(app)/dashboard/action-pages/_components/PipelineRulesEditor.tsx` | Stop blocking custom qualification outcomes; make generic rules secondary |
| `src/app/(app)/dashboard/action-pages/[id]/submissions/page.tsx` | Show dynamic outcome labels/stats instead of only fixed qualification buckets |
| `src/lib/action-pages/outcome-actions.ts` | New shared helpers for resolving attached action pages and default stage fallback, if submit route grows too large |

## Test Plan

Add focused tests before implementation:

1. Existing threshold config without `outcomes` still returns `qualified` / `disqualified`.
2. Missing required answer does not qualify a lead and records validation metadata.
3. Manual review mode returns `pending_review`.
4. Outcome action with `to_stage_id` moves the lead.
5. Qualification page with no configured `to_stage_id` uses default fallback for `qualified` / `disqualified`.
6. Outcome-specific Messenger text overrides global notification text.
7. Outcome attached action page sends a signed button URL for the selected page.
8. Attached action page is ignored if unpublished or owned by another user.
9. Custom outcome string can be saved and used by workflow submission triggers.
10. Dashboard submission stats render custom outcomes without dropping them.

## Risks

- Outcome actions duplicate some existing pipeline-rule behavior. The mitigation is to treat outcome actions as the qualification-specific primary UI and keep generic pipeline rules as compatibility/advanced behavior.
- Messenger sending after submission is policy-sensitive. The existing `sendOutbound()` policy gate should remain the single send path.
- Public thank-you message loading by submission id must avoid leaking submissions across users/pages. The submission id lookup must be scoped by the current public page id.
- If too many custom condition types are added at once, the editor may become confusing again. Start with score threshold, manual review, and one-answer conditions only.

## Rollout

1. Add parser support for `config.outcomes` with legacy normalization.
2. Add pure outcome evaluation tests and implementation.
3. Wire qualification handler to return matched outcome action metadata.
4. Wire submit route to use matched outcome stage/message/action-page behavior.
5. Update editor UX to outcome cards.
6. Update submissions dashboard for dynamic outcome summaries.
7. Keep generic pipeline rules visible but demoted for qualification pages.

## Decisions For The Implementation Plan

- `qualified` defaults to the first qualifying stage when no explicit outcome stage or generic pipeline rule is set. Users can choose a decision stage explicitly from the outcome card.
- Public thank-you messages use the submission-id redirect approach: `/a/[slug]?submitted=1&submission=<id>`, scoped by the current public page id.
- Outcome-attached action pages send as plain Messenger button cards in the first version. Catalog and realestate carousel parity can be added after the outcome-actions behavior is working.
