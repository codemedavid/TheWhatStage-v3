# Auto Follow-Up Settings

**Status:** Draft
**Date:** 2026-05-19
**Related:** [Lead Silent Follow-Up](2026-05-17-lead-silent-followup-design.md)

## Summary

Today the lead silent auto-followup runs on a hardcoded schedule (`src/lib/followups/config.ts`): 7 touchpoints at 5m / 1h / 5h / 8h / 12h / 18h / 24h after the lead's last inbound. Users can't turn it off, skip individual touchpoints, or change the intervals.

This spec adds a per-user configuration: a master on/off toggle, plus the ability to enable/disable each of the 7 touchpoint slots and set each enabled slot's interval. Configuration lives on a new "Auto Follow-Up" tab inside `/dashboard/chatbot`.

## Goals

- Per-user master on/off switch for the silent auto-followup engine.
- Per-touchpoint enable + interval, with the existing 7-slot cap retained.
- Sane validation (min 1 minute, max 7 days, strictly increasing across enabled rows, ≥1 enabled when master ON).
- No impact on schedules already in flight when settings change.
- Message-variety mapping (`FALLBACK_POOL` in `generateMessage.ts`) preserved per original slot index, not the compact runtime index.

## Non-goals

- Per-page or per-brand schedules (config is per user).
- Per-touchpoint message tone, custom copy, or template selection.
- Retroactive rewrite of running schedules (Q3 = A: changes apply to new seeds only).
- Adding an 8th touchpoint or removing the 7-slot cap.

## User-facing behavior

### Where it lives

The chatbot page (`/dashboard/chatbot`) gains tab navigation. The current single-column editor becomes the "Personality" tab; a new "Auto Follow-Up" tab hosts the new form. Tab state is client-side with URL sync (`?tab=followup`) so links are shareable.

### Form layout

```
Auto Follow-Up

  [●━━] Enabled
       When a lead goes quiet, automatically send up to 7 nudges.

  Touchpoints                                  Reset to defaults
  ─────────────────────────────────────────────────────────
   ☑  1.   [   5  ] [ minutes ▾]   after last reply
   ☑  2.   [   1  ] [ hours   ▾]   after last reply
   ☑  3.   [   5  ] [ hours   ▾]   after last reply
   ☑  4.   [   8  ] [ hours   ▾]   after last reply
   ☑  5.   [  12  ] [ hours   ▾]   after last reply
   ☑  6.   [  18  ] [ hours   ▾]   after last reply
   ☑  7.   [  24  ] [ hours   ▾]   after last reply

  Inline warnings appear here.

                                                [ Cancel ] [ Save ]
```

- Time picker: number input + unit dropdown (`minutes` / `hours` / `days`).
- Display chooses the largest clean unit when rendering (5 min → `5 / minutes`, 3 600 000 ms → `1 / hour`).
- Master toggle OFF visually dims rows but keeps them editable, so toggling ON restores prior config.
- "Reset to defaults" restores the original 7-touchpoint schedule.

### Time semantics

Each row's interval is measured **from the lead's last inbound** (absolute offset from `started_at`). Disabling a row skips that touchpoint; it does not shift later rows earlier. Matches the current engine, which computes `next_run_at = started_at + offset[idx]` on every advance.

### Retroactive behavior

Changes to settings apply only to schedules seeded *after* the save. Schedules already pending in `lead_followup_schedules` continue against the snapshot captured at seed time (see Data model). This means:

- Turning the master toggle OFF does not cancel in-flight schedules.
- Changing an interval does not reschedule in-flight schedules.

This trade-off was chosen explicitly (Q3 = A) for predictability and simplicity.

## Data model

### `chatbot_configs.followup_settings` (new, jsonb, nullable)

`null` = "use defaults" — preserves current behavior for users who never open the tab and avoids a backfill.

Shape (zod-validated on write):

```ts
{
  enabled: boolean,
  touchpoints: [
    { enabled: boolean, offset_ms: number },  // slot 0
    { enabled: boolean, offset_ms: number },  // slot 1
    { enabled: boolean, offset_ms: number },  // slot 2
    { enabled: boolean, offset_ms: number },  // slot 3
    { enabled: boolean, offset_ms: number },  // slot 4
    { enabled: boolean, offset_ms: number },  // slot 5
    { enabled: boolean, offset_ms: number },  // slot 6
  ]
}
```

Validation rules:

- `touchpoints.length === 7`
- Each `offset_ms`: integer, `60_000 <= x <= 7 * 24 * 3_600_000` (1 min – 7 days)
- Among enabled rows, `offset_ms` strictly increasing
- If `enabled === true`, at least one touchpoint must be `enabled: true`

