# Per-Touchpoint Image & Action-Page Attachments for Auto Follow-Up

Date: 2026-05-24
Status: Proposed

## Goal

Let users attach a Media-Library image and/or an Action Page to each of the 7
silent auto follow-up touchpoints configured at `/dashboard/chatbot`. When a
touchpoint fires inside the 24h Messenger window, the engine sends the
existing AI-drafted text bubble, then the image, then a button card whose
single "View" button deeplinks to the action page (PSID signed in, like the
agent campaign does today). Used to make late-funnel nudges more concrete —
e.g. touchpoint #3 attaches the booking page; touchpoint #5 attaches a
product photo + the catalog page.

## Non-goals

- **No support for attachments outside the 24h window.** When the engine
  switches to the `HUMAN_AGENT` tag (touchpoints that fire past 24h), the
  text bubble still sends but attachments are silently skipped with a single
  `console.warn` per fire. Sending images / button cards under HUMAN_AGENT is
  a larger change (extending `sendMessengerImage` / `sendMessengerButton` to
  accept tag args) and is intentionally deferred.
- **No per-touchpoint customization of the button-card caption or label.**
  Caption is hardcoded to `"Tap below to continue 👇"`; button label to
  `"View"`. If the customization need surfaces, add `attachment_caption` /
  `cta_label` fields to the touchpoint row in a follow-up.
- **No support for attachment-only touchpoints.** Every touchpoint still has
  an AI-drafted text bubble; the image/page are extras.
- **No new database table or migration.** Everything rides on existing
  schema.

## Data model

### `FollowupSettings.touchpoints[i]` gains two optional UUIDs

```ts
Touchpoint = {
  enabled: boolean
  offset_ms: number
  instruction: string
  // new
  image_media_asset_id: string | null  // media_assets.id; null = no image
  action_page_id: string | null         // action_pages.id;  null = no page
}
```

zod (`src/lib/followups/settings.ts`):

```ts
const TouchpointSchema = z.object({
  enabled: z.boolean(),
  offset_ms: z.number().int().min(MIN_OFFSET_MS).max(MAX_OFFSET_MS),
  instruction: z.string().trim().max(MAX_INSTRUCTION_LEN).default(''),
  image_media_asset_id: z.string().uuid().nullable().default(null),
  action_page_id: z.string().uuid().nullable().default(null),
})
```

The `.nullable().default(null)` makes both fields optional on read, so
existing DB rows that predate this change parse cleanly with both attachments
absent.

`DEFAULT_FOLLOWUP_SETTINGS` keeps both fields at `null` for all 7
touchpoints — the feature is opt-in per touchpoint.

### Snapshot entry gains the same two fields

`SnapshotEntry` (also in `settings.ts`):

```ts
SnapshotEntry = {
  slot: number
  offset_ms: number
  instruction: string
  image_media_asset_id: string | null
  action_page_id: string | null
}
```

`resolveEnabledOffsets` copies both fields from each enabled touchpoint into
the snapshot entry. This preserves the existing invariant: in-flight
schedules are unaffected by later edits — a schedule seeded today with image
X attached to slot 3 keeps firing with image X even if the user removes it
tomorrow.

Persisted to `lead_followup_schedules.offsets_snapshot` (existing JSONB
column — no migration).

## API

### `PUT /api/chatbot/followup-settings`

No signature change. The route already validates against the zod schema (now
extended). In addition to the schema parse, the route does an **ownership
check** before upsert: for every non-null `image_media_asset_id` /
`action_page_id` in the payload, the route runs a `select id` against
`media_assets` and `action_pages` with `user_id = user.id`. Any orphan
reference returns `400 invalid_attachment_reference`.

```ts
const assetIds = parsed.data.touchpoints
  .map((t) => t.image_media_asset_id).filter(Boolean) as string[]
const pageIds = parsed.data.touchpoints
  .map((t) => t.action_page_id).filter(Boolean) as string[]
if (assetIds.length) {
  const { data, error } = await supabase
    .from('media_assets')
    .select('id').in('id', assetIds).eq('user_id', user.id)
  if (error || (data?.length ?? 0) !== new Set(assetIds).size) {
    return NextResponse.json({ error: 'invalid_attachment_reference' }, { status: 400 })
  }
}
// same shape for action_pages
```

