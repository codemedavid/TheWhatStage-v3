# Auto Follow-Up Multi-Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each Auto Follow-Up touchpoint attach 0–3 images (was 0–1) while keeping the image and action page independently optional, with a safe expand-then-contract rollout.

**Architecture:** Bottom-up layered change. Schema (`settings.ts`) and validation route are updated first, with a loader normalizer that accepts both the legacy singular-field shape and the new array shape. Worker (`fire.ts`) gets a tiny snapshot-shape shim so existing `lead_followup_schedules.offsets_snapshot` rows keep firing correctly for ≤7 days. UI (`MediaPickerModal`, `AutoFollowupForm`) follows. A single expand-only SQL migration adds the array key without removing the singular one; a follow-up PR strips the legacy key after the rollout window.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod v3, Supabase (Postgres + JSONB), Vitest. Tests run with `pnpm test` (vitest run).

**Spec:** `docs/superpowers/specs/2026-05-25-followup-multi-image-design.md`

---

## File map

**Modify:**
- `src/lib/followups/settings.ts` — zod schema, `SnapshotEntry` type, `DEFAULT_FOLLOWUP_SETTINGS`, `resolveEnabledOffsets`, `loadFollowupSettings` normalizer
- `src/lib/followups/settings.test.ts` — rename `image_media_asset_id` → `image_media_asset_ids`; add multi-image + legacy-loader cases
- `src/lib/followups/seed.ts` — propagate `image_media_asset_ids` into snapshot rows
- `src/lib/followups/seed.test.ts` — fixture rename
- `src/lib/followups/fire.ts` — `readImageIds` shim, multi-image send loop, attachment-hint update, warn-log rename
- `src/lib/followups/fire.test.ts` — fixture rename; new multi-image + legacy-snapshot describes
- `src/app/api/chatbot/followup-settings/route.ts` — `flatMap` ownership check
- `src/app/api/chatbot/followup-settings/route.test.ts` — payloads use array shape; new validation cases
- `src/app/api/media/assets/route.ts` — optional `?ids=a,b,c` filter
- `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx` — `RowDraft.images[]`, thumb strip, hydration call, picker integration
- `src/app/(app)/dashboard/chatbot/_components/MediaPickerModal.tsx` — multi-select, props change
- `src/app/globals.css` — small additions for thumb strip + picker checkbox/ordinal badge

**Create:**
- `supabase/migrations/20260525000000_followup_multi_image_expand.sql` — expand-only migration

**NOT touched in this plan (follow-up PRs):**
- A second SQL migration that strips the legacy `image_media_asset_id` key from JSONB (ship ≥7 days after this plan deploys)
- Removal of the `readImageIds` shim in `fire.ts` (ship ≥7 days after this plan deploys)
- Removal of the loader normalizer in `settings.ts` (ship after the legacy-strip migration)

---

## Task 1: Update zod schema and defaults in `settings.ts`

**Files:**
- Modify: `src/lib/followups/settings.ts`
- Modify: `src/lib/followups/settings.test.ts`

This is the foundational change. Every other layer reads/writes through this schema.

- [ ] **Step 1: Rewrite the existing schema tests in `settings.test.ts` to use the array shape**

Open `src/lib/followups/settings.test.ts` and apply these edits.

Replace `validSettings` (currently around line 10-20):

```ts
function validSettings(overrides: Partial<FollowupSettings> = {}): FollowupSettings {
  return {
    enabled: true,
    touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t) => ({
      ...t,
      image_media_asset_ids: [],
      action_page_id: null,
    })),
    ...overrides,
  }
}
```

Then in each of these existing tests, replace the inline touchpoint literal so `image_media_asset_id: null` becomes `image_media_asset_ids: []`:

- "rejects offset_ms below 1 minute" (line ~34)
- "rejects offset_ms above 7 days" (line ~40)
- "rejects non-strictly-increasing enabled rows" (line ~46)
- "ignores ordering of disabled rows" (line ~52)
- "accepts touchpoints with image_media_asset_id and action_page_id set" — rename test to "accepts touchpoints with image_media_asset_ids and action_page_id set" and rewrite the touchpoint to:
  ```ts
  ok.touchpoints[0] = {
    enabled: true,
    offset_ms: 5 * 60_000,
    instruction: '',
    image_media_asset_ids: ['11111111-1111-4111-9111-111111111111'],
    action_page_id:        '22222222-2222-4222-9222-222222222222',
  }
  ```
- "defaults missing attachment fields to null" — rename to "defaults missing attachment fields to empty/null" and change the assertion to:
  ```ts
  expect(parsed.data.touchpoints[0].image_media_asset_ids).toEqual([])
  expect(parsed.data.touchpoints[0].action_page_id).toBeNull()
  ```
- "rejects non-UUID image_media_asset_id" — rename to "rejects non-UUID inside image_media_asset_ids array" and rewrite:
  ```ts
  bad.touchpoints[0] = {
    enabled: true,
    offset_ms: 5 * 60_000,
    instruction: '',
    image_media_asset_ids: ['not-a-uuid'],
    action_page_id: null,
  }
  ```

Add three new tests immediately after the "rejects non-UUID action_page_id" test:

```ts
  it('rejects more than 3 images on a touchpoint', () => {
    const bad = validSettings()
    bad.touchpoints[0] = {
      enabled: true,
      offset_ms: 5 * 60_000,
      instruction: '',
      image_media_asset_ids: [
        '11111111-1111-4111-9111-111111111111',
        '22222222-2222-4222-9222-222222222222',
        '33333333-3333-4333-9333-333333333333',
        '44444444-4444-4444-9444-444444444444',
      ],
      action_page_id: null,
    }
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('accepts exactly 3 images on a touchpoint', () => {
    const ok = validSettings()
    ok.touchpoints[0] = {
      enabled: true,
      offset_ms: 5 * 60_000,
      instruction: '',
      image_media_asset_ids: [
        '11111111-1111-4111-9111-111111111111',
        '22222222-2222-4222-9222-222222222222',
        '33333333-3333-4333-9333-333333333333',
      ],
      action_page_id: null,
    }
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(ok).success).toBe(true)
  })

  it('preserves image_media_asset_ids order through parse', () => {
    const ids = [
      '11111111-1111-4111-9111-111111111111',
      '22222222-2222-4222-9222-222222222222',
    ]
    const ok = validSettings()
    ok.touchpoints[0] = {
      enabled: true,
      offset_ms: 5 * 60_000,
      instruction: '',
      image_media_asset_ids: ids,
      action_page_id: null,
    }
    const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(ok)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.touchpoints[0].image_media_asset_ids).toEqual(ids)
  })
```

In the `resolveEnabledOffsets` describe block, find the tests that build touchpoints inline (e.g. "sorts ascending by offset_ms even if user reordered" at line ~182) and update those touchpoint literals to include `image_media_asset_ids: []` and `action_page_id: null` where they're missing — zod will reject them after the schema change otherwise.

- [ ] **Step 2: Run tests to confirm they now fail**

Run: `pnpm test src/lib/followups/settings.test.ts`
Expected: most tests fail — schema still expects `image_media_asset_id`. We're about to flip it.

- [ ] **Step 3: Update the zod schema, type, and defaults in `settings.ts`**

In `src/lib/followups/settings.ts`:

Add near the other constants at the top:
```ts
const MAX_IMAGES_PER_TOUCHPOINT = 3
```

