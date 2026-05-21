# Human Takeover — Auto-Pause Bot When Operator Replies

**Date:** 2026-05-21
**Status:** Draft — pending user review

## Summary

When an operator (the page owner) sends a reply in the lead Conversation panel, the reactive chatbot pauses for that thread automatically. The bot resumes after a configurable period of operator inactivity (default 60 minutes), or immediately when the operator manually toggles the bot back on. The existing "Bot off" manual toggle is preserved as a separate, sticky state.

## Goal

Eliminate the manual step of toggling the bot off before chatting with a customer. Today the operator must explicitly disable auto-reply, chat, then remember to re-enable it. The footnote under the send box even calls this out: *"Sending pauses the bot only if you toggle it off."* We want that footnote to become a lie — sending should pause the bot on its own.

## Non-goals

- Pausing scheduled follow-ups during takeover. Out of scope per design discussion — follow-ups continue to fire normally.
- Pausing bulk agent campaigns during takeover. Out of scope — broadcasts still send.
- Pausing on "operator opened the thread" or "operator started typing." The trigger is exclusively a successful operator send.

## Behavior

### Triggers

The pause is triggered when `replyAsOperator` successfully delivers an operator message to Facebook Messenger. Every send resets the timer to `now() + human_takeover_minutes`. The customer sending new messages during the pause does **not** reset the timer — only operator sends do.

### Resume

The pause expires implicitly. When the next inbound customer message arrives, the webhook checks `bot_paused_until` against `now()`. If it's in the past (or NULL), the bot replies normally. No cron job sweeps expired pauses — they're cleared opportunistically by the worker on the next interaction, purely for tidiness.

The operator can also "Resume now" by clicking the pill in the Conversation panel header — this clears `bot_paused_until` without otherwise changing thread state.

### Interaction with the manual `auto_reply_enabled` toggle

Two independent states:

| `auto_reply_enabled` | `bot_paused_until` | Effective bot state |
|---|---|---|
| `true` | NULL or past | **On** — bot replies normally |
| `true` | future timestamp | **Paused** — bot skips reply, timer ticking |
| `false` | any | **Off** — bot stays silent, manual toggle wins |

- Toggling **Bot on** (`auto_reply_enabled` → `true`) also clears `bot_paused_until` so the operator isn't left waiting after explicitly re-enabling.
- Toggling **Bot off** (`auto_reply_enabled` → `false`) does NOT clear `bot_paused_until` — the two states can coexist.
- An operator send while `auto_reply_enabled = false` still stamps `bot_paused_until`, but the manual toggle dominates the UI display.

### Configuration

A new per-user setting `chatbot_configs.human_takeover_minutes` (integer, default `60`).
- `0` disables the feature entirely — no stamping on operator send, no gating in the webhook.
- Any positive value is the pause duration in minutes.

### Classification during pause

Unchanged from today. The pause gates only the *outbound bot reply*. The existing `auto_classify_enabled` path still runs — lead stage updates and conversation summaries continue normally during human takeover. This matches the existing semantics of `auto_reply_enabled = false`.

## Data model

```sql
ALTER TABLE messenger_threads
  ADD COLUMN bot_paused_until timestamptz;
-- NULL = not auto-paused. Past timestamp = pause expired, treated as NULL.

ALTER TABLE chatbot_configs
  ADD COLUMN human_takeover_minutes integer NOT NULL DEFAULT 60;
-- 0 disables auto-takeover. Otherwise minutes of operator inactivity before bot resumes.
```

No backfill needed — NULL `bot_paused_until` and default `60` for `human_takeover_minutes` give the intended behavior for existing rows.

## Implementation outline

### 1. `replyAsOperator` — stamp on successful send

File: `src/app/(app)/dashboard/leads/actions/messenger.ts`

After the existing FB send succeeds (and the outbound message row is updated to clear any error), read `human_takeover_minutes` from the user's `chatbot_configs`. If `> 0`, update the thread:

```ts
const pausedUntil = new Date(Date.now() + cfg.human_takeover_minutes * 60_000)
await admin
  .from('messenger_threads')
  .update({ bot_paused_until: pausedUntil.toISOString() })
  .eq('id', thread.id)
```

If the stamping write fails, log and continue — the operator message was already delivered, and the next send will stamp correctly.

If the FB send fails (operator message row has `error` set), still stamp the pause. The operator's *intent* was to take over; letting the bot reply on top of a failed-to-send operator message is worse than honoring the pause.

### 2. `setAutoReply` — clear pause when re-enabling

Same file. When `enabled === true`, the update now also clears `bot_paused_until`:

```ts
.update({
  auto_reply_enabled: true,
  bot_paused_until: null,
})
```

When `enabled === false`, only `auto_reply_enabled` changes — the pause stamp is left alone.

### 3. Webhook gating

File: `src/app/api/webhooks/facebook/route.ts` (~line 309)

Extend the select on `messenger_threads` to include `bot_paused_until`. Replace:

```ts
if (thread.auto_reply_enabled === false) { /* classify-only fallback */ }
```