RLS already restricts both reads to the owner, but the explicit count check
fails fast and produces a clear error instead of relying on the DB constraint
to fire later.

### `POST /dashboard/media/upload` — tiny addition

Returns the inserted asset row(s) so the picker can auto-select after
upload. Today the route returns `{ ok: true }`. Change the success branch to:

```ts
return NextResponse.json({ ok: true, assets: queuedAssets })
//                                       ^ [{ id, name, slug, storage_path, mime_type }]
```

Existing callers (the media dashboard) ignore extra fields so this is
non-breaking.

## Fire path

`src/lib/followups/fire.ts` — `handleFollowupSend` reads
`entry.image_media_asset_id` and `entry.action_page_id` from the snapshot.

### Step 1 — Always send the text bubble (unchanged)

```ts
const result = await sendOutbound({
  admin, thread, pageToken,
  payload: { kind: 'text', text },
  kind: sendKind,
})
if (!result.sent) { /* existing markFailed path */ return }
```

### Step 2 — Attachments, but only when `policy === RESPONSE`

`sendOutbound` returns `{ sent: true, messageId }` but does not surface the
chosen policy mode. Add a tiny helper that calls `resolveSendPolicy`
once *before* the text send and threads the result through:

```ts
const policy = await resolveSendPolicy(admin, thread.id, thread.last_inbound_at, sendKind)
// ...send text as today...
const canAttach = policy.mode === 'RESPONSE'  // strictly inside the 24h window
```

(Alternative considered: have `sendOutbound` return the policy mode. Rejected
to keep the existing public shape stable; the helper call is cheap and the
function is already async-DB-bound.)

When `canAttach` is true and the snapshot entry has an image:

```ts
if (entry.image_media_asset_id) {
  const imageUrl = await mintMediaAssetUrl(admin, entry.image_media_asset_id, schedule.user_id)
  if (imageUrl) {
    try {
      await sendOutbound({
        admin, thread, pageToken,
        payload: { kind: 'image', imageUrl },
        kind: 'bot',
      })
    } catch (e) {
      console.warn('[followups.fire] image send failed', schedule.id, e)
    }
  }
}
```

When `canAttach` is true and the snapshot entry has an action page:

```ts
if (entry.action_page_id) {
  const url = await mintActionPageDeeplink(admin, entry.action_page_id, {
    psid: thread.psid,
    pageId: thread.page_id,
  })
  if (url) {
    try {
      await sendOutbound({
        admin, thread, pageToken,
        payload: {
          kind: 'button',
          text: 'Tap below to continue 👇',
          url,
          ctaLabel: 'View',
        },
        kind: 'bot',
      })
    } catch (e) {
      console.warn('[followups.fire] button send failed', schedule.id, e)
    }
  }
}
```

When `canAttach` is false and either attachment is set:

```ts
console.warn('[followups.fire] attachments skipped — outside 24h window', {
  scheduleId: schedule.id,
  slot: entry.slot,
  dropped_image: !!entry.image_media_asset_id,
  dropped_action_page: !!entry.action_page_id,
})
```

### Step 3 — Schedule advance (unchanged)

`advanceSchedule(admin, schedule)` is called iff the **text** send succeeded.
Attachment failures log but do **not** roll back — the text already landed.

### New helpers, alongside `fire.ts`

`src/lib/followups/attachments.ts`:

```ts
export async function mintMediaAssetUrl(
  admin: SupabaseClient,
  assetId: string,
  userId: string,
): Promise<string | null> {
  const { data: asset } = await admin
    .from('media_assets')
    .select('storage_path, is_archived')
    .eq('id', assetId).eq('user_id', userId).maybeSingle()
  if (!asset || asset.is_archived) return null
  const { data: signed } = await admin.storage
    .from('media-assets')
    .createSignedUrl(asset.storage_path, 3600)  // 1 hour
  return signed?.signedUrl ?? null
}

export async function mintActionPageDeeplink(
  admin: SupabaseClient,
  pageId: string,
  recipient: { psid: string; pageId: string },
): Promise<string | null> {
  const { data: page } = await admin
    .from('action_pages')
    .select('slug, signing_secret')
    .eq('id', pageId).maybeSingle()
  if (!page) return null
  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60  // 30d
  return deeplinkActionPageUrl(page.signing_secret, {
    slug: page.slug,
    psid: recipient.psid,
    pageId: recipient.pageId,
    exp,
  })
}
```