Defaults — single source of truth in `src/lib/followups/settings.ts`:

```ts
DEFAULT_FOLLOWUP_SETTINGS = {
  enabled: true,
  touchpoints: [
    { enabled: true, offset_ms: 5 * 60_000 },
    { enabled: true, offset_ms: 60 * 60_000 },
    { enabled: true, offset_ms: 5 * 3_600_000 },
    { enabled: true, offset_ms: 8 * 3_600_000 },
    { enabled: true, offset_ms: 12 * 3_600_000 },
    { enabled: true, offset_ms: 18 * 3_600_000 },
    { enabled: true, offset_ms: 24 * 3_600_000 },
  ],
}
```

`OFFSETS_MS` in `config.ts` becomes a derived constant exported from `settings.ts` so the two cannot drift.

### `lead_followup_schedules.offsets_snapshot` (new, jsonb, not null, default `'[]'`)

Captures the user's enabled offsets and their original slot indices at seed time, so in-flight schedules survive subsequent setting changes.

Shape:

```ts
Array<{ offset_ms: number, slot: number }>
// length 1..7
// offset_ms ascending
// slot is the original 0..6 index into touchpoints[] — preserves FALLBACK_POOL mapping
```

Migration:

```sql
alter table public.lead_followup_schedules
  add column offsets_snapshot jsonb not null default '[]'::jsonb;

-- Backfill existing rows with the historical default schedule.
update public.lead_followup_schedules
   set offsets_snapshot = jsonb_build_array(
     jsonb_build_object('offset_ms', 300000,   'slot', 0),
     jsonb_build_object('offset_ms', 3600000,  'slot', 1),
     jsonb_build_object('offset_ms', 18000000, 'slot', 2),
     jsonb_build_object('offset_ms', 28800000, 'slot', 3),
     jsonb_build_object('offset_ms', 43200000, 'slot', 4),
     jsonb_build_object('offset_ms', 64800000, 'slot', 5),
     jsonb_build_object('offset_ms', 86400000, 'slot', 6)
   )
 where jsonb_array_length(offsets_snapshot) = 0;
```

The existing `next_offset_idx` constraint (`between 0 and 6`) still holds — a snapshot has at most 7 entries, so `next_offset_idx` still spans `0..6`. No constraint change needed.

### Add `followup_settings` column

```sql
alter table public.chatbot_configs
  add column followup_settings jsonb;
```

No backfill — `null` means "use defaults."

## Library: `src/lib/followups/settings.ts` (new)

```ts
export const FOLLOWUP_SETTINGS_SCHEMA = z.object({ ... })   // with refinements above
export type FollowupSettings = z.infer<typeof FOLLOWUP_SETTINGS_SCHEMA>

export const DEFAULT_FOLLOWUP_SETTINGS: FollowupSettings = { ... }

// Snapshot entry stored on lead_followup_schedules.offsets_snapshot
export interface SnapshotEntry { offset_ms: number; slot: number }

export async function loadFollowupSettings(
  admin: SupabaseClient,
  userId: string,
): Promise<FollowupSettings>
// SELECT followup_settings FROM chatbot_configs WHERE user_id = userId
// - row missing → DEFAULT_FOLLOWUP_SETTINGS
// - column null → DEFAULT_FOLLOWUP_SETTINGS
// - parse fails → log once, return DEFAULT_FOLLOWUP_SETTINGS
// - DB error → log once, return DEFAULT_FOLLOWUP_SETTINGS
//   (engine never blocks on bad config or transient DB failure)

export function resolveEnabledOffsets(settings: FollowupSettings): SnapshotEntry[]
// Returns compact snapshot of enabled offsets:
//   - master OFF → []
//   - master ON, all rows disabled → []   (defensive; not saveable via API)
//   - otherwise: [{ offset_ms, slot }, ...] sorted ascending by offset_ms
```

`src/lib/followups/config.ts` keeps `REAL_CONVERSATION_LEAD_MSG_THRESHOLD`, `MAX_LIFETIME_LEAD_INBOUND`, type aliases, and re-exports `OFFSETS_MS` (derived from `DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map(t => t.offset_ms)`).

`MAX_OFFSET_IDX` is removed; engine code uses `snapshot.length - 1` instead.

## Engine integration

### `src/lib/followups/seed.ts`

`maybeScheduleFollowup` changes:

```ts
// 1. cancel active (unchanged)
await cancelActiveFollowup(admin, args.threadId)

// 2. existing gates (unchanged)
const gate = await shouldSeed(admin, { threadId, leadId })
if (!gate.ok) return

// 3. NEW: load settings, build snapshot
const settings = await loadFollowupSettings(admin, args.userId)
const snapshot = resolveEnabledOffsets(settings)
if (snapshot.length === 0) return         // master off or no enabled rows

// 4. insert with snapshot
const next_run_at = new Date(Date.parse(args.lastInboundAt) + snapshot[0].offset_ms).toISOString()
await admin.from('lead_followup_schedules').insert({
  user_id: args.userId,
  lead_id: args.leadId,
  thread_id: args.threadId,
  page_id: args.pageId,
  started_at: args.lastInboundAt,
  next_offset_idx: 0,
  next_run_at,
  status: 'pending',
  conversation_kind,
  lead_inbound_count_at_seed: gate.inboundCount,
  offsets_snapshot: snapshot,            // ← new
})
```

The `cancelActiveFollowup` call stays unconditional, ensuring threads never stick when settings flip.

### `src/lib/followups/fire.ts`

`handleFollowupSend` changes:

- `SELECT` adds `offsets_snapshot`.
- `generateFollowupMessage` is called with `slot: snapshot[next_offset_idx].slot`, not the compact `next_offset_idx`. This preserves the original FALLBACK_POOL mapping when intermediate rows are disabled.
- `advanceSchedule` becomes:

  ```ts
  async function advanceSchedule(admin, schedule) {
    const snapshot: SnapshotEntry[] = schedule.offsets_snapshot
    if (schedule.next_offset_idx >= snapshot.length - 1) {
      await markDone(admin, schedule.id)
      return
    }
    const nextIdx = schedule.next_offset_idx + 1
    const nextRunAt = new Date(
      Date.parse(schedule.started_at) + snapshot[nextIdx].offset_ms
    ).toISOString()
    await admin.from('lead_followup_schedules').update({
      next_offset_idx: nextIdx,
      next_run_at: nextRunAt,
      status: 'pending',
      job_id: null,
    }).eq('id', schedule.id)
  }
  ```

Gates inside `handleFollowupSend` are unchanged — they don't consult settings.

### `src/lib/followups/generateMessage.ts`

Signature change: the `offsetIdx` parameter is renamed to `slot` for clarity (it's now the original 0..6 slot, not the schedule's compact index). `FALLBACK_POOL` indexing is unchanged.

## API: `src/app/api/chatbot/followup-settings/route.ts` (new)

```
GET  /api/chatbot/followup-settings
  → 200 { settings: FollowupSettings }   // DEFAULT_* if row null/missing
  → 401 if no session

PUT  /api/chatbot/followup-settings
  body: { settings: FollowupSettings }
  → 200 { settings }
  → 400 { error: <message>, path: <zod path> }
  → 401 if no session
```

- `PUT` validates with `FOLLOWUP_SETTINGS_SCHEMA.safeParse`. On failure, return first issue's `message` + `path`.
- Whole-object replace (no partial PATCH).
- Persistence: `upsert({ user_id, followup_settings: parsed.data }, { onConflict: 'user_id' })` — handles users with no `chatbot_configs` row.
- No new RLS — `chatbot_configs` is owner-scoped already.

## UI

### Files

- `src/app/(app)/dashboard/chatbot/page.tsx` — add tab shell, extend server fetch.
- `src/app/(app)/dashboard/chatbot/_components/ChatbotTabs.tsx` (new) — tab nav + URL sync.
- `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx` (new) — the form.
- `src/lib/chatbot/config.ts` — extend `getChatbotConfig` to read and parse `followup_settings`, returning `DEFAULT_FOLLOWUP_SETTINGS` when null.

### `ChatbotTabs`

Client component. Receives the rendered children for each tab as props (or composes them inline). Owns `activeTab` state, default `personality`. Reads/writes `?tab=` in the URL via `useSearchParams` + `router.replace`. Renders the existing `TestChat` aside as a sibling outside the tabbed region so it remains mounted across tabs.

Tabs: `Personality` (existing content), `Auto Follow-Up` (new form).

### `AutoFollowupForm`

Client component.

Props:

```ts
interface AutoFollowupFormProps {
  initial: FollowupSettings
}
```

Internal state:

```ts
interface RowDraft {
  enabled: boolean
  value: number       // shown in the input
  unit: 'minutes' | 'hours' | 'days'
}
interface FormState {
  enabled: boolean
  rows: RowDraft[]    // length 7
}
```

Conversion helpers in the component:

- `msToDraft(offset_ms)` → picks the largest unit `U ∈ {days, hours, minutes}` such that `offset_ms` is a whole multiple of one `U`. E.g., 5 400 000 ms (90 min) stays as `90 / minutes`, not `1.5 / hours`.
- `draftToMs(row)` → multiplies value × unit factor

Validation runs on every change, producing `Map<rowIdx, errorMessage>`. Save button disabled when:

- master ON and no enabled rows, **or**
- any row has a value outside 1m..7d, **or**
- enabled rows not strictly increasing in `offset_ms`

Submit flow:

1. Build `FollowupSettings` from `FormState`.
2. `PUT /api/chatbot/followup-settings` with `{ settings }`.
3. On 200, show toast "Auto follow-up updated" and update `initial`-derived baseline so "Cancel" returns to the saved state.
4. On 400, surface `error` and highlight the row at `path[1]` if present.

Reset button: confirms via `window.confirm`, then sets state to `DEFAULT_FOLLOWUP_SETTINGS`. Does not auto-save.

Cancel button: reverts state to the last saved baseline (`initial`, refreshed after each successful save).

## Testing

### Unit

`src/lib/followups/settings.test.ts` (new)

- Schema accepts valid input.
- Rejects `touchpoints.length !== 7`.
- Rejects `offset_ms < 60_000` and `> 7 * 24 * 3_600_000`.
- Rejects enabled rows that are not strictly increasing.
- Rejects `enabled: true` with zero enabled rows.
- Allows `enabled: false` with any (or zero) enabled rows.
- `resolveEnabledOffsets` returns compact snapshot with correct slots when master ON.
- Returns `[]` when master OFF.
- Returns `[]` when master ON but all rows disabled (defensive).
- `loadFollowupSettings` returns defaults when row missing, column null, or parse fails.

`src/lib/followups/seed.test.ts` (extend)

- Default settings → snapshot has 7 entries, slots `0..6`.
- Rows 2/4/6 disabled (1-indexed in UI = slots 1/3/5) → snapshot has 4 entries with the correct slot indices.
- Master OFF → no insert, no error.
- All rows disabled with master ON → no insert (defensive).

`src/lib/followups/fire.test.ts` (extend)

- `advanceSchedule` uses `offsets_snapshot[next_idx].offset_ms`, not the imported defaults.
- `markDone` triggers at `next_idx === snapshot.length - 1`, not hardcoded 6.
- `generateFollowupMessage` receives `slot` from the snapshot entry.
- A schedule with a length-4 snapshot fires 4 times then marks done.

### API

`src/app/api/chatbot/followup-settings/route.test.ts` (new)

- GET 401 without session.
- GET returns defaults when no row.
- GET returns saved settings when present.
- PUT 401 without session.
- PUT 400 on invalid shape (returns `path`).
- PUT round-trip: GET after PUT returns the saved value.

### Migration

Covered by existing migration-up CI flow. Backfill of `offsets_snapshot` is guarded by `where jsonb_array_length(offsets_snapshot) = 0`.

### Manual UI smoke

No RTL/component tests for `AutoFollowupForm`. Manual checks in the dev server:

- Toggle master OFF → save → reopen page → state persists, GET returns OFF.
- Disable a middle row → save → seed a new lead inbound → confirm new schedule's `offsets_snapshot` skips that slot.
- Set row 3 = 30m when row 2 = 1h → inline error, Save disabled.
- Set row value = 0 → inline error, Save disabled.
- All rows unchecked while master ON → inline error, Save disabled.

## Open trade-offs accepted

- **Master OFF doesn't cancel in-flight schedules.** Users who want to stop everything immediately would need a "Cancel all" button — out of scope here. Followups already cancel on each new lead inbound.
- **No per-touchpoint custom copy.** Engine still uses `FALLBACK_POOL` / generated messages; users only control timing and presence.
- **Single time semantics (offset from last inbound).** No "between consecutive touchpoints" mode.

## Files added / changed

**New:**
- `supabase/migrations/<ts>_followup_settings.sql`
- `src/lib/followups/settings.ts`
- `src/lib/followups/settings.test.ts`
- `src/app/api/chatbot/followup-settings/route.ts`
- `src/app/api/chatbot/followup-settings/route.test.ts`
- `src/app/(app)/dashboard/chatbot/_components/ChatbotTabs.tsx`
- `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx`

**Changed:**
- `src/lib/followups/config.ts` (re-exports from `settings.ts`; remove `MAX_OFFSET_IDX`)
- `src/lib/followups/seed.ts` (load settings, write snapshot)
- `src/lib/followups/fire.ts` (read snapshot, advance by snapshot length, pass `slot` to message gen)
- `src/lib/followups/seed.test.ts` (extend)
- `src/lib/followups/fire.test.ts` (extend)
- `src/lib/followups/generateMessage.ts` (rename `offsetIdx` → `slot`)
- `src/lib/chatbot/config.ts` (return parsed `followupSettings`)
- `src/app/(app)/dashboard/chatbot/page.tsx` (tab shell + new tab content + fetch settings)