Replace the `TouchpointSchema` (currently lines 18-24) with:
```ts
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

Replace the `SnapshotEntry` interface (currently lines 70-76) with:
```ts
export interface SnapshotEntry {
  offset_ms: number
  slot: number
  instruction: string
  image_media_asset_ids: string[]
  action_page_id: string | null
}
```

Replace every `image_media_asset_id: null` in `DEFAULT_FOLLOWUP_SETTINGS` (currently lines 60-66, seven touchpoints) with `image_media_asset_ids: []`.

Replace the `resolveEnabledOffsets` body's mapping (currently lines 82-89) — change the `.map(...)` that builds entries so its returned object reads:
```ts
.map((x) => ({
  slot: x.slot,
  offset_ms: x.t.offset_ms,
  instruction: x.t.instruction,
  image_media_asset_ids: x.t.image_media_asset_ids,
  action_page_id: x.t.action_page_id,
}))
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm test src/lib/followups/settings.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/settings.ts src/lib/followups/settings.test.ts
git commit -m "refactor(followups): plural image_media_asset_ids (0–3) in settings schema"
```

---

## Task 2: Loader normalizer for legacy stored shape

**Files:**
- Modify: `src/lib/followups/settings.ts`
- Modify: `src/lib/followups/settings.test.ts`

After Task 1, any row in `chatbot_configs.followup_settings` that still carries the old singular `image_media_asset_id` would fail to parse. We need `loadFollowupSettings` to upgrade legacy shapes pre-parse so the app keeps working between Task 1 deploy and the Task 14 migration.

- [ ] **Step 1: Add a failing test for the loader normalizer**

In `src/lib/followups/settings.test.ts`, inside the `describe('loadFollowupSettings', ...)` block, add this test before the closing brace:

```ts
  it('upgrades legacy stored shape (image_media_asset_id) to image_media_asset_ids', async () => {
    const legacy = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        enabled: t.enabled,
        offset_ms: t.offset_ms,
        instruction: t.instruction,
        // Legacy singular field, no array
        image_media_asset_id: i === 0 ? '11111111-1111-4111-9111-111111111111' : null,
        action_page_id: null,
      })),
    }
    const admin = makeAdmin({ data: { followup_settings: legacy }, error: null })
    const parsed = await loadFollowupSettings(admin, 'u1')
    expect(parsed.touchpoints[0].image_media_asset_ids).toEqual([
      '11111111-1111-4111-9111-111111111111',
    ])
    expect(parsed.touchpoints[1].image_media_asset_ids).toEqual([])
  })

  it('passes through new shape (image_media_asset_ids) unchanged', async () => {
    const fresh = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        enabled: t.enabled,
        offset_ms: t.offset_ms,
        instruction: t.instruction,
        image_media_asset_ids: i === 0 ? ['11111111-1111-4111-9111-111111111111'] : [],
        action_page_id: null,
      })),
    }
    const admin = makeAdmin({ data: { followup_settings: fresh }, error: null })
    const parsed = await loadFollowupSettings(admin, 'u1')
    expect(parsed.touchpoints[0].image_media_asset_ids).toEqual([
      '11111111-1111-4111-9111-111111111111',
    ])
  })
```

- [ ] **Step 2: Run tests to confirm the legacy case fails**

Run: `pnpm test src/lib/followups/settings.test.ts -t "upgrades legacy"`
Expected: FAIL — zod rejects the legacy `image_media_asset_id` field (it's not in the schema), so `loadFollowupSettings` returns `DEFAULT_FOLLOWUP_SETTINGS`.

- [ ] **Step 3: Add the pre-parse normalizer in `loadFollowupSettings`**

In `src/lib/followups/settings.ts`, add this helper function above `loadFollowupSettings`:

```ts
function normalizeStoredSettings(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const obj = raw as Record<string, unknown>
  const tps = obj.touchpoints
  if (!Array.isArray(tps)) return raw
  return {
    ...obj,
    touchpoints: tps.map((t) => {
      if (!t || typeof t !== 'object') return t
      const tp = t as Record<string, unknown>
      if (Array.isArray(tp.image_media_asset_ids)) return tp
      const legacy = typeof tp.image_media_asset_id === 'string' ? tp.image_media_asset_id : null
      return { ...tp, image_media_asset_ids: legacy ? [legacy] : [] }
    }),
  }
}
```

In `loadFollowupSettings`, change the parse step from:
```ts
  const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(data.followup_settings)
```
to:
```ts
  const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(normalizeStoredSettings(data.followup_settings))
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `pnpm test src/lib/followups/settings.test.ts`
Expected: all pass, including the two new loader tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/settings.ts src/lib/followups/settings.test.ts
git commit -m "feat(followups): loader normalizer accepts legacy image_media_asset_id"
```

---

## Task 3: API route ownership check uses `flatMap`

**Files:**
- Modify: `src/app/api/chatbot/followup-settings/route.ts`
- Modify: `src/app/api/chatbot/followup-settings/route.test.ts`

- [ ] **Step 1: Update existing route tests to use the array shape**

In `src/app/api/chatbot/followup-settings/route.test.ts`:

In the test "returns 400 when image_media_asset_id belongs to another user" (around line 159), rename to "returns 400 when image id inside the array belongs to another user", and replace the touchpoint mapping:

```ts
    const settingsWithImage = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        ...t,
        image_media_asset_ids: i === 0 ? ['11111111-1111-4111-9111-111111111111'] : [],
        action_page_id: null,
      })),
    }
```

In the test "returns 400 when action_page_id belongs to another user" (around line 190), update the touchpoint mapping the same way — `image_media_asset_ids: []` for every row:

```ts
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        ...t,
        image_media_asset_ids: [],
        action_page_id: i === 0 ? '22222222-2222-4222-9222-222222222222' : null,
      })),
```

In the test "persists when both attachment ids are owned by the user" (around line 221), update its touchpoint mapping:

```ts
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        ...t,
        image_media_asset_ids: i === 0 ? ['11111111-1111-4111-9111-111111111111'] : [],
        action_page_id:        i === 0 ? '22222222-2222-4222-9222-222222222222' : null,
      })),
```

Add three new tests inside the `describe('PUT /api/chatbot/followup-settings', ...)` block, before its closing brace:

```ts
  it('returns 400 when array contains > 3 ids', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const bad = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        ...t,
        image_media_asset_ids: i === 0 ? [
          '11111111-1111-4111-9111-111111111111',
          '22222222-2222-4222-9222-222222222222',
          '33333333-3333-4333-9333-333333333333',
          '44444444-4444-4444-9444-444444444444',
        ] : [],
        action_page_id: null,
      })),
    }
    const res = await PUT(makeReq({ settings: bad }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when array contains a non-UUID', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const bad = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        ...t,
        image_media_asset_ids: i === 0 ? ['not-a-uuid'] : [],
        action_page_id: null,
      })),
    }
    const res = await PUT(makeReq({ settings: bad }))
    expect(res.status).toBe(400)
  })

  it('persists with mixed-size arrays across rows when all owned', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const a = '11111111-1111-4111-9111-111111111111'
    const b = '22222222-2222-4222-9222-222222222222'
    const c = '33333333-3333-4333-9333-333333333333'
    const settings = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        ...t,
        image_media_asset_ids:
          i === 0 ? [] :
          i === 1 ? [a, b, c] :
          i === 2 ? [a] : [],
        action_page_id: null,
      })),
    }
    let upserted = false
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === 'media_assets') {
        return {
          select: () => ({
            in: () => ({
              eq: async () => ({ data: [{ id: a }, { id: b }, { id: c }], error: null }),
            }),
          }),
        }
      }
      return {
        upsert: async () => {
          upserted = true
          return { error: null }
        },
      }
    })

    const res = await PUT(makeReq({ settings }))
    expect(res.status).toBe(200)
    expect(upserted).toBe(true)
  })
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test src/app/api/chatbot/followup-settings/route.test.ts`
Expected: zod parsing fails on the new payloads (route still expects `image_media_asset_id`).

- [ ] **Step 3: Update the ownership check in `route.ts`**

In `src/app/api/chatbot/followup-settings/route.ts`, find the block that builds `allAssetIds` (currently lines 45-47):

```ts
  const allAssetIds = parsed.data.touchpoints
    .map((t) => t.image_media_asset_id)
    .filter((v): v is string => !!v)
