# Force-Send Action Page on Ready Intent — Design

**Status:** Approved (brainstorming complete)
**Date:** 2026-05-21
**Author:** John Angelo David (via Claude)

## Problem

Once a lead has been qualified and shows intent to proceed, the LLM that picks `action_page` in `answerWithClassification` is frequently too cautious — it asks one more qualifying question or leaves `action_page` null instead of attaching the primary action page button. Customers who are ready to buy or book get stranded mid-thread, and the operator's `bot_send_instructions` "send when…" guidance is effectively ignored once the LLM finds *any* reason to delay.

We want a deterministic guarantee: when the lead is qualified AND signals readiness to proceed, the primary action page button is attached on that turn, every turn, no matter what.

## Goals

1. Deterministically attach the primary action page when qualification + proceed-intent conditions are met.
2. Never spam disengaged leads (`lost`, `dormant`) or already-converted leads (`won`).
3. Fall back to the most-recently-updated published page when no primary is configured.
4. Avoid adding cost: at most one extra LLM call per turn for the override decision, with caching.

## Non-Goals

- Cooldown / dedup of repeated sends. Per product decision, the override sends every time conditions fire ("no matter what"). Upstream sender logic may add dedup later, not here.
- Per-lead durable "important knowledge" store. That is a separate future feature with its own design.
- Outbound bulk campaign sends (the Agent Follow-Up worker). Scope is the inbound chatbot reply path only.
- Migrations or new tables. Cache lives in process memory.

## Architecture

A new module **`src/lib/action-pages/force-send.ts`** runs as a post-process step inside `answerWithClassification` (`src/lib/chatbot/classify.ts:280`) — after the LLM returns, before the result is returned to the caller. It receives the LLM's parsed result plus lead/thread context and returns a final `actionPage` value, potentially overriding the LLM's choice.

The existing Messenger send pipeline already takes the returned `actionPage` and delivers the button card as a separate message. No changes to the sender.

The system prompt is also strengthened in `primary-goal.ts` and `classify.ts:443` (`stageInstruction`) so the LLM more often agrees with the override on its own, reducing the wasted-override rate.

## Trigger Conditions

The override forces `actionPage` to the primary (or fallback) page when ALL of the following are true:

1. **Sendable stage.** The lead's current stage `kind` is NOT `lost`, NOT `dormant`, NOT `won`. A lead with no stage is allowed.

2. **A page is resolvable.**
   - Primary: `chatbot_configs.primary_action_page_id` resolves to a published action page for this `userId`.
   - Fallback when no primary is set: the most-recently-updated published action page (`order by updated_at desc limit 1`) for this `userId`. If neither exists, the override does nothing.

3. **Qualified by ANY of these (the "D" trigger from brainstorming):**
   - **A — Stage-based:** Lead's current stage `kind` is `qualifying`, `decision`, or any stage past `entry`/`nurture`.
   - **B — Quiz-based:** Lead has a `lead_submissions` row for a `qualification`-kind action page with `outcome = 'qualified'`.
   - **C — Instruction-based:** Every prerequisite question listed in the *chosen page's* `bot_send_instructions` text has been answered in the conversation. Detected by a single LLM call (cheap classifier model) returning `{"all_answered": bool, "missing": string[]}`. Result cached in-memory keyed by `(leadId, actionPageId, hash(bot_send_instructions))`.

   The three checks are evaluated in order A → B → C; the first one that returns true wins, and only C ever costs an LLM call.

4. **"Proceed" intent detected this turn (the "B3" choice):**
   - **B3a — Stage-forward this turn:** `stageChange` is non-null AND moves to a position ≥ current OR into a stage of kind `qualifying`, `decision`, or `won`.
   - **B3b — Verbal signal regex:** the customer's latest message matches a multilingual regex set covering both English and Tagalog/Taglish: `sige|kunin ko|let'?s go|i'?m in|game na|okay na|magkano|how (do i|much)|paano (mag|sumali|umorder|magbayad|avail)|sign me up|book na|tara|gusto ko na|ready na|proceed|interested po|payment|bayad`.
   - **B3c — Fallback LLM ready check:** if neither B3a nor B3b fires, a single classifier-model call returns `{"ready": bool}` given the last ~6 customer turns.

5. **Conversation has happened.** At least one prior customer message exists in `history` (not a cold first inbound).

