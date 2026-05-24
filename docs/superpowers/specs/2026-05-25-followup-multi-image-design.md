# Auto Follow-Up: Multiple Images per Touchpoint

**Date:** 2026-05-25
**Status:** Approved (brainstorm); pending implementation plan
**Surface:** `/dashboard/chatbot` → Auto Follow-Up panel
**Touches:** `src/lib/followups/*`, `src/app/(app)/dashboard/chatbot/_components/*`, `src/app/api/chatbot/followup-settings/*`, one SQL migration

## 1. Goal

Let each Auto Follow-Up touchpoint attach **0–3 images** (currently 0–1) and a (still) optional action page. Image and action page must remain independently optional — a touchpoint can have text only, text + images, text + page, or text + images + page.

The agent-campaign feature (`agent_campaigns`) is **not** in scope; it has its own code path.

## 2. Scope

**In scope**
- Per-touchpoint 0–3 images (ordered, send in pick order)
- Multi-select in `MediaPickerModal` with per-tile ordinal badge
- Worker (`fire.ts`) sends `text → img1 → img2 → img3 → button?` sequentially; partial failure is tolerated (log + advance)
- Schema rename: `image_media_asset_id: string|null` → `image_media_asset_ids: string[]` (0–3)
- Expand-then-contract migration: add new key, code reads both, later strip old key
- `lead_followup_schedules.offsets_snapshot` is **not** migrated; `fire.ts` carries a back-compat shim for ≤7 days

**Out of scope**
- Drag-to-reorder, per-image captions, multi-page-per-touchpoint
- 24-hour-window rules (unchanged: attachments still skipped outside the window)
- Changes to `mintMediaAssetUrl`, `mintActionPageDeeplink`, `sendOutbound`, or the job queue
- UI test harness for `AutoFollowupForm.tsx` (none exists today; not adding one for this work)
- Retries on image-send failure

## 3. Constraints

