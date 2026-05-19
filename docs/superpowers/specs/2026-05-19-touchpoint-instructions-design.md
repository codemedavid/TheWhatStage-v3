# Per-Touchpoint Instructions for Auto Follow-Up

Date: 2026-05-19
Status: Accepted

## Goal

Let users attach a short intent/style guide to each of the 7 auto follow-up
touchpoints so the LLM writes a *different kind* of message at each step —
e.g. touchpoint #1 is a light "interested po?" hello, touchpoint #3 shares a
benefit, touchpoint #7 is a graceful sign-off. Today every touchpoint is
generated from the same generic prompt with only the slot number varying,
and the first touchpoint short-circuits to a hardcoded fallback.

## Non-goals

- No new conversation-kind split (instructions are shared across
  `generic` and `real`).
- No literal-text mode. Instructions are guides for the LLM, not the verbatim
  message body.
- No per-kind instructions. One instruction per slot.
- No DB schema migration. The settings live in the existing
  `chatbot_configs.followup_settings` JSONB column.

## Data model

### `FollowupSettings.touchpoints[i]` gains `instruction`

```ts
Touchpoint = {
  enabled: boolean
  offset_ms: number
  instruction: string   // ≤ 200 chars, "" means "use generic prompt"
}
```

zod (`src/lib/followups/settings.ts`):

```ts
const TouchpointSchema = z.object({
  enabled: z.boolean(),
  offset_ms: z.number().int().min(MIN_OFFSET_MS).max(MAX_OFFSET_MS),
  instruction: z.string().trim().max(200).default(''),
})
```

The `.default('')` makes the field optional on read, so existing DB rows
that predate this change parse cleanly with empty instructions.

### Default instructions

`DEFAULT_FOLLOWUP_SETTINGS` ships with starter guides so the feature is
discoverable on first use:

| # | Offset | Default instruction |
|---|---|---|
| 1 | 5m  | `Quick light hello — just ask if still interested po.` |
| 2 | 1h  | `Friendly nudge — offer to answer any questions.` |
| 3 | 5h  | `Share one concrete benefit or social proof — keep it short.` |
| 4 | 8h  | `Ask one focused question to surface what's blocking them.` |
| 5 | 12h | `Light reminder — emphasize convenience and flexibility.` |
| 6 | 18h | `Soft scarcity or a clear call to decide — no pressure.` |
| 7 | 24h | `Last graceful check — invite them to message anytime.` |

The em-dashes in these defaults are deliberate copy for the *guide* text —
they are never sent to the lead. The LLM output is still sanitized by
`sanitizeFollowup`, which strips dashes from the actual message.

## Snapshot behavior

`SnapshotEntry` gains `instruction`:

```ts
SnapshotEntry = {
  slot: number
  offset_ms: number
  instruction: string
}
```

`resolveEnabledOffsets` copies the instruction from each enabled touchpoint
into the snapshot entry. This preserves the existing invariant: in-flight
schedules are unaffected by later edits to the user's settings. A schedule
seeded today with instruction X for slot 2 will fire with instruction X
even if the user changes it tomorrow.

Persisted to `lead_followup_schedules.offsets_snapshot` (existing JSONB
column — no migration needed).

## Prompt integration

`src/lib/followups/generateMessage.ts`:

### `GenerateArgs` gets `instruction: string`

### Slot-0 short-circuit becomes conditional

```ts
if (!args.instruction.trim() && args.slot === 0) {
  return fallback(args.kind, 0, args.leadName)
}
```

When an instruction is set on slot 0, we pay for the LLM call so the
instruction is honored. When empty, the current cost optimization is
preserved.

### System prompt — new "Touchpoint guide" block

When `args.instruction.trim()` is non-empty, inject this block into the
system prompt *after* the personality block and *before* the existing
"You are writing follow-up #N of 7…" framing:

```
Touchpoint guide for THIS message (#N of 7):
"{instruction}"
Follow this guide. Keep the personality and language rules.
```

When the instruction is empty, the prompt is unchanged from today —
existing users who never visit the new UI get the same behavior.

The hard rules (one line, ≤200 chars, no dashes, no markdown, match
personality) stay above the guide. `sanitizeFollowup` runs on the LLM
output unchanged, so any guide that asks for forbidden formatting is
silently cleaned.

## Fire path

`src/lib/followups/fire.ts` — `handleFollowupSend` reads `entry.instruction`
from the snapshot and passes it through to `generateFollowupMessage`:

```ts
const text = await generateFollowupMessage({
  kind: schedule.conversation_kind,
  slot: entry.slot,
  leadName,
  personalityBlock,
  recentMessages,
  instruction: entry.instruction ?? '',  // NEW
})
```

The `?? ''` is defensive against any legacy snapshot rows that pre-date this
change.

## UI — `AutoFollowupForm`

Each touchpoint row gains a second visual line beneath the existing controls:

```
[✓] 1. [5  ] [minutes▾] after last reply
    Guide: [ Quick light hello — just ask if still interested po.   ]  42/200
```

- Single-line `<input type="text">` with `maxLength={200}`.
- Live counter (`{n}/200`) on the right, dimmed when at 0, neutral otherwise.
- Placeholder when empty: `"Leave blank to use the default style for this touchpoint."`
- Disabled when the row's `enabled` checkbox is off (matches existing value/unit fields).
- No new validation needed — empty is valid; `maxLength` enforces the cap.
- `Reset to defaults` restores starter instructions from the table above.
- Existing dirty/cancel/save logic uses `JSON.stringify` comparison against
  the baseline, so it picks up instruction edits automatically.

`RowDraft` type gains an `instruction: string` field; `settingsToState` and
`stateToSettings` thread it through. New CSS selector `.afu-row-guide` for
the wrapper; no other layout shifts.

## API

`/api/chatbot/followup-settings` (`PUT`) — no signature change. The route
validates against the same zod schema, which now includes `instruction`.

## Backward compatibility

- **Old settings rows** (DB has no `instruction` per touchpoint): parsed via
  `z.string().default('')`, fields default to empty. Behavior is identical
  to today.
- **In-flight schedules** seeded before this change: their
  `offsets_snapshot` entries also lack `instruction`. The fire path's
  `?? ''` falls back to empty, which short-circuits slot 0 and uses the
  existing generic prompt for slots 1–6 — same as today.

No data migration is required.

## Tests

- `settings.test.ts`
  - Schema accepts `instruction`, defaults missing field to `''`, rejects
    strings >200 chars.
  - `resolveEnabledOffsets` propagates `instruction` into snapshot entries.
- `generateMessage.test.ts`
  - Slot 0 with non-empty instruction calls the LLM (no short-circuit).
  - Slot 0 with empty instruction still short-circuits to fallback.
  - System prompt contains the guide block when instruction is non-empty.
  - System prompt is unchanged when instruction is empty.
  - LLM output that violates hard rules is still sanitized.
- `fire.test.ts`
  - Instruction is read from snapshot and forwarded to
    `generateFollowupMessage`.
  - Schedules seeded before this change (no `instruction` in snapshot
    entries) still fire correctly with the empty-string fallback.
- `seed.test.ts`
  - Newly seeded schedule's snapshot carries the user's current
    instructions.
- `route.test.ts` (followup-settings)
  - Round-trip with instructions present.
  - Old payload without instructions still loads.

## Files touched

- `src/lib/followups/settings.ts`
- `src/lib/followups/generateMessage.ts`
- `src/lib/followups/fire.ts`
- `src/lib/followups/seed.ts` (verify snapshot persistence)
- `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx`
- CSS for `.afu-row-guide`
- Tests listed above