When all five fire and the LLM left `actionPage` null (or picked a different page), the override **overwrites** `actionPage` with the resolved primary/fallback page. When the LLM already picked the right page, the override is a no-op.

**No cooldown** — per product decision, every turn that meets these conditions overrides. Skip conditions in trigger (1) prevent the worst spam cases (lost/dormant/won).

## Detection Mechanics (Cost Discipline)

The override decision adds at most **0 or 1 extra LLM calls per turn**, never 2.

- Check 3A (stage) and 3B (quiz submission) are pure DB lookups, often already in context from `loadLeadContext`.
- Check 3C (instruction-based) is only evaluated when 3A and 3B both fail. Cached after first compute — every subsequent turn on the same thread with the same page hits the cache.
- Check 4 (proceed intent): regex first (free). If regex hits → done. If regex misses AND `stageChange` moved forward this turn → done. Only if both fail does the classifier call fire.

If we already paid for the LLM call in check 3C, the proceed-intent classifier (check 4) reuses the same call when possible — combined prompt asks both questions in one envelope. (Implementation detail; spec only commits to "≤1 extra call".)

## Memory Layout

Two distinct concerns, kept in separate modules:

| Need | Lifetime | Backing | Module |
|---|---|---|---|
| Qualification answered cache | Process-local, fine to lose on deploy | In-memory `Map` | `src/lib/leads/cache.ts` (new) |
| Important knowledge per lead (future) | Durable | Postgres | Out of scope, separate spec |

### `src/lib/leads/cache.ts`

A thin typed wrapper around a module-scope `Map`, namespaced so future ephemeral caches (recommendations, sent-page tracking, etc.) can share the module without colliding.

```ts
const store = new Map<string, unknown>()

export function leadCacheGet<T>(namespace: string, leadId: string, key: string): T | undefined {
  return store.get(`${namespace}:${leadId}:${key}`) as T | undefined
}

export function leadCacheSet<T>(namespace: string, leadId: string, key: string, value: T): void {
  store.set(`${namespace}:${leadId}:${key}`, value)
}

export function leadCacheClear(leadId: string): void {
  for (const k of store.keys()) {
    if (k.includes(`:${leadId}:`)) store.delete(k)
  }
}
```

`force-send.ts` uses namespace `qual_check`, key `<actionPageId>`, value `{ hash: string; allAnswered: boolean }`. `hash` is `sha256(bot_send_instructions).slice(0, 16)`. Cache entry is invalidated when the operator edits `bot_send_instructions` (hash differs → recompute).

## Prompt Strengthening

Two surgical edits, additive — they sharpen what happens *after* prerequisites are met without loosening the existing "ask first if prerequisites missing" guardrail.

**Edit A — `src/lib/chatbot/primary-goal.ts:53`**
Append to the "QUALIFY FIRST" block:

> Once every prerequisite above has been answered AND the customer's latest message shows any signal of wanting to proceed (asking how, agreeing, saying "sige"/"okay"/"magkano"/"sign me up"/"book na"/equivalents in any language, or any forward intent), you MUST set `action_page.action_page_id` to this page on this turn. Do not stall with another qualifying question. Do not wait for a more explicit ask. The button arrives as a separate message — your `reply` stays conversational.

**Edit B — `src/lib/chatbot/classify.ts:485` (the "QUALIFY BEFORE SENDING" block)**
Append a parallel "SEND NOW" sub-rule covering non-primary action pages so the same "once prerequisites met, send on any proceed signal" logic applies whenever a page becomes attachable mid-conversation.

## Hook Point and Signatures

### `src/lib/action-pages/force-send.ts`

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionPageBrief, ActionPageChoice, StageBrief, StageChange } from '@/lib/chatbot/classify'
import type { AnswerHistory } from '@/lib/chatbot/answer'

export interface ForceSendContext {
  userId: string
  leadId: string | null
  threadId: string | null
  history: AnswerHistory
  latestCustomerMessage: string
  currentStage: StageBrief | null
  stageChangeThisTurn: StageChange | null
  llmActionPage: ActionPageChoice | null
  actionPages: ActionPageBrief[]
  primaryActionPageId: string | null
  supabase: SupabaseClient
}

export interface ForceSendDecision {
  actionPage: ActionPageChoice | null
  overrideFired: boolean
  reason: string
}