```

Replace with:
```ts
  const allAssetIds = parsed.data.touchpoints.flatMap((t) => t.image_media_asset_ids)
```

Nothing else changes; the dedup-via-Set and the `media_assets` `.in()` query work identically against the flattened list.

- [ ] **Step 4: Run tests to confirm pass**

Run: `pnpm test src/app/api/chatbot/followup-settings/route.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chatbot/followup-settings/route.ts src/app/api/chatbot/followup-settings/route.test.ts
git commit -m "feat(followups): validate image_media_asset_ids array ownership"
```

---

## Task 4: Update `seed.ts` and `seed.test.ts` fixtures

**Files:**
- Modify: `src/lib/followups/seed.ts`
- Modify: `src/lib/followups/seed.test.ts`

`seed.ts` likely already forwards the touchpoint fields as-is, but the test fixtures have the old field name. We sync them.

- [ ] **Step 1: Confirm `seed.ts` is field-name-free**

Run: `grep -n "image_media_asset_id" src/lib/followups/seed.ts`
Expected: no output. `seed.ts` passes `snapshot` (returned from `resolveEnabledOffsets`) through without naming the field; the type change in Task 1 already propagates. No code edit in this file.

If the grep does find a hit (defensive — if seed.ts has been edited since this plan was written), rename every `image_media_asset_id` → `image_media_asset_ids` and every `: null` initializer → `: []`.

- [ ] **Step 2: Update `seed.test.ts` fixtures**

In `src/lib/followups/seed.test.ts`, search-and-replace inside touchpoint/snapshot literals:
- Every `image_media_asset_id: null` → `image_media_asset_ids: []`
- Every `image_media_asset_id: '<uuid>'` (e.g. the case around line 166) → `image_media_asset_ids: ['<uuid>']`

In the assertion around line 182:
```ts
expect(slot2!.image_media_asset_id).toBe('11111111-1111-4111-9111-111111111111')
```
becomes:
```ts
expect(slot2!.image_media_asset_ids).toEqual(['11111111-1111-4111-9111-111111111111'])
```

- [ ] **Step 3: Run tests**

Run: `pnpm test src/lib/followups/seed.test.ts`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/followups/seed.ts src/lib/followups/seed.test.ts
git commit -m "refactor(followups): seed uses image_media_asset_ids"
```

---

## Task 5: Worker — snapshot back-compat shim

**Files:**
- Modify: `src/lib/followups/fire.ts`
- Modify: `src/lib/followups/fire.test.ts`