Both return `null` instead of throwing so the fire path degrades gracefully
(asset was archived between seed and fire, action page was deleted, etc.).

The 1-hour signed URL TTL is comfortably longer than the Meta Send API
roundtrip; Meta caches the image via `is_reusable: true` (set inside
`sendMessengerImage`).

## Prompt integration

`src/lib/followups/generateMessage.ts` `GenerateArgs` gains an optional
`attachmentHint: string`. When non-empty, it's appended to the system prompt
*after* the touchpoint guide block:

```
This message will be followed by: {attachmentHint}.
Reference it naturally if it fits; do not paste a URL.
```

`attachmentHint` is built in `fire.ts` from the resolved attachment titles:

```ts
const hintParts: string[] = []
if (asset)      hintParts.push(`a photo (${asset.name})`)
if (actionPage) hintParts.push(`a card linking to ${actionPage.title}`)
const attachmentHint = hintParts.length ? hintParts.join(' and ') : ''
```

When `canAttach` is false, `attachmentHint` is intentionally empty — the
LLM shouldn't tease an attachment that won't arrive.

## UI — `AutoFollowupForm`

Each touchpoint row gains a second visual line beneath the existing "Guide"
input:

```
[✓] 3. [ 5 ] [hours ▾] after last reply
    Guide:    [ Share one concrete benefit...        ]  28/200
    Image:    [thumb] Change · Remove        ← media picker
    Page:     [ — none —                  ▾ ]  Clear     ← action page select
    ⓘ Attachments are skipped on nudges that fire after 24 hours.
```

- **Image picker** — a button (`Add image` when empty, `Change` when set) that
  opens `MediaPickerModal`. When an asset is chosen, the row stores the asset
  id and renders a 48×48 thumb (signed URL fetched once on modal close, kept
  in component state). `Remove` clears the field.
- **Action-page select** — a `<select>` populated from the user's
  `action_pages` (`id`, `title`, `kind`). The option label shows the title
  with the kind in parens (e.g. *"Get a slot — booking"*). Empty option
  `"— none —"` clears the field.
- **Inline 24h note** — shown once per row only when **either** attachment is
  set; styled as `.afu-row-attach-note` (muted text). Avoids screaming the
  caveat on every row.
- Both controls are disabled when the row's `enabled` toggle is off (matches
  existing value/unit/guide).
- `RowDraft` gains `imageMediaAssetId: string | null` and
  `actionPageId: string | null`. `settingsToState` / `stateToSettings`
  thread them through. The dirty check (`JSON.stringify` comparison)
  picks up changes for free.
- `validate()` is unchanged — both fields are independently nullable and
  carry no cross-row constraints. Server-side ownership check is the gate.

### `MediaPickerModal` (new)

`src/app/(app)/dashboard/chatbot/_components/MediaPickerModal.tsx`:

- Server-fetches the user's `media_assets` (active only, `is_archived=false`)
  via a small RSC loader on first open, then renders a grid with names +
  signed thumbnails (1-hour TTL fetched batch-style for the page).
- Search box filters client-side by name (cheap; typical user library < 200
  assets).
- **Upload new** button below the grid → posts a `FormData` to
  `/dashboard/media/upload` with the user's default folder id (resolves to
  the first folder, or creates a folder named `Auto Follow-Up` on first
  upload if the user has none). On success, takes the returned asset id from
  the augmented response (`{ ok, assets }`) and immediately selects it.
- `onSelect(assetId, thumbUrl, name)` callback closes the modal and hands
  the values back to the row.

Folder bootstrap helper (`src/lib/media/default-folder.ts`):

```ts
export async function ensureDefaultFolder(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from('media_folders').select('id')
    .eq('user_id', userId).order('position').limit(1).maybeSingle()
  if (existing) return existing.id
  const { data: created, error } = await supabase
    .from('media_folders')
    .insert({ user_id: userId, name: 'Auto Follow-Up', slug: 'auto-followup' })
    .select('id').single()
  if (error || !created) throw new Error('Failed to create default folder')
  return created.id
}
```