- **Max 3 images** per touchpoint
- **Order = pick order** (no reorder UI)
- Send order on wire: `text → images (in pick order) → button (if action_page_id)`
- Partial-failure semantics: log and continue (matches today's single-image behavior)
- No new DB columns; everything stays in the existing JSONB
- In-flight schedules (≤7-day lifespan) must keep firing correctly without touching their `offsets_snapshot` rows

## 4. Data model

### 4a. TypeScript / zod (`src/lib/followups/settings.ts`)

```ts
const MAX_IMAGES_PER_TOUCHPOINT = 3

const TouchpointSchema = z.object({
  enabled: z.boolean(),
  offset_ms: z.number().int().min(MIN_OFFSET_MS).max(MAX_OFFSET_MS),
  instruction: z.string().trim().max(MAX_INSTRUCTION_LEN).default(''),
  image_media_asset_ids: z.array(z.string().uuid())
    .max(MAX_IMAGES_PER_TOUCHPOINT)
    .default([]),
  action_page_id: z.string().uuid().nullable().default(null),
})
```

`SnapshotEntry`:
```ts
export interface SnapshotEntry {
  offset_ms: number
  slot: number
  instruction: string
  image_media_asset_ids: string[]   // new (was image_media_asset_id: string | null)
  action_page_id: string | null
}
```

`DEFAULT_FOLLOWUP_SETTINGS`: every row gets `image_media_asset_ids: []`.

`resolveEnabledOffsets()` passes the array through unchanged.

### 4b. Loader back-compat (`loadFollowupSettings`)

Before zod-parsing the persisted JSONB, normalize each touchpoint:

```ts
function normalizeTouchpoint(t: unknown): unknown {
  if (!t || typeof t !== 'object') return t
  const tp = t as Record<string, unknown>
  if (Array.isArray(tp.image_media_asset_ids)) return tp
  const legacy = typeof tp.image_media_asset_id === 'string' ? tp.image_media_asset_id : null
  return { ...tp, image_media_asset_ids: legacy ? [legacy] : [] }
}
```

This makes the loader idempotent across Step A → Step D of the rollout (Section 8).

### 4c. SQL migration (Step B — expand only)

`supabase/migrations/<ts>_followup_multi_image.sql`:

```sql
update public.chatbot_configs
set followup_settings = jsonb_set(
  followup_settings,
  '{touchpoints}',
  (
    select jsonb_agg(
      t || jsonb_build_object(
        'image_media_asset_ids',
        case
          when t ? 'image_media_asset_ids' then t->'image_media_asset_ids'
          when t->>'image_media_asset_id' is null then '[]'::jsonb
          else jsonb_build_array(t->>'image_media_asset_id')
        end
      )
    )
    from jsonb_array_elements(followup_settings->'touchpoints') t
  )
)
where followup_settings is not null
  and followup_settings ? 'touchpoints';
```

Idempotent: if `image_media_asset_ids` is already present it's preserved as-is. The legacy `image_media_asset_id` key is **not** removed in this step.

Manual verification after Step B:
```sql
-- Every touchpoint that was eligible now has the array key.
select count(*) from public.chatbot_configs c,
     jsonb_array_elements(c.followup_settings->'touchpoints') t
 where c.followup_settings is not null
   and not (t ? 'image_media_asset_ids');
-- Expect: 0
```

### 4d. SQL contract migration (Step D — strip legacy key)

`supabase/migrations/<ts>_followup_drop_legacy_image_id.sql` (ship at least 7 days after Step B):

```sql
update public.chatbot_configs
set followup_settings = jsonb_set(
  followup_settings, '{touchpoints}',
  (select jsonb_agg(t - 'image_media_asset_id')
   from jsonb_array_elements(followup_settings->'touchpoints') t)
)
where followup_settings is not null;
```

Manual verification after Step D:
```sql
select count(*) from public.chatbot_configs c,
     jsonb_array_elements(c.followup_settings->'touchpoints') t
 where t ? 'image_media_asset_id';
-- Expect: 0
```

### 4e. API ownership check (`/api/chatbot/followup-settings`)

```ts
const allAssetIds = parsed.data.touchpoints.flatMap(t => t.image_media_asset_ids)
// existing ownership query against media_assets is unchanged
```

`action_page_id` collection unchanged.

## 5. UI

### 5a. `AutoFollowupForm.tsx`

`RowDraft`:
```ts
interface RowDraft {
  enabled: boolean
  value: number
  unit: Unit
  instruction: string
  images: { id: string; thumbUrl: string | null; name: string | null }[] // 0–3, ordered
  actionPageId: string | null
}
```

`settingsToState` / `stateToSettings` map between `image_media_asset_ids: string[]` and `images[]`.

**Image cell** (per row):
```
[ Image ]  [🖼 thumb1 ✕] [🖼 thumb2 ✕] [+ Add]
```
- × on each thumb removes that one image
- `+ Add` is hidden when `images.length === 3`
- Tapping `+ Add` opens the picker with `images.map(i => i.id)` as `initialSelectedIds`

Attachments-skipped hint copy is unchanged:
> *Attachments are skipped on nudges that fire after 24 hours.*

Condition: `images.length > 0 || actionPageId`.

### 5b. Thumb / name hydration

On mount, the form gathers every unique id across all rows' `images[]`. If any are unhydrated (`thumbUrl` and `name` both null), the form extends `/api/media/assets` to accept `?ids=a,b,c` and calls it once with the de-duplicated set. The route returns only the rows whose id is in the list AND whose `user_id` matches the caller (existing ownership pattern).

Missing assets (deleted from library) render a small "missing" placeholder with an × to clear from the row. Same vulnerability surface as today, just visible per-image.

### 5c. `MediaPickerModal.tsx` — multi-select

Props change:
```ts
interface Props {
  open: boolean
  onClose: () => void
  onSelect: (assets: PickedAsset[]) => void   // was: (asset: PickedAsset)
  initialSelectedIds?: string[]                // new
  maxSelect?: number                           // new (defaults to 1 for backward safety; we pass 3)
}
```

State:
- `selected: Map<string, AssetRow>` — insertion-ordered, preserves pick order
- Pre-populated from `initialSelectedIds` on open (matched against fetched assets; ids not in the user's library are silently dropped)

Tile UX:
- Click toggles membership
- Selected tile shows a filled overlay and an ordinal badge (`1`, `2`, `3`) reflecting position in `selected`
- Clicking a 4th tile when `maxSelect` is reached shows a transient "Up to 3 images" hint and does not toggle

Header / footer:
- Replace single `×` close with `[Cancel]  [Done (n)]`
- `Cancel` leaves the row's `images` unchanged
- `Done` submits `[...selected.values()]` as an ordered array (possibly empty — that's how a user clears all images via the picker) and closes the modal
- ESC and backdrop click behave as `Cancel`, not `Done`

Upload-new flow:
- On successful upload, the new asset is appended to `selected` (if under `maxSelect`) and the grid refreshes
- Modal does **not** auto-close (so the user can pick more or hit Done)

Only one caller exists today (`AutoFollowupForm`). Verified by grep.

## 6. Worker (`src/lib/followups/fire.ts`)

### 6a. Snapshot read with back-compat shim

```ts
function readImageIds(
  entry: SnapshotEntry & { image_media_asset_id?: string | null },
): string[] {
  if (Array.isArray(entry.image_media_asset_ids)) return entry.image_media_asset_ids
  return entry.image_media_asset_id ? [entry.image_media_asset_id] : []
}

const imageMediaAssetIds = readImageIds(entry)
const actionPageId = entry.action_page_id
```

The shim handles in-flight schedules whose `offsets_snapshot` was captured before this change. Remove after ≥7 days (Section 8, Step E).

### 6b. Attachment hint to the LLM

```ts
if (imageMediaAssetIds.length === 1) {
  // existing single-name lookup → "a photo (name)"
} else if (imageMediaAssetIds.length > 1) {
  hintParts.push(`${imageMediaAssetIds.length} photos`)
}
```

Rationale: 1 image keeps the existing wording so the LLM can reference it naturally; >1 just counts — listing N names mostly adds prompt noise.

### 6c. Send loop

```ts
if (canAttach) {
  for (const assetId of imageMediaAssetIds) {
    const imageUrl = await mintMediaAssetUrl(admin, assetId, schedule.user_id)
    if (!imageUrl) continue
    try {
      await sendOutbound({ ..., payload: { kind: 'image', imageUrl }, kind: 'bot' })
    } catch (e) {
      console.warn('[followups.fire] image send failed', schedule.id, assetId, msg(e))
    }
  }
  // existing action-page-button block unchanged (if actionPageId)
}
```

**Partial-failure: tolerated.** If image 2/3 fails, image 3 still attempts; the schedule advances regardless. Matches today's single-image behavior.

### 6d. Outside-window warn log

```ts
console.warn('[followups.fire] attachments skipped — outside 24h window', {
  scheduleId: schedule.id,
  slot: entry.slot,
  dropped_image_count: imageMediaAssetIds.length,
  dropped_action_page: !!actionPageId,
})
```

(`dropped_image: bool` → `dropped_image_count: number`. Log is internal.)

### 6e. Rate limits

3 image sends back-to-back fit inside Messenger's per-thread envelope. Bot already sustains higher throughput on personalized sends. No new throttling.

## 7. Tests

### 7a. Updated (rename only)

- `src/lib/followups/settings.test.ts` — `image_media_asset_id: null` → `image_media_asset_ids: []`; the "accepts touchpoints with image set" case becomes `image_media_asset_ids: [uuid]`; the "rejects non-UUID" case targets the array element
- `src/lib/followups/seed.test.ts` — fixture rename
- `src/lib/followups/fire.test.ts` — fixtures use `image_media_asset_ids: ['…']` (length 1) for parity with existing single-image cases
- `src/app/api/chatbot/followup-settings/route.test.ts` — request bodies use array shape; "asset belongs to another user" puts the bad id inside the array

### 7b. New — multi-image worker

In `fire.test.ts`, new `describe('handleFollowupSend — multi-image attachments')`:
- 3 images + page, RESPONSE → 5 sends, kinds `['text','image','image','image','button']`, URLs in pick order
- 2 images, no page, RESPONSE → kinds `['text','image','image']`
- 3 images, HUMAN_AGENT → kinds `['text']`; warn log has `dropped_image_count: 3`
- `mintMediaAssetUrl` returns null for image #2 → kinds `['text','image','image']` (#1 and #3 sent)
- `sendOutbound` throws on image #2 → all 3 image attempts made; schedule advances; no rethrow
- `attachmentHint`: 1 image → contains `"a photo"`; 3 images → contains `"3 photos"`

### 7c. New — back-compat shim

In `fire.test.ts`, new `describe('handleFollowupSend — legacy snapshot shape')`:
- Snapshot with old `image_media_asset_id: '…'` and no `image_media_asset_ids` → behaves identically to new shape with one image
- Snapshot with `image_media_asset_id: null` and no `image_media_asset_ids` → text only

### 7d. New — validation

In `route.test.ts`:
- Rejects array with >3 ids → 400
- Rejects array with a non-UUID element → 400
- Rejects when any id in any row's array belongs to another user → 400 `invalid_attachment_reference`
- Accepts mixed rows (row 0: 0 images; row 1: 3; row 2: 1) when all owned → 200

### 7e. New — loader back-compat

In `settings.test.ts` (new case):
- `loadFollowupSettings` returns a parsed object with `image_media_asset_ids` populated when the DB row stores the legacy `image_media_asset_id` shape

### 7f. Not done

- UI tests for `AutoFollowupForm.tsx` (no existing harness; out of scope)
- SQL migration unit tests (no harness in `supabase/`; manual verification queries in 4c and 4d cover this)

## 8. Rollout (expand-then-contract)

Four ordered steps, with rollback safety between each.

| Step | Change | Rollback safe? |
|------|--------|---------------|
| **A** | Ship code with loader normalizer (4b) + snapshot shim (6a) + new UI + new tests. App reads both shapes. | Yes — old DB shape still works because of the loader normalizer. |
| **B** | Run **expand-only** SQL migration (4c). Both `image_media_asset_id` and `image_media_asset_ids` live side-by-side on every row. | Yes — old code (singular reader, prior to Step A) still finds its field. |
| **C** | (Optional polish) Remove the loader normalizer in `settings.ts`. JSONB now always carries the array form. | Yes — DB has both keys; if a Step-A loader is needed again, it still works. |
| **D** | Run **contract** SQL migration (4d). Strip `image_media_asset_id` from every touchpoint. | Once D ships, rollback to pre-A code is no longer safe — confirm A+B have been stable in production for ≥7 days before D. |
| **E** | (≥7 days after Step A, after all pre-Step-A `offsets_snapshot` rows have drained) Remove the snapshot shim in `fire.ts`. `readImageIds` is deleted; reads `entry.image_media_asset_ids` directly. | Yes — at this point no live snapshots use the legacy shape. |

Practical schedule: A+B in the same deploy; C, D, E as small follow-up PRs.

## 9. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| In-flight schedule reads new code with old snapshot shape | `readImageIds` shim handles both (6a); shim stays until Step E |
| Code rolled back between Step A and Step B | Expand-only migration leaves the singular field intact, so pre-A code keeps working |
| Step D removes legacy key while old code somewhere still expects it | Don't ship D until A has been stable in prod ≥7 days; verify via Step C check that no caller still reads the singular field |
| Partial send failure leaves half-shipped sequence | Match today: log + continue + advance. No retry storms; no orphan jobs |
| Orphan image refs (asset deleted from library) | UI shows "missing" placeholder + × per image; worker's `mintMediaAssetUrl` null path silently skips that image |
| User picks the same image twice | `selected` is a Map keyed by id — duplicates impossible |
| LLM confused by "3 photos" hint | Hint is advisory; `generateMessage` already tolerates empty hint |
| Other callers of `MediaPickerModal` break under new signature | Grep confirms there is only one caller (`AutoFollowupForm`); plan will re-verify |

## 10. Decisions intentionally NOT made (YAGNI)

- Drag-to-reorder images
- Up/down arrow controls for image order
- Per-image captions
- Multiple action pages per touchpoint
- Retries on image-send failure (would require job-queue work)
- Bulk migration of `offsets_snapshot` (drains in ≤7 days)
- New DB columns (everything stays in the JSONB)
- UI test harness for `AutoFollowupForm.tsx`

## 11. Acceptance criteria

A reviewer can verify implementation against this spec by checking:

1. **Cap.** Form refuses a 4th image; modal refuses a 4th selection.
2. **Independence.** A row with `images.length > 0` and `actionPageId === null` sends `text + image(s)` only. A row with `images.length === 0` and `actionPageId !== null` sends `text + button` only.
3. **Order.** When a row has 3 images, the wire-level call sequence is `text → image(URL_1) → image(URL_2) → image(URL_3) → button(URL_page)` — URL order matches user pick order.
4. **Partial-failure.** Forcing `mintMediaAssetUrl` to return null for index 1 still results in indexes 0 and 2 being sent; schedule advances.
5. **Outside window.** With HUMAN_AGENT policy, only the text send fires; warn log carries `dropped_image_count`.
6. **In-flight schedule.** A pre-Step-A `offsets_snapshot` row containing `image_media_asset_id: '<uuid>'` and no `image_media_asset_ids` fires correctly with that one image sent.
7. **Loader.** `loadFollowupSettings` returns the array shape regardless of whether the DB row stores the legacy key, the new key, or both.
8. **Round-trip.** `settingsToState(stateToSettings(s)) === s` for any valid `FormState`.
9. **Migration idempotency.** Running the Step B migration twice in a row leaves data identical to running it once.