with:

```ts
const stillPaused =
  thread.bot_paused_until && new Date(thread.bot_paused_until) > new Date()
if (thread.auto_reply_enabled === false || stillPaused) {
  /* same classify-only fallback */
}
```

### 4. Worker re-check (belt-and-suspenders)

File: `src/app/api/messenger/process/route.ts`

The worker already reads `auto_reply_enabled` and `controlled_by_run_id` (lines ~451, ~517, ~1276, ~1286, ~1386). Add `bot_paused_until` to the same selects and apply the same `stillPaused` check at every gate. If the timer has expired by the time the worker runs but the job was enqueued as classify-only, **honor the original enqueue decision** — within seconds of timer expiry is exactly the moment most likely to step on the operator. The bot will pick up on the *next* inbound message.

Opportunistic cleanup: if the worker sees `bot_paused_until` is in the past and decides to send a normal reply, it can clear the column in the same update that touches the thread tail. Optional — purely for DB hygiene.

### 5. UI — three-state pill in `ConversationPanel`

File: `src/app/(app)/dashboard/leads/_components/ConversationPanel.tsx`

The existing `Header` `<button>` becomes a 3-state pill driven by both `auto_reply_enabled` and `bot_paused_until`:

| Server state | Pill label | Color | Click action |
|---|---|---|---|
| `auto_reply_enabled=true` AND (NULL or past) | **Bot on** | accent filled | Toggle to `auto_reply_enabled=false` |
| `auto_reply_enabled=true` AND future | **Paused · 47m** | amber soft | "Resume now" — clear `bot_paused_until` |
| `auto_reply_enabled=false` | **Bot off** | neutral outlined | Toggle to `auto_reply_enabled=true` AND clear `bot_paused_until` |

The countdown ticks client-side: a `setInterval(60_000)` recomputes the minutes-remaining label from `bot_paused_until`. When it reaches 0, the pill flips back to **Bot on** locally; the next refresh confirms with the server.

The footnote under the textarea changes from:

> ⌘ + Enter to send. Sending pauses the bot only if you toggle it off.

to (when `human_takeover_minutes > 0`):

> ⌘ + Enter to send. Sending pauses the bot for {N} min.

When `human_takeover_minutes = 0`, keep a version close to today's wording.

### 6. New "Resume now" server action

A small server action that sets `bot_paused_until = null` for a given thread, scoped to the operator's user. The pill click in the "Paused" state calls this.

### 7. Chatbot config UI

Add a number input on the chatbot config page (wherever `auto_classify_enabled` lives today) labeled something like:

> Pause bot for ___ minutes after I reply to a customer
> Set to 0 to disable auto-pause.

Validates: integer, `>= 0`, reasonable upper bound (e.g., 1440 = 24h).

## Edge cases

1. **Rapid operator sends.** Each send resets `bot_paused_until = now() + N`. Working as designed.
2. **`human_takeover_minutes = 0`.** No stamping write, no gating check fires. Feature is fully disabled.
3. **Operator send while `auto_reply_enabled = false`.** Stamp anyway, manual toggle wins UI/behavior. Cheap, keeps DB consistent.
4. **Bulk campaign or scheduled follow-up fires during pause.** Not gated by `bot_paused_until` — by design, those still send.
5. **FB send failure on operator message.** Still stamp the pause (operator intent counted).
6. **Webhook-to-worker race at timer expiry.** Worker honors the webhook's original enqueue decision (classify-only). Next inbound message will get a full bot reply.
7. **Customer never sends another message.** Pause stays "active" in DB indefinitely. Harmless — no message to gate. Cleared on next operator interaction or thread state change.

## Test plan

Vitest, following existing patterns under `src/app/(app)/dashboard/leads/actions/` and `src/app/api/*/route.test.ts`:

- `replyAsOperator` stamps `bot_paused_until` ≈ `now() + 60m` when `human_takeover_minutes = 60`
- `replyAsOperator` does NOT stamp when `human_takeover_minutes = 0`
- `replyAsOperator` still stamps when the FB send returns an error (operator intent counted)
- `setAutoReply(true)` clears `bot_paused_until` in the same update
- `setAutoReply(false)` leaves `bot_paused_until` untouched
- Webhook: thread with `bot_paused_until > now()` → classify-only fallback path
- Webhook: thread with `bot_paused_until <= now()` → normal bot reply path
- Webhook: thread with `bot_paused_until` NULL → normal bot reply path
- Worker: thread paused at job dispatch → skip the reply step, classify still runs if enabled
- Worker: timer expired between webhook and worker → honor the webhook's classify-only decision
- "Resume now" action clears `bot_paused_until` without changing `auto_reply_enabled`

UI tests (manual or component-level if existing pattern supports):
- Pill renders "Paused · Nm" with countdown ticking down
- Pill click in "Paused" state calls resume action and flips to "Bot on"
- Footnote text reflects the configured `human_takeover_minutes`

## Open questions

None at design time. Implementation can proceed.