Called from a tiny new endpoint `GET /api/media/default-folder` that the
picker hits before showing its upload affordance.

### Server-component page load

`src/app/(app)/dashboard/chatbot/page.tsx`:

- Already loads `followup_settings` (passed into `AutoFollowupForm`).
- Adds a query for the user's `action_pages` (`id`, `title`, `kind`),
  filtered to non-archived only.
- Passes both into `AutoFollowupForm` as new props: `actionPages: Array<{ id, title, kind }>`.

The media picker fetches assets on demand (modal open) rather than at page
load, since users with large libraries shouldn't pay that cost on every visit
to the chatbot tab.

## Backward compatibility

- **Old settings rows** (no `image_media_asset_id` / `action_page_id` per
  touchpoint): zod `.nullable().default(null)` parses to `null` for both.
  Behavior is identical to today.
- **In-flight schedules** seeded before this change: snapshot entries also
  lack both fields. The fire path treats missing values as `null` via the
  same default. Schedules continue firing as today — text only.
- **No data migration.**

## Tests

- `src/lib/followups/settings.test.ts`
  - Schema accepts both new fields, defaults missing fields to `null`,
    rejects non-UUID values.
  - `resolveEnabledOffsets` propagates both fields into snapshot entries.
- `src/lib/followups/seed.test.ts`
  - Newly seeded schedule's snapshot carries the user's current attachments.
- `src/lib/followups/fire.test.ts`
  - **Inside-window path:** when both attachments are present, sends text,
    then image, then button — in that order; advance is called once.
  - **Outside-window path:** when both attachments are present but the
    policy resolves to HUMAN_AGENT, sends text only; the `console.warn` is
    emitted with `dropped_image: true, dropped_action_page: true`.
  - **Partial attachment:** image only, no action page → text + image only.
  - **Image asset deleted between seed and fire:** `mintMediaAssetUrl`
    returns null; text bubble still sends; warn logged; advance still
    called.
  - **Action page deleted:** same pattern.
  - **Image send fails (Meta error):** logged; text bubble was already sent;
    schedule still advances.
- `src/lib/followups/generateMessage.test.ts`
  - `attachmentHint` appended to system prompt when non-empty.
  - System prompt unchanged when `attachmentHint` is empty.
- `src/lib/followups/attachments.test.ts` (new)
  - `mintMediaAssetUrl` returns null for archived asset, asset owned by
    another user, or missing asset.
  - `mintActionPageDeeplink` returns null for missing page; signed URL
    contains PSID claim params.
- `src/app/api/chatbot/followup-settings/route.test.ts`
  - Round-trip with attachments present.
  - Old payload without attachment fields still loads.
  - **Foreign-user asset reference:** payload with an `image_media_asset_id`
    belonging to another user returns 400.
  - **Foreign-user page reference:** same shape for `action_page_id`.

## Files touched

- `src/lib/followups/settings.ts` — schema + defaults + snapshot fields
- `src/lib/followups/seed.ts` — snapshot persistence (verify pass-through)
- `src/lib/followups/fire.ts` — send sequence, policy probe, attachment
  helpers wired in
- `src/lib/followups/generateMessage.ts` — `attachmentHint` arg + prompt
  injection
- `src/lib/followups/attachments.ts` *(new)* — `mintMediaAssetUrl`,
  `mintActionPageDeeplink`
- `src/lib/media/default-folder.ts` *(new)* — `ensureDefaultFolder`
- `src/app/api/chatbot/followup-settings/route.ts` — ownership checks
- `src/app/(app)/dashboard/media/upload/route.ts` — return inserted asset
  rows
- `src/app/api/media/default-folder/route.ts` *(new)* — wraps
  `ensureDefaultFolder`
- `src/app/(app)/dashboard/chatbot/page.tsx` — load action pages, pass into
  form
- `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx` — new
  per-row attachment controls, `RowDraft` extension
- `src/app/(app)/dashboard/chatbot/_components/MediaPickerModal.tsx`
  *(new)* — library grid + upload-new flow
- `src/app/(app)/dashboard/chatbot/chatbot.css` — styles for `.afu-row-attach`
  and `.afu-row-attach-note`
- Tests listed above

No migration. No new tables. No changes to `messenger_jobs` or
`lead_followup_schedules` schema.