export async function decideForceSend(ctx: ForceSendContext): Promise<ForceSendDecision>
```

### Wiring

In `src/lib/chatbot/classify.ts`, after `coerceActionPage` produces `actionPage` (currently `classify.ts:215`) and before the function returns the result (`classify.ts:280`):

```ts
const forced = await decideForceSend({
  userId,
  leadId: options.leadId ?? null,
  threadId: options.threadId ?? null,
  history,
  latestCustomerMessage: message,
  currentStage: stages.find((s) => s.id === currentStageId) ?? null,
  stageChangeThisTurn: stageChange,
  llmActionPage: actionPage,
  actionPages,
  primaryActionPageId: config.primaryActionPageId,
  supabase,
})
if (forced.overrideFired) {
  console.info('[force-send] override fired', { reason: forced.reason, userId, leadId: options.leadId })
}
actionPage = forced.actionPage
```

`options.leadId` and `options.threadId` are already passed into `answerWithClassification` by every call site; if not, they need to be threaded through (verify during implementation).

The override log line uses `console.info` to match the existing logging level used by `logChatbotUsage` and other observability points in this file.

## Skip Conditions (Edge Cases)

- Lead stage `kind` is `lost` → no override.
- Lead stage `kind` is `dormant` → no override.
- Lead stage `kind` is `won` → no override.
- No `primary_action_page_id` set AND no published action pages for the user → no override.
- Cold first inbound (zero prior customer messages) → no override.
- LLM already attached the correct page → no override (the override is a no-op, not a re-attach).
- `leadId` is null (visitor not yet linked to a lead) → no override; we have no way to cache or look up qualification state.

## Testing

Four test files, colocated:

1. **`src/lib/action-pages/force-send.test.ts`** — table-driven tests for `decideForceSend`:
   - All five conditions met → overrides null LLM choice with primary page.
   - LLM already picked correct page → no override.
   - Lead in `lost` / `dormant` / `won` stage → no override (one case each).
   - No primary set + has published pages → fallback (most-recent published).
   - No primary + no published pages → no override.
   - Cold first inbound (no prior customer messages) → no override.
   - Regex hits "proceed" intent → override fires without classifier call (assert mock NOT called).
   - Regex misses, stage moved forward → override fires without classifier.
   - Regex misses, stage didn't move → classifier called once for `{ready: bool}`.
   - 3C path: stage low, no quiz submission, instructions checked via LLM → cached on second call (assert classifier called once across two `decideForceSend` invocations).
   - `leadId` is null → no override.

2. **`src/lib/leads/cache.test.ts`** — namespace isolation, get/set/clear, no cross-lead leakage.

3. **`src/lib/chatbot/primary-goal.test.ts`** (update) — assert the new "ONCE QUALIFIED" sentence appears in output when `bot_send_instructions` is set.

4. **`src/lib/chatbot/classify.test.ts`** (update or new integration test) — end-to-end with a mocked LLM returning `action_page: null` but context satisfies override → final `actionPage` is the primary page; `console.info` logs the override.

No new DB tables, no migrations.

## Open Questions

None blocking — design is approved for implementation planning.

## Implementation Verification

**Implemented:** 2026-05-21  
**Commits:** `de0a34f` (cache), `b8060ad` `7c17089` `70613ce` `b12039f` `07f445b` `f505c70` (force-send tests), `a2d721e` (primary-goal prompt), `0aff142` (SEND NOW rule), `ff1a09d` (classify wiring), `6c80a60` (route threading)

**Test results (full suite):**
- 152/152 force-send feature tests pass (`cache.test.ts`, `force-send.test.ts`, `primary-goal.test.ts`, `classify.test.ts`, `classify-force-send.test.ts`)
- 839/843 total tests pass; 4 pre-existing failures in `actions.test.ts` and `personality.test.ts` (unrelated to this feature)
- ESLint: no issues on modified/new files

## File Inventory

**New:**
- `src/lib/action-pages/force-send.ts`
- `src/lib/action-pages/force-send.test.ts`
- `src/lib/leads/cache.ts`
- `src/lib/leads/cache.test.ts`

**Modified:**
- `src/lib/chatbot/classify.ts` — wire in `decideForceSend`, append "SEND NOW" prompt block.
- `src/lib/chatbot/primary-goal.ts` — append "ONCE QUALIFIED" instruction.
- `src/lib/chatbot/primary-goal.test.ts` — assert new instruction text.
- `src/lib/chatbot/classify.test.ts` — assert force-send wiring.