This task adds the `readImageIds` helper and updates fire.ts to read the array (still preserving today's "send the one image" behavior). The multi-send loop arrives in Task 6.

- [ ] **Step 1: Update existing attachment-related tests to use the new shape**

In `src/lib/followups/fire.test.ts`, in the `describe('handleFollowupSend — attachments', ...)` block:

Update `attachSeed`'s default snapshot entry (around line 310):
```ts
      offsets_snapshot: [{
        slot: 0,
        offset_ms: 5 * 60_000,
        instruction: 'hello',
        image_media_asset_ids: [],
        action_page_id: null,
        ...snapshotEntry,
      }],
```

In each existing test that overrides `image_media_asset_id`, rewrite the override:
- "sends text → image → button in order when policy is RESPONSE and both attachments are set" (around line 327): change `image_media_asset_id: '111…'` to `image_media_asset_ids: ['11111111-1111-4111-9111-111111111111']`
- "sends text only when policy is HUMAN_AGENT, even with attachments configured" (around line 357): change `image_media_asset_id: '111…'` to `image_media_asset_ids: ['11111111-1111-4111-9111-111111111111']`. **Leave the `dropped_image: true` assertion alone in this task** — Task 6 lands the code rename to `dropped_image_count` and updates the assertion alongside it.

- "sends only text + image when action_page_id is null" (~line 378): `image_media_asset_ids: ['111…']`, `action_page_id: null`
- "skips the image silently when mintMediaAssetUrl returns null" (~line 389): `image_media_asset_ids: ['111…']`, `action_page_id: null`
- "passes a non-empty attachmentHint to the generator inside the window" (~line 401): `image_media_asset_ids: ['111…']`, `action_page_id: '222…'`. **Keep** the `expect.stringContaining('photo')` assertion — the singular hint copy "a photo (name)" still contains "photo".
- "passes empty attachmentHint when policy is HUMAN_AGENT" (~line 413): `image_media_asset_ids: ['111…']`, `action_page_id: '222…'`

Add this new describe block at the end of the file, before the very last `})`:

```ts
describe('handleFollowupSend — legacy snapshot shape (image_media_asset_id)', () => {
  function legacySeed(extra: Record<string, unknown> = {}) {
    return {
      schedule: {
        id: 's1', user_id: 'u1', lead_id: 'l1', thread_id: 't1', page_id: 'p1',
        started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
        next_offset_idx: 0,
        conversation_kind: 'real' as const,
        status: 'pending',
        offsets_snapshot: [{
          slot: 0,
          offset_ms: 5 * 60_000,
          instruction: 'hello',
          // Legacy singular field, no array
          image_media_asset_id: extra.image_media_asset_id ?? null,
          action_page_id: extra.action_page_id ?? null,
        }],
      },
      thread:  { id: 't1', psid: 'PSID', last_inbound_at: new Date(Date.now() - 60_000).toISOString(), full_name: 'Maria' },
      page:    { id: 'p1', page_access_token: 'enc-token' },
      lead:    { name: 'Maria' },
      chatbot: { persona: null, instructions: null },
      history: [],
    }
  }

  it('sends one image when legacy snapshot has image_media_asset_id set', async () => {
    const { admin } = makeAdmin(legacySeed({ image_media_asset_id: '11111111-1111-4111-9111-111111111111' }) as never)
    await handleFollowupSend(admin as never, { scheduleId: 's1' })
    const kinds = sendOutboundMock.mock.calls.map((c: [{ payload: { kind: string } }]) => c[0].payload.kind)
    expect(kinds).toEqual(['text', 'image'])
  })

  it('sends text only when legacy snapshot has image_media_asset_id null and no array', async () => {
    const { admin } = makeAdmin(legacySeed({ image_media_asset_id: null }) as never)
    await handleFollowupSend(admin as never, { scheduleId: 's1' })
    const kinds = sendOutboundMock.mock.calls.map((c: [{ payload: { kind: string } }]) => c[0].payload.kind)
    expect(kinds).toEqual(['text'])
  })
})
```

- [ ] **Step 2: Run tests to confirm legacy-snapshot ones fail and the rewritten attachment tests need the shim**

Run: `pnpm test src/lib/followups/fire.test.ts`
Expected: failures in both the legacy-snapshot tests and the rewritten attachment tests (worker still reads `image_media_asset_id` singular and ignores the new array).

- [ ] **Step 3: Add `readImageIds` shim and update reads in `fire.ts`**

In `src/lib/followups/fire.ts`, near the top of the file (after imports, before `insideWindowKind`), add:

```ts
// Back-compat: snapshots captured before the multi-image change carry
// `image_media_asset_id: string|null` instead of `image_media_asset_ids: string[]`.
// Remove this helper (and the cast in handleFollowupSend) once all in-flight
// schedules with the legacy shape have drained — max 7 days after this ships.
function readImageIds(
  entry: { image_media_asset_ids?: unknown; image_media_asset_id?: unknown },
): string[] {
  if (Array.isArray(entry.image_media_asset_ids)) {
    return entry.image_media_asset_ids.filter((v): v is string => typeof v === 'string')
  }
  if (typeof entry.image_media_asset_id === 'string') return [entry.image_media_asset_id]
  return []
}
```

In `handleFollowupSend`, replace the line:
```ts
  const imageMediaAssetId = entry.image_media_asset_id
```
with:
```ts
  const imageMediaAssetIds = readImageIds(entry)
```

For now, keep all downstream references working by adding (temporarily) right below the new line:
```ts
  const imageMediaAssetId = imageMediaAssetIds[0] ?? null
```

The alias is referenced by three downstream blocks in `fire.ts`:
1. The attachmentHint asset-name lookup (rewritten in Task 7)
2. The single-image send block (rewritten in Task 6)
3. The "outside 24h window" warn log (rewritten in Task 6)

Task 6 replaces (2) and (3) but leaves (1) alone, so **the alias stays in place after Task 6** and is only removed in Task 7 when the hint block is rewritten to use the array directly.

- [ ] **Step 4: Run tests to confirm pass**

Run: `pnpm test src/lib/followups/fire.test.ts`
Expected: all the legacy-snapshot tests pass; the rewritten attachment-array tests pass (each with 1 image, behavior identical to before).

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/fire.ts src/lib/followups/fire.test.ts
git commit -m "feat(followups): readImageIds shim accepts legacy and array snapshots"
```

---

## Task 6: Worker — multi-image send loop

**Files:**
- Modify: `src/lib/followups/fire.ts`
- Modify: `src/lib/followups/fire.test.ts`

- [ ] **Step 1a: Update the HUMAN_AGENT test's warn-log assertion**

In `src/lib/followups/fire.test.ts`, find the existing test "sends text only when policy is HUMAN_AGENT, even with attachments configured" (around line 357 in pre-Task-5 line numbers). Update its warn-log assertion (was `dropped_image: true`) to:
```ts
expect(warn).toHaveBeenCalledWith(
  '[followups.fire] attachments skipped — outside 24h window',
  expect.objectContaining({ dropped_image_count: 1, dropped_action_page: true }),
)
```

- [ ] **Step 1b: Add the new multi-image tests**

In `src/lib/followups/fire.test.ts`, add a new describe block immediately after the existing `describe('handleFollowupSend — attachments', ...)` block:

```ts
describe('handleFollowupSend — multi-image attachments', () => {
  function multiSeed(opts: { ids: string[]; pageId?: string | null }) {
    return {
      schedule: {
        id: 's1', user_id: 'u1', lead_id: 'l1', thread_id: 't1', page_id: 'p1',
        started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
        next_offset_idx: 0,
        conversation_kind: 'real' as const,
        status: 'pending',
        offsets_snapshot: [{
          slot: 0,
          offset_ms: 5 * 60_000,
          instruction: 'hello',
          image_media_asset_ids: opts.ids,
          action_page_id: opts.pageId ?? null,
        }],
      },
      thread:  { id: 't1', psid: 'PSID', last_inbound_at: new Date(Date.now() - 60_000).toISOString(), full_name: 'Maria' },
      page:    { id: 'p1', page_access_token: 'enc-token' },
      lead:    { name: 'Maria' },
      chatbot: { persona: null, instructions: null },
      history: [],
    }
  }

  it('sends text → 3 images → button in pick order when policy is RESPONSE', async () => {
    mintAssetMock.mockImplementation(async (_admin: unknown, id: string) =>
      `https://signed/${id}.jpg`,
    )
    const seed = multiSeed({
      ids: [
        '11111111-1111-4111-9111-111111111111',
        '22222222-2222-4222-9222-222222222222',
        '33333333-3333-4333-9333-333333333333',
      ],
      pageId: '44444444-4444-4444-9444-444444444444',
    })
    const { admin } = makeAdmin(seed)
    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(sendOutboundMock).toHaveBeenCalledTimes(5)
    const kinds = sendOutboundMock.mock.calls.map(
      (c: [{ payload: { kind: string } }]) => c[0].payload.kind,
    )
    expect(kinds).toEqual(['text', 'image', 'image', 'image', 'button'])
    const urls = sendOutboundMock.mock.calls
      .filter((c: [{ payload: { kind: string; imageUrl?: string } }]) => c[0].payload.kind === 'image')
      .map((c: [{ payload: { imageUrl: string } }]) => c[0].payload.imageUrl)
    expect(urls).toEqual([
      'https://signed/11111111-1111-4111-9111-111111111111.jpg',
      'https://signed/22222222-2222-4222-9222-222222222222.jpg',
      'https://signed/33333333-3333-4333-9333-333333333333.jpg',
    ])
  })

  it('sends text → 2 images when 2 ids and no page', async () => {
    const seed = multiSeed({
      ids: [
        '11111111-1111-4111-9111-111111111111',
        '22222222-2222-4222-9222-222222222222',
      ],
    })
    const { admin } = makeAdmin(seed)
    await handleFollowupSend(admin as never, { scheduleId: 's1' })
    const kinds = sendOutboundMock.mock.calls.map(
      (c: [{ payload: { kind: string } }]) => c[0].payload.kind,
    )
    expect(kinds).toEqual(['text', 'image', 'image'])
  })

  it('skips image #2 silently when mintMediaAssetUrl returns null for it', async () => {
    mintAssetMock.mockImplementation(async (_admin: unknown, id: string) =>
      id === '22222222-2222-4222-9222-222222222222' ? null : `https://signed/${id}.jpg`,
    )
    const seed = multiSeed({
      ids: [
        '11111111-1111-4111-9111-111111111111',
        '22222222-2222-4222-9222-222222222222',
        '33333333-3333-4333-9333-333333333333',
      ],
    })
    const { admin } = makeAdmin(seed)
    await handleFollowupSend(admin as never, { scheduleId: 's1' })
    const kinds = sendOutboundMock.mock.calls.map(
      (c: [{ payload: { kind: string } }]) => c[0].payload.kind,
    )
    expect(kinds).toEqual(['text', 'image', 'image'])
  })

  it('continues sending images after one send throws, then advances', async () => {
    const seed = multiSeed({
      ids: [
        '11111111-1111-4111-9111-111111111111',
        '22222222-2222-4222-9222-222222222222',
        '33333333-3333-4333-9333-333333333333',
      ],
    })
    let imageCallCount = 0
    sendOutboundMock.mockImplementation(async (args: { payload: { kind: string } }) => {
      if (args.payload.kind === 'image') {
        imageCallCount += 1
        if (imageCallCount === 2) throw new Error('boom')
      }
      return { sent: true, messageId: `fb${imageCallCount}` }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { admin, updates } = makeAdmin(seed)
    await expect(handleFollowupSend(admin as never, { scheduleId: 's1' })).resolves.toBeUndefined()
    // All three image sends were attempted.
    const imageCalls = sendOutboundMock.mock.calls.filter(
      (c: [{ payload: { kind: string } }]) => c[0].payload.kind === 'image',
    )
    expect(imageCalls).toHaveLength(3)
    // Schedule still advanced.
    const upd = updates.filter((u) => u.table === 'lead_followup_schedules')
    expect((upd[upd.length - 1].values as Record<string, unknown>).status).toBe('done')
    warn.mockRestore()
  })
})
```

- [ ] **Step 2: Run tests to confirm failures**

Run: `pnpm test src/lib/followups/fire.test.ts -t "multi-image"`
Expected: failures — `fire.ts` still only sends one image (from the temporary `imageMediaAssetId = imageMediaAssetIds[0] ?? null` line in Task 5).

- [ ] **Step 3: Replace the single-image send block with a loop**

In `src/lib/followups/fire.ts`:

**Keep** the `const imageMediaAssetId = imageMediaAssetIds[0] ?? null` alias from Task 5 — the attachment-hint block on line ~153 still needs it; Task 7 removes the alias.

Replace the entire post-send attachment block — the `if (canAttach) { … } else if (…) { console.warn(…) }` (currently lines 226-269, starting with `if (canAttach) {` and ending after the warn-log object's closing `})`) with:

```ts
  if (canAttach) {
    for (const assetId of imageMediaAssetIds) {
      const imageUrl = await mintMediaAssetUrl(admin, assetId, schedule.user_id)
      if (!imageUrl) continue
      try {
        await sendOutbound({
          admin,
          thread: { id: thread.id, psid: thread.psid, last_inbound_at: thread.last_inbound_at },
          pageToken,
          payload: { kind: 'image', imageUrl },
          kind: 'bot',
        })
      } catch (e) {
        console.warn(
          '[followups.fire] image send failed',
          schedule.id,
          assetId,
          e instanceof Error ? e.message : String(e),
        )
      }
    }
    if (actionPageId) {
      // existing button-send code, unchanged
      const url = await mintActionPageDeeplink(admin, actionPageId, schedule.user_id, {
        psid: thread.psid,
        pageId: schedule.page_id,
      })
      if (url) {
        try {
          await sendOutbound({
            admin,
            thread: { id: thread.id, psid: thread.psid, last_inbound_at: thread.last_inbound_at },
            pageToken,
            payload: { kind: 'button', text: 'Tap below to continue 👇', url, ctaLabel: 'View' },
            kind: 'bot',
          })
        } catch (e) {
          console.warn('[followups.fire] button send failed', schedule.id, e instanceof Error ? e.message : String(e))
        }
      }
    }
  } else if (imageMediaAssetIds.length > 0 || actionPageId) {
    console.warn('[followups.fire] attachments skipped — outside 24h window', {
      scheduleId: schedule.id,
      slot: entry.slot,
      dropped_image_count: imageMediaAssetIds.length,
      dropped_action_page: !!actionPageId,
    })
  }
```

The `else if` branch's warn-log key change (`dropped_image` → `dropped_image_count`) lands here too — Task 8 (separate task) is now redundant; collapse it into this task. (The plan reflects that — see Task 8 below.)

- [ ] **Step 4: Run tests to confirm pass**

Run: `pnpm test src/lib/followups/fire.test.ts`
Expected: all pass — single-image, multi-image, legacy-snapshot, HUMAN_AGENT, partial failure.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/fire.ts src/lib/followups/fire.test.ts
git commit -m "feat(followups): worker sends 0–3 images per touchpoint"
```

---

## Task 7: Worker — attachment hint for multiple photos

**Files:**
- Modify: `src/lib/followups/fire.ts`
- Modify: `src/lib/followups/fire.test.ts`

- [ ] **Step 1: Add failing test for "3 photos" hint**

In `src/lib/followups/fire.test.ts`, inside the `describe('handleFollowupSend — multi-image attachments', ...)` block (or appended at the very end of the new block in Task 6), add:

```ts
  it('passes "3 photos" attachmentHint to generator inside window when 3 ids set', async () => {
    const seed = multiSeed({
      ids: [
        '11111111-1111-4111-9111-111111111111',
        '22222222-2222-4222-9222-222222222222',
        '33333333-3333-4333-9333-333333333333',
      ],
    })
    const { admin } = makeAdmin(seed)
    await handleFollowupSend(admin as never, { scheduleId: 's1' })
    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({
      attachmentHint: expect.stringContaining('3 photos'),
    }))
  })

  it('passes singular "a photo" attachmentHint when exactly 1 id set', async () => {
    const seed = multiSeed({ ids: ['11111111-1111-4111-9111-111111111111'] })
    const { admin } = makeAdmin(seed)
    await handleFollowupSend(admin as never, { scheduleId: 's1' })
    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({
      attachmentHint: expect.stringContaining('a photo'),
    }))
  })
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm test src/lib/followups/fire.test.ts -t "3 photos"`
Expected: FAIL — current code says "a photo (name)" only when `imageMediaAssetId` (singular) is truthy.

- [ ] **Step 3: Update `attachmentHint` construction and drop the alias**

In `src/lib/followups/fire.ts`:

First, **delete** the alias line introduced in Task 5:
```ts
  const imageMediaAssetId = imageMediaAssetIds[0] ?? null
```

Then replace the existing block that builds `attachmentHint` (currently lines 150-171, the `if (canAttach) { … }` that fills `hintParts`):

```ts
  let attachmentHint = ''
  if (canAttach) {
    const hintParts: string[] = []
    if (imageMediaAssetIds.length === 1) {
      const { data: asset } = await admin
        .from('media_assets')
        .select('name')
        .eq('id', imageMediaAssetIds[0])
        .eq('user_id', schedule.user_id)
        .maybeSingle<{ name: string }>()
      if (asset?.name) hintParts.push(`a photo (${asset.name})`)
      else              hintParts.push('a photo')
    } else if (imageMediaAssetIds.length > 1) {
      hintParts.push(`${imageMediaAssetIds.length} photos`)
    }
    if (actionPageId) {
      const { data: pageRow } = await admin
        .from('action_pages')
        .select('title')
        .eq('id', actionPageId)
        .maybeSingle<{ title: string }>()
      if (pageRow?.title) hintParts.push(`a card linking to ${pageRow.title}`)
    }
    attachmentHint = hintParts.join(' and ')
  }
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `pnpm test src/lib/followups/fire.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/fire.ts src/lib/followups/fire.test.ts
git commit -m "feat(followups): attachmentHint counts photos when multiple"
```

---

## Task 8: (Skipped — folded into Task 6)

The warn-log key rename (`dropped_image` → `dropped_image_count`) was completed inside Task 6's send-loop replacement. No separate task remains. If you find the rename was missed in Task 6, do it now:

In `src/lib/followups/fire.ts`, ensure the `else if (...)` branch reads:
```ts
console.warn('[followups.fire] attachments skipped — outside 24h window', {
  scheduleId: schedule.id,
  slot: entry.slot,
  dropped_image_count: imageMediaAssetIds.length,
  dropped_action_page: !!actionPageId,
})
```

And in `fire.test.ts`, the HUMAN_AGENT test's warn-log assertion reads:
```ts
expect(warn).toHaveBeenCalledWith(
  '[followups.fire] attachments skipped — outside 24h window',
  expect.objectContaining({ dropped_image_count: 1, dropped_action_page: true }),
)
```

Run: `pnpm test src/lib/followups/fire.test.ts` — expected: all pass.

If anything changed here, commit:
```bash
git add src/lib/followups/fire.ts src/lib/followups/fire.test.ts
git commit -m "feat(followups): warn log uses dropped_image_count"
```

---

## Task 9: API route `/api/media/assets` — add optional `?ids=` filter

**Files:**
- Modify: `src/app/api/media/assets/route.ts`

Used by `AutoFollowupForm` to hydrate thumbnails for previously-saved image ids on mount.

- [ ] **Step 1: Add the `?ids=` filter to the GET handler**

In `src/app/api/media/assets/route.ts`, replace the `GET` function:

```ts
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const idsParam = url.searchParams.get('ids')
  const ids = idsParam
    ? Array.from(new Set(idsParam.split(',').map((s) => s.trim()).filter(Boolean)))
    : null

  // Cap defensive bounds: never accept > 100 ids in one request.
  if (ids && ids.length > 100) {
    return NextResponse.json({ error: 'too_many_ids' }, { status: 400 })
  }

  let query = supabase
    .from('media_assets')
    .select('id, name, slug, storage_path, mime_type, is_archived')
    .eq('user_id', user.id)
    .eq('is_archived', false)

  if (ids) {
    query = query.in('id', ids)
  } else {
    query = query.order('updated_at', { ascending: false }).limit(200)
  }

  const { data, error } = await query.returns<AssetRow[]>()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const signed = await Promise.all(
    (data ?? []).map(async (row) => {
      const { data: s } = await supabase.storage
        .from('media-assets')
        .createSignedUrl(row.storage_path, 3600)
      return { id: row.id, name: row.name, slug: row.slug, mime_type: row.mime_type, thumbUrl: s?.signedUrl ?? null }
    }),
  )
  return NextResponse.json({ assets: signed })
}
```

- [ ] **Step 2: Smoke test the route by hand (no existing test file for this route)**

In the dev server, while logged in:
```bash
curl -sS "http://localhost:3000/api/media/assets?ids=$(some-existing-asset-uuid)" --cookie-jar /tmp/c.txt -b /tmp/c.txt | jq
```
(Run from a logged-in browser DevTools "Copy as fetch" if cookie handling is fiddly.)
Expected: JSON with `assets` containing only that one row.

Also check that no-params still returns the full list:
```bash
curl -sS "http://localhost:3000/api/media/assets" -b /tmp/c.txt | jq '.assets | length'
```
Expected: a number ≤ 200.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/media/assets/route.ts
git commit -m "feat(media): /api/media/assets accepts ?ids= filter"
```

---

## Task 10: `MediaPickerModal` — multi-select rework

**Files:**
- Modify: `src/app/(app)/dashboard/chatbot/_components/MediaPickerModal.tsx`
- Modify: `src/app/globals.css` (small additions for ordinal badge)

No unit tests exist for the modal today — verification is via the dev server after Task 12 lands. We make the change carefully and call it out for manual smoke.

- [ ] **Step 1: Update the props and rewrite the modal**

Replace the entire contents of `src/app/(app)/dashboard/chatbot/_components/MediaPickerModal.tsx`:

```tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export interface PickedAsset {
  id: string
  name: string
  thumbUrl: string | null
}

interface AssetRow extends PickedAsset {
  slug: string
  mime_type: string
}

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (assets: PickedAsset[]) => void
  initialSelectedIds?: string[]
  maxSelect?: number
}

export function MediaPickerModal({
  open,
  onClose,
  onSelect,
  initialSelectedIds = [],
  maxSelect = 1,
}: Props) {
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overCap, setOverCap] = useState(false)
  // Insertion-ordered map: preserves pick order for the ordinal badge.
  const [selected, setSelected] = useState<Map<string, AssetRow>>(new Map())
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Reset selection on open: pre-populate from initialSelectedIds once the asset
  // list comes back from the server.
  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    setOverCap(false)
    setSelected(new Map())
    fetch('/api/media/assets')
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await r.text()))))
      .then((j: { assets: AssetRow[] }) => {
        setAssets(j.assets)
        if (initialSelectedIds.length > 0) {
          const next = new Map<string, AssetRow>()
          // Preserve the order from initialSelectedIds so the ordinal badges match.
          for (const id of initialSelectedIds) {
            const found = j.assets.find((a) => a.id === id)
            if (found) next.set(id, found)
          }
          setSelected(next)
        }
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
    // We intentionally do not depend on initialSelectedIds — open is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ESC key = cancel.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? assets.filter((a) => a.name.toLowerCase().includes(q)) : assets
  }, [assets, query])

  if (!open) return null

  function toggle(asset: AssetRow) {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(asset.id)) {
        next.delete(asset.id)
        setOverCap(false)
        return next
      }
      if (next.size >= maxSelect) {
        setOverCap(true)
        // auto-clear the warning after a moment
        window.setTimeout(() => setOverCap(false), 1500)
        return prev
      }
      next.set(asset.id, asset)
      return next
    })
  }

  async function handleUpload(file: File) {
    setUploading(true)
    setError(null)
    try {
      const folderRes = await fetch('/api/media/default-folder')
      if (!folderRes.ok) throw new Error(await folderRes.text())
      const { folderId } = (await folderRes.json()) as { folderId: string }

      const form = new FormData()
      form.append('folderId', folderId)
      form.append('files', file)
      const upRes = await fetch('/dashboard/media/upload', { method: 'POST', body: form })
      if (!upRes.ok) throw new Error(await upRes.text())
      const { assets: created } = (await upRes.json()) as { assets: Array<{ id: string; name: string; storage_path: string }> }
      const first = created[0]
      if (!first) throw new Error('Upload returned no asset')

      const listRes = await fetch('/api/media/assets')
      const listJson = (await listRes.json()) as { assets: AssetRow[] }
      setAssets(listJson.assets)
      const fresh = listJson.assets.find((a) => a.id === first.id)
      if (fresh) {
        setSelected((prev) => {
          if (prev.has(fresh.id)) return prev
          if (prev.size >= maxSelect) {
            setOverCap(true)
            window.setTimeout(() => setOverCap(false), 1500)
            return prev
          }
          const next = new Map(prev)
          next.set(fresh.id, fresh)
          return next
        })
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  function commit() {
    onSelect(Array.from(selected.values()).map((a) => ({ id: a.id, name: a.name, thumbUrl: a.thumbUrl })))
    onClose()
  }

  return (
    <div className="mpm-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mpm-panel" onClick={(e) => e.stopPropagation()}>
        <header className="mpm-head">
          <h3>{maxSelect > 1 ? `Pick up to ${maxSelect} images` : 'Pick an image'}</h3>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="mpm-tools">
          <input
            type="search"
            placeholder="Search by name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mpm-search"
          />
          <button
            type="button"
            className="mpm-upload-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : 'Upload new'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleUpload(f)
              e.target.value = ''
            }}
          />
        </div>

        {error && <p className="mpm-error" role="alert">{error}</p>}
        {overCap && <p className="mpm-cap-hint" role="status">Up to {maxSelect} images.</p>}
        {loading && <p className="mpm-empty">Loading…</p>}
        {!loading && filtered.length === 0 && !error && (
          <p className="mpm-empty">No images. Upload one to get started.</p>
        )}

        <ul className="mpm-grid">
          {filtered.map((a) => {
            const sel = selected.has(a.id)
            const ordinal = sel ? Array.from(selected.keys()).indexOf(a.id) + 1 : 0
            return (
              <li key={a.id}>
                <button
                  type="button"
                  className={`mpm-tile${sel ? ' is-selected' : ''}`}
                  onClick={() => toggle(a)}
                  aria-pressed={sel}
                >
                  {a.thumbUrl ? (
                    <img src={a.thumbUrl} alt={a.name} loading="lazy" />
                  ) : (
                    <div className="mpm-tile-placeholder">{a.name.slice(0, 2).toUpperCase()}</div>
                  )}
                  {sel && <span className="mpm-tile-badge" aria-hidden>{ordinal}</span>}
                  <span className="mpm-tile-name" title={a.name}>{a.name}</span>
                </button>
              </li>
            )
          })}
        </ul>

        <footer className="mpm-foot">
          <button type="button" className="mpm-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="mpm-btn mpm-btn-primary" onClick={commit}>
            Done ({selected.size})
          </button>
        </footer>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add CSS for the selection badge and selected-tile state**

Append to `src/app/globals.css`:

```css
.mpm-tile { position: relative; }
.mpm-tile.is-selected { outline: 2px solid var(--accent, #2563eb); outline-offset: -2px; border-radius: 6px; }
.mpm-tile-badge {
  position: absolute; top: 4px; left: 4px;
  min-width: 1.4rem; height: 1.4rem; padding: 0 0.35rem;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--accent, #2563eb); color: white;
  border-radius: 999px; font-size: 0.75rem; font-weight: 600;
}
.mpm-foot {
  display: flex; justify-content: flex-end; gap: 0.5rem;
  padding: 0.75rem; border-top: 1px solid var(--border, #e5e7eb);
}
.mpm-btn { padding: 0.4rem 0.9rem; border-radius: 6px; border: 1px solid var(--border, #e5e7eb); background: white; cursor: pointer; }
.mpm-btn-primary { background: var(--accent, #2563eb); color: white; border-color: var(--accent, #2563eb); }
.mpm-cap-hint { padding: 0.25rem 0.75rem; color: var(--muted, #6b7280); font-size: 0.85rem; }
```

(If existing selectors in `globals.css` use different names for `--accent` / `--border`, swap them to match — grep for `--accent` first.)

- [ ] **Step 3: Compile-check**

Run: `pnpm lint src/app/`
Expected: no errors related to the modal. (`AutoFollowupForm` will still compile because its current call uses the legacy `onSelect(picked: PickedAsset)` signature — about to break in Task 11. We're shipping these together but committing them separately.)

If lint flags `AutoFollowupForm` as broken (signature mismatch), continue — Task 11 fixes it.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/dashboard/chatbot/_components/MediaPickerModal.tsx src/app/globals.css
git commit -m "feat(chatbot): MediaPickerModal supports multi-select (1–N) with ordinal badges"
```

---

## Task 11: `AutoFollowupForm` — `RowDraft.images[]` + state mapping

**Files:**
- Modify: `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx`

We rewrite the row model and state mappers first; thumb strip UI lands in Task 12.

- [ ] **Step 1: Replace the `RowDraft` interface and mappers**

In `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx`:

Replace the `RowDraft` interface (currently lines 12-21):

```ts
interface RowImage {
  id: string
  thumbUrl: string | null
  name: string | null
}

interface RowDraft {
  enabled: boolean
  value: number
  unit: Unit
  instruction: string
  images: RowImage[] // 0–3, ordered
  actionPageId: string | null
}
```

Replace `settingsToState` (currently lines 47-64):

```ts
function settingsToState(s: FollowupSettings): FormState {
  return {
    enabled: s.enabled,
    rows: s.touchpoints.map((t) => {
      const { value, unit } = msToDraft(t.offset_ms)
      return {
        enabled: t.enabled,
        value,
        unit,
        instruction: t.instruction,
        images: t.image_media_asset_ids.map((id) => ({ id, thumbUrl: null, name: null })),
        actionPageId: t.action_page_id,
      }
    }),
  }
}
```

Replace `stateToSettings` (currently lines 66-77):

```ts
function stateToSettings(s: FormState): FollowupSettings {
  return {
    enabled: s.enabled,
    touchpoints: s.rows.map((r) => ({
      enabled: r.enabled,
      offset_ms: draftToMs(r),
      instruction: r.instruction,
      image_media_asset_ids: r.images.map((i) => i.id),
      action_page_id: r.actionPageId,
    })),
  }
}
```

- [ ] **Step 2: Compile-check**

Run: `pnpm lint src/app/\(app\)/dashboard/chatbot/`
Expected: errors in the JSX section of `AutoFollowupForm.tsx` (the still-untouched render code references `row.imageMediaAssetId`, `row.imageThumbUrl`, `row.imageName`). Task 12 fixes those.

- [ ] **Step 3: Commit (work-in-progress checkpoint)**

Don't commit yet — the file won't compile. Continue straight to Task 12 and commit once together.

---

## Task 12: `AutoFollowupForm` — thumb strip UI + picker integration

**Files:**
- Modify: `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx`
- Modify: `src/app/globals.css` (small additions for thumb strip)

- [ ] **Step 1: Replace the row's "Image" cell JSX**

In `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx`, find the `<div className="afu-row-attach">` block (currently lines 273-322). Inside it, replace the existing `<div className="afu-attach-item">` for the image (lines 274-299) with the new thumb-strip block:

```tsx
                <div className="afu-attach-item">
                  <span className="afu-attach-label">Images</span>
                  <div className="afu-attach-thumbs">
                    {row.images.map((img, imgIdx) => (
                      <div key={img.id} className="afu-attach-thumb-wrap">
                        {img.thumbUrl ? (
                          <img className="afu-attach-thumb" src={img.thumbUrl} alt={img.name ?? ''} />
                        ) : (
                          <span className="afu-attach-thumb afu-attach-thumb--placeholder" aria-hidden>📷</span>
                        )}
                        <button
                          type="button"
                          className="afu-attach-thumb-x"
                          aria-label={`Remove image ${imgIdx + 1}`}
                          disabled={!row.enabled}
                          onClick={() =>
                            setRow(idx, {
                              images: row.images.filter((_, j) => j !== imgIdx),
                            })
                          }
                        >×</button>
                      </div>
                    ))}
                    {row.images.length < 3 && (
                      <button
                        type="button"
                        className="afu-attach-add"
                        onClick={() => setPickerRowIdx(idx)}
                        disabled={!row.enabled}
                      >
                        + Add
                      </button>
                    )}
                  </div>
                </div>
```

Find the `<MediaPickerModal>` invocation (currently lines 328-339) and replace with the new multi-select signature:

```tsx
      <MediaPickerModal
        open={pickerRowIdx !== null}
        onClose={() => setPickerRowIdx(null)}
        maxSelect={3}
        initialSelectedIds={
          pickerRowIdx !== null ? state.rows[pickerRowIdx].images.map((i) => i.id) : []
        }
        onSelect={(picked) => {
          if (pickerRowIdx === null) return
          // Hydrate from picker payload (which carries thumbUrl + name).
          setRow(pickerRowIdx, {
            images: picked.map((p) => ({ id: p.id, thumbUrl: p.thumbUrl, name: p.name })),
          })
        }}
      />
```

Find the conditional rendering of the "attachments skipped" hint (currently around line 317):
```tsx
                {(row.imageMediaAssetId || row.actionPageId) && (
                  <p className="afu-row-attach-note">
                    Attachments are skipped on nudges that fire after 24 hours.
                  </p>
                )}
```
Replace with:
```tsx
                {(row.images.length > 0 || row.actionPageId) && (
                  <p className="afu-row-attach-note">
                    Attachments are skipped on nudges that fire after 24 hours.
                  </p>
                )}
```

- [ ] **Step 2: Add CSS for the thumb strip**

Append to `src/app/globals.css`:

```css
.afu-attach-thumbs {
  display: inline-flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;
}
.afu-attach-thumb-wrap { position: relative; display: inline-block; }
.afu-attach-thumb-x {
  position: absolute; top: -6px; right: -6px;
  width: 18px; height: 18px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--bg, white); color: var(--muted, #6b7280);
  border: 1px solid var(--border, #e5e7eb); border-radius: 999px;
  font-size: 0.85rem; line-height: 1; cursor: pointer; padding: 0;
}
.afu-attach-thumb-x:hover { color: #ef4444; }
.afu-attach-thumb-x:disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 3: Compile & smoke test**

Run: `pnpm lint src/app/\(app\)/dashboard/chatbot/`
Expected: clean.

Run the dev server:
```bash
pnpm dev
```
Open `/dashboard/chatbot`. Verify:
- Existing settings load (if you saved an image previously, it appears in the strip)
- Clicking "+ Add" opens the picker
- Multi-select up to 3 in the picker; "Done (n)" closes and updates the row
- ESC dismisses the picker as Cancel
- × on each thumb removes only that image
- Once a row has 3 images, "+ Add" is hidden
- Toggling the row disabled also disables the "+ Add" and per-thumb × buttons

- [ ] **Step 4: Commit Tasks 11 + 12 together**

```bash
git add src/app/\(app\)/dashboard/chatbot/_components/AutoFollowupForm.tsx src/app/globals.css
git commit -m "feat(chatbot): AutoFollowupForm supports 0–3 images per touchpoint"
```

---

## Task 13: Hydrate thumbnails on mount

**Files:**
- Modify: `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx`

After Task 11+12, rows that came from saved settings render with the 📷 placeholder until the user opens the picker. We fix that with a one-shot `?ids=` fetch on mount.

- [ ] **Step 1: Add the hydration `useEffect`**

In `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx`, at the top of the file alongside other React imports:

```ts
import { useEffect, useMemo, useState } from 'react'
```

Inside the `AutoFollowupForm` component, after the existing state declarations and before `function setRow(...)`, add:

```ts
  useEffect(() => {
    const unhydrated = Array.from(new Set(
      state.rows.flatMap((r) => r.images.filter((i) => !i.thumbUrl).map((i) => i.id)),
    ))
    if (unhydrated.length === 0) return
    let cancelled = false
    const ctrl = new AbortController()
    fetch(`/api/media/assets?ids=${encodeURIComponent(unhydrated.join(','))}`, { signal: ctrl.signal })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await r.text()))))
      .then((j: { assets: Array<{ id: string; name: string; thumbUrl: string | null }> }) => {
        if (cancelled) return
        const map = new Map(j.assets.map((a) => [a.id, a]))
        setState((s) => ({
          ...s,
          rows: s.rows.map((r) => ({
            ...r,
            images: r.images.map((img) =>
              img.thumbUrl ? img : (
                map.has(img.id)
                  ? { id: img.id, thumbUrl: map.get(img.id)!.thumbUrl, name: map.get(img.id)!.name }
                  : img
              ),
            ),
          })),
        }))
      })
      .catch((e) => {
        if ((e as Error).name === 'AbortError') return
        // Non-fatal: keep the 📷 placeholder; user can still re-pick.
        console.warn('[AutoFollowupForm] asset hydrate failed', e)
      })
    return () => {
      cancelled = true
      ctrl.abort()
    }
    // We deliberately only run when baseline changes (i.e. server-side settings refresh).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline])
```

- [ ] **Step 2: Smoke test**

Restart dev server (or hot-reload).
On `/dashboard/chatbot`, ensure a saved touchpoint with at least one image shows the actual thumbnail (not 📷) within a moment of page load. Reload several times to verify.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/dashboard/chatbot/_components/AutoFollowupForm.tsx
git commit -m "feat(chatbot): hydrate followup image thumbs on mount via /api/media/assets?ids="
```

---

## Task 14: SQL migration — expand only

**Files:**
- Create: `supabase/migrations/20260525000000_followup_multi_image_expand.sql`

Adds `image_media_asset_ids` to every touchpoint without removing `image_media_asset_id`. Rollback safe in either direction: pre-Task-1 code still sees the singular key; post-Task-1 code sees the array.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260525000000_followup_multi_image_expand.sql`:

```sql
-- =========================================================================
-- Auto Follow-Up: Multi-Image — expand step.
--
-- Add image_media_asset_ids (array) to every touchpoint in
-- chatbot_configs.followup_settings while LEAVING image_media_asset_id
-- (singular) in place. This makes the migration rollback-safe: pre-deploy
-- code keeps reading the singular field, post-deploy code reads the array.
-- A follow-up migration (≥7 days later) will strip the singular key.
--
-- This migration is idempotent: re-running it leaves data identical.
-- =========================================================================

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

- [ ] **Step 2: Apply the migration locally**

If using the Supabase CLI:
```bash
supabase db push
```
Or use the MCP migration tool if your environment uses remote-only migrations.

- [ ] **Step 3: Verify migration result**

Run this `select` against the dev database:
```sql
select count(*) from public.chatbot_configs c,
     jsonb_array_elements(c.followup_settings->'touchpoints') t
 where c.followup_settings is not null
   and not (t ? 'image_media_asset_ids');
```
Expected: `0` (every touchpoint now carries the array key).

Run it twice (re-run the migration first) to verify idempotency:
```bash
# Re-run, then re-check the count query — should still be 0.
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260525000000_followup_multi_image_expand.sql
git commit -m "db: expand followup_settings to carry image_media_asset_ids array"
```

---

## Task 15: End-to-end smoke test

**Files:** none

- [ ] **Step 1: Full vitest run**

Run: `pnpm test`
Expected: green.

- [ ] **Step 2: Lint and typecheck**

Run: `pnpm lint`
Expected: clean.

Run: `pnpm build`
Expected: clean (typecheck happens during build with Next.js).

- [ ] **Step 3: Manual E2E flow in the dev server**

1. Open `/dashboard/chatbot`.
2. On touchpoint 1: keep its existing config; add 2 images and 1 action page.
3. On touchpoint 2: 0 images, 1 action page.
4. On touchpoint 3: 3 images, 0 page.
5. On touchpoint 4: 1 image, 0 page.
6. Save.
7. Reload — verify thumbs hydrate within ~1s, action pages re-select correctly.
8. Trigger a quiet-lead followup (or wait for the natural schedule fire) and confirm the inbox shows `text → images in order → button` for the relevant touchpoint.

- [ ] **Step 4: Confirm in DB**

```sql
select user_id, jsonb_pretty(followup_settings)
from public.chatbot_configs
order by updated_at desc
limit 1;
```
Expected: every touchpoint carries both `image_media_asset_id` (legacy) and `image_media_asset_ids` (new array) — the legacy field will be cleared by a future contract migration.

- [ ] **Step 5: (No commit — verification step only)**

---

## Follow-up (separate PRs, NOT in this plan)

These are intentionally deferred per the spec's rollout plan:

1. **Loader normalizer removal** — once at least one deploy of this plan has been live in prod, remove `normalizeStoredSettings` from `settings.ts` and the `normalize…` call in `loadFollowupSettings`. The DB already carries the array shape; the normalizer is dead code.

2. **Contract migration** — ship `supabase/migrations/<timestamp>_followup_drop_legacy_image_id.sql`:
   ```sql
   update public.chatbot_configs
   set followup_settings = jsonb_set(
     followup_settings, '{touchpoints}',
     (select jsonb_agg(t - 'image_media_asset_id')
      from jsonb_array_elements(followup_settings->'touchpoints') t)
   )
   where followup_settings is not null;
   ```
   Verify with:
   ```sql
   select count(*) from public.chatbot_configs c,
        jsonb_array_elements(c.followup_settings->'touchpoints') t
    where t ? 'image_media_asset_id';
   ```
   Expected: `0`.

3. **Snapshot shim removal** — ≥7 days after this plan's deploy, remove `readImageIds` from `fire.ts` and use `entry.image_media_asset_ids` directly. By then all in-flight `lead_followup_schedules.offsets_snapshot` rows from before the deploy will have either finished or expired.
