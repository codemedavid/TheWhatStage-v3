# Per-Touchpoint Image & Action-Page Attachments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-touchpoint image + action-page attachments to the silent auto follow-up engine. Inside the 24h Messenger window, each fire sends text → image → button-card; outside the window, attachments are silently skipped and only the text bubble fires.

**Architecture:** Two optional UUID fields per touchpoint (`image_media_asset_id`, `action_page_id`) ride on the existing `chatbot_configs.followup_settings` JSONB column and the snapshot persisted on `lead_followup_schedules.offsets_snapshot`. No schema migration. The fire path probes `resolveSendPolicy` once, then sends extras only when `policy.mode === 'RESPONSE'`. UI extends `AutoFollowupForm` with a media-library picker modal (with upload-new) and an action-page `<select>` per row.

**Tech Stack:** Next.js App Router (server components for page load, client component for the form), Supabase JS client, vitest, zod for validation, `@/lib/messenger/outbound` for sends, `@/lib/action-pages/urls` for signed deeplinks.

**Spec:** `docs/superpowers/specs/2026-05-24-followup-attachments-design.md`

---

## File structure

**Modify:**
- `src/lib/followups/settings.ts`
- `src/lib/followups/settings.test.ts`
- `src/lib/followups/seed.test.ts`
- `src/lib/followups/generateMessage.ts`
- `src/lib/followups/generateMessage.test.ts`
- `src/lib/followups/fire.ts`
- `src/lib/followups/fire.test.ts`
- `src/app/api/chatbot/followup-settings/route.ts`
- `src/app/api/chatbot/followup-settings/route.test.ts`
- `src/app/(app)/dashboard/media/upload/route.ts`
- `src/app/(app)/dashboard/chatbot/page.tsx`
- `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx`
- `src/app/(app)/dashboard/chatbot/chatbot.css`

**Create:**
- `src/lib/followups/attachments.ts`
- `src/lib/followups/attachments.test.ts`
- `src/lib/media/default-folder.ts`
- `src/lib/media/default-folder.test.ts`
- `src/app/api/media/default-folder/route.ts`
- `src/app/(app)/dashboard/chatbot/_components/MediaPickerModal.tsx`

---

## Task 1: Extend `FOLLOWUP_SETTINGS_SCHEMA` with attachment fields

**Files:**
- Modify: `src/lib/followups/settings.ts`
- Test: `src/lib/followups/settings.test.ts`

- [ ] **Step 1: Write failing tests for the schema extension**

Append to `src/lib/followups/settings.test.ts`, inside the existing `describe('FOLLOWUP_SETTINGS_SCHEMA', ...)` block:

```ts
  it('accepts touchpoints with image_media_asset_id and action_page_id set', () => {
    const ok = validSettings()
    ok.touchpoints[0] = {
      enabled: true,
      offset_ms: 5 * 60_000,
      instruction: '',
      image_media_asset_id: '11111111-1111-1111-1111-111111111111',
      action_page_id:        '22222222-2222-2222-2222-222222222222',
    }
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(ok).success).toBe(true)
  })

  it('defaults missing attachment fields to null', () => {
    const minimal = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t) => ({
        enabled: t.enabled,
        offset_ms: t.offset_ms,
        instruction: t.instruction,
      })),
    }
    const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(minimal)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.touchpoints[0].image_media_asset_id).toBeNull()
      expect(parsed.data.touchpoints[0].action_page_id).toBeNull()
    }
  })

  it('rejects non-UUID image_media_asset_id', () => {
    const bad = validSettings()
    bad.touchpoints[0] = {
      enabled: true,
      offset_ms: 5 * 60_000,
      instruction: '',
      image_media_asset_id: 'not-a-uuid',
      action_page_id: null,
    }
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('rejects non-UUID action_page_id', () => {
    const bad = validSettings()
    bad.touchpoints[0] = {
      enabled: true,
      offset_ms: 5 * 60_000,
      instruction: '',
      image_media_asset_id: null,
      action_page_id: 'nope',
    }
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })
```

Also update the `validSettings` helper at the top of the file so the spread is consistent — replace its body with:

```ts
function validSettings(overrides: Partial<FollowupSettings> = {}): FollowupSettings {
  return {
    enabled: true,
    touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t) => ({
      ...t,
      image_media_asset_id: null,
      action_page_id: null,
    })),
    ...overrides,
  }
}
```

- [ ] **Step 2: Run the new tests, confirm they fail**

Run: `npx vitest run src/lib/followups/settings.test.ts -t "image_media_asset_id"`
Expected: at least one FAIL. Likely message: "Unrecognized key(s) in object" or "expected null, got undefined" depending on which test runs first.

- [ ] **Step 3: Extend the schema and the `Touchpoint`/`SnapshotEntry` shapes**

In `src/lib/followups/settings.ts`, replace the `TouchpointSchema` definition with:

```ts
const TouchpointSchema = z.object({
  enabled: z.boolean(),
  offset_ms: z.number().int().min(MIN_OFFSET_MS).max(MAX_OFFSET_MS),
  instruction: z.string().trim().max(MAX_INSTRUCTION_LEN).default(''),
  image_media_asset_id: z.string().uuid().nullable().default(null),
  action_page_id:        z.string().uuid().nullable().default(null),
})
```

In the same file, update `DEFAULT_FOLLOWUP_SETTINGS` to include both fields in every row. Replace the array with:

```ts
export const DEFAULT_FOLLOWUP_SETTINGS: FollowupSettings = {
  enabled: true,
  touchpoints: [
    { enabled: true, offset_ms: 5 * 60_000,     instruction: 'Quick light hello — just ask if still interested po.',          image_media_asset_id: null, action_page_id: null },
    { enabled: true, offset_ms: 60 * 60_000,    instruction: 'Friendly nudge — offer to answer any questions.',                image_media_asset_id: null, action_page_id: null },
    { enabled: true, offset_ms: 5 * 3_600_000,  instruction: 'Share one concrete benefit or social proof — keep it short.',   image_media_asset_id: null, action_page_id: null },
    { enabled: true, offset_ms: 8 * 3_600_000,  instruction: "Ask one focused question to surface what's blocking them.",     image_media_asset_id: null, action_page_id: null },
    { enabled: true, offset_ms: 12 * 3_600_000, instruction: 'Light reminder — emphasize convenience and flexibility.',       image_media_asset_id: null, action_page_id: null },
    { enabled: true, offset_ms: 18 * 3_600_000, instruction: 'Soft scarcity or a clear call to decide — no pressure.',        image_media_asset_id: null, action_page_id: null },
    { enabled: true, offset_ms: 24 * 3_600_000, instruction: 'Last graceful check — invite them to message anytime.',         image_media_asset_id: null, action_page_id: null },
  ],
}
```

Also update the `SnapshotEntry` interface:

```ts
export interface SnapshotEntry {
  offset_ms: number
  slot: number
  instruction: string
  image_media_asset_id: string | null
  action_page_id: string | null
}
```

And update `resolveEnabledOffsets` so the snapshot carries both fields:

```ts
export function resolveEnabledOffsets(settings: FollowupSettings): SnapshotEntry[] {
  if (!settings.enabled) return []
  const entries: SnapshotEntry[] = settings.touchpoints
    .map((t, slot) => ({ t, slot }))
    .filter((x) => x.t.enabled)
    .map((x) => ({
      slot: x.slot,
      offset_ms: x.t.offset_ms,
      instruction: x.t.instruction,
      image_media_asset_id: x.t.image_media_asset_id,
      action_page_id: x.t.action_page_id,
    }))
  if (entries.length === 0) return []
  entries.sort((a, b) => a.offset_ms - b.offset_ms)
  return entries
}
```

- [ ] **Step 4: Run the full settings test file, confirm green**

Run: `npx vitest run src/lib/followups/settings.test.ts`
Expected: all tests pass (existing + 4 new). If an old test like `'rejects offset_ms below 1 minute'` fails because its inline object literal no longer matches the new schema with required fields, fix the literal in the test — set both attachment fields to `null` explicitly. Do NOT make the new fields optional in the schema.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/settings.ts src/lib/followups/settings.test.ts
git commit -m "feat(followups): extend touchpoint schema with image + action-page fields"
```

---

## Task 2: Verify snapshot pass-through in seed flow

**Files:**
- Test: `src/lib/followups/seed.test.ts`

The `maybeScheduleFollowup` function in `seed.ts` already passes `snapshot` straight into the insert, so the new fields propagate for free. We add a regression test so a future refactor doesn't silently drop them.

- [ ] **Step 1: Write failing test**

Append a new test case to `src/lib/followups/seed.test.ts` inside `describe('maybeScheduleFollowup', ...)`:

```ts
  it('persists attachment fields from settings into offsets_snapshot', async () => {
    mockShouldSeed.mockResolvedValue({ ok: true, inboundCount: 2 })
    mockLoadSettings.mockResolvedValue({
      ...DEFAULT_FOLLOWUP_SETTINGS,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        ...t,
        image_media_asset_id: i === 2 ? '11111111-1111-1111-1111-111111111111' : null,
        action_page_id:        i === 2 ? '22222222-2222-2222-2222-222222222222' : null,
      })),
    })

    const { admin, captured } = makeAdmin()
    await maybeScheduleFollowup(admin as unknown as Parameters<typeof maybeScheduleFollowup>[0], {
      threadId: 't1', leadId: 'l1', userId: 'u1', pageId: 'p1',
      lastInboundAt: new Date().toISOString(),
    })

    const insert = captured.find((c) => c.table === 'lead_followup_schedules' && c.op === 'insert')
    expect(insert).toBeTruthy()
    const snapshot = (insert!.values as { offsets_snapshot: Array<Record<string, unknown>> }).offsets_snapshot
    const slot2 = snapshot.find((s) => s.slot === 2)
    expect(slot2).toBeTruthy()
    expect(slot2!.image_media_asset_id).toBe('11111111-1111-1111-1111-111111111111')
    expect(slot2!.action_page_id).toBe('22222222-2222-2222-2222-222222222222')
  })
```

- [ ] **Step 2: Run and confirm it passes** (no code change needed because `seed.ts` already inserts the full snapshot)

Run: `npx vitest run src/lib/followups/seed.test.ts`
Expected: all green, including the new test.

If the new test fails because the snapshot lacks the fields, the cause is Task 1's `resolveEnabledOffsets` change didn't land — re-check `settings.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/followups/seed.test.ts
git commit -m "test(followups): pin attachment fields persist into snapshot"
```

---

## Task 3: Add `attachmentHint` to `generateFollowupMessage`

**Files:**
- Modify: `src/lib/followups/generateMessage.ts`
- Test: `src/lib/followups/generateMessage.test.ts`

- [ ] **Step 1: Write failing tests for the prompt injection**

Append to `src/lib/followups/generateMessage.test.ts`:

```ts
import { buildSystemPromptForTest } from './generateMessage'
// If buildSystemPrompt is not exported yet, this import will fail — add the
// export in Step 3 alongside the production change.

describe('buildSystemPrompt — attachmentHint', () => {
  const baseArgs = {
    kind: 'real' as const,
    slot: 2,
    leadName: 'Maria',
    personalityBlock: 'Casual Taglish.',
    recentMessages: [],
    instruction: 'Share one concrete benefit.',
  }

  it('omits the attachment block when attachmentHint is empty', () => {
    const prompt = buildSystemPromptForTest({ ...baseArgs, attachmentHint: '' })
    expect(prompt).not.toContain('This message will be followed by')
  })

  it('appends the attachment block when attachmentHint is set', () => {
    const prompt = buildSystemPromptForTest({
      ...baseArgs,
      attachmentHint: 'a card linking to Booking',
    })
    expect(prompt).toContain('This message will be followed by: a card linking to Booking')
    expect(prompt).toContain('do not paste a URL')
  })
})
```

- [ ] **Step 2: Run the new tests, confirm they fail**

Run: `npx vitest run src/lib/followups/generateMessage.test.ts -t "attachmentHint"`
Expected: FAIL — either `buildSystemPromptForTest` is not exported or the prompt doesn't contain the new block.

- [ ] **Step 3: Extend `GenerateArgs` and `buildSystemPrompt`**

In `src/lib/followups/generateMessage.ts`, update `GenerateArgs`:

```ts
export interface GenerateArgs {
  kind: ConversationKind
  slot: number
  leadName: string | null
  personalityBlock: string
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  instruction: string
  attachmentHint?: string
}
```

In the same file, find the existing `buildSystemPrompt(args)` function and add this block right after the touchpoint `guide` definition (i.e., before the return statement that concatenates `prefix + rules + personality + fnHint + guide + ...`):

```ts
  const trimmedHint = (args.attachmentHint ?? '').trim()
  const attachmentBlock = trimmedHint
    ? `This message will be followed by: ${trimmedHint}.\n` +
      `Reference it naturally if it fits; do not paste a URL.\n\n`
    : ''
```

Then append `attachmentBlock` into the prompt concatenation in the position it would naturally appear (after the `guide` block — that's the spec's "after the touchpoint guide" placement).

If the function currently returns something like:

```ts
return `${prefix}${rules}\n\n${personality}${fnHint}${guide}You are writing follow-up #${args.slot + 1} of 7...`
```

change it to:

```ts
return `${prefix}${rules}\n\n${personality}${fnHint}${guide}${attachmentBlock}You are writing follow-up #${args.slot + 1} of 7...`
```

Read the full current function body (`src/lib/followups/generateMessage.ts:62` approx) and make the minimal edit; don't re-flow lines unrelated to the hint.

At the bottom of `generateMessage.ts`, export the prompt builder for tests:

```ts
export { buildSystemPrompt as buildSystemPromptForTest }
```

- [ ] **Step 4: Run and confirm green**

Run: `npx vitest run src/lib/followups/generateMessage.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/generateMessage.ts src/lib/followups/generateMessage.test.ts
git commit -m "feat(followups): inject attachment hint into the LLM system prompt"
```

---

## Task 4: Create `attachments.ts` helpers + tests

**Files:**
- Create: `src/lib/followups/attachments.ts`
- Create: `src/lib/followups/attachments.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/followups/attachments.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/action-pages/urls', () => ({
  deeplinkActionPageUrl: vi.fn((secret: string, claims: Record<string, unknown>) =>
    `https://app/a/${claims.slug}?psid=${claims.psid}&pid=${claims.pageId}&exp=${claims.exp}&sig=${secret.slice(0, 4)}`,
  ),
}))

import { mintMediaAssetUrl, mintActionPageDeeplink } from './attachments'

function makeAdmin(opts: {
  asset?: { storage_path: string; is_archived: boolean } | null
  signedUrl?: string | null
  page?: { slug: string; signing_secret: string } | null
} = {}) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.maybeSingle = async () => {
        if (table === 'media_assets') return { data: opts.asset ?? null, error: null }
        if (table === 'action_pages') return { data: opts.page  ?? null, error: null }
        return { data: null, error: null }
      }
      return chain
    },
    storage: {
      from(_bucket: string) {
        return {
          createSignedUrl: async (_path: string, _ttl: number) =>
            opts.signedUrl === null
              ? { data: null, error: new Error('no') }
              : { data: { signedUrl: opts.signedUrl ?? 'https://signed/url' }, error: null },
        }
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('mintMediaAssetUrl', () => {
  it('returns the signed URL for an active asset owned by the user', async () => {
    const admin = makeAdmin({ asset: { storage_path: 'u1/f1/a1.jpg', is_archived: false } })
    const url = await mintMediaAssetUrl(admin as never, 'a1', 'u1')
    expect(url).toBe('https://signed/url')
  })

  it('returns null when the asset is archived', async () => {
    const admin = makeAdmin({ asset: { storage_path: 'u1/f1/a1.jpg', is_archived: true } })
    const url = await mintMediaAssetUrl(admin as never, 'a1', 'u1')
    expect(url).toBeNull()
  })

  it('returns null when the asset is missing', async () => {
    const admin = makeAdmin({ asset: null })
    const url = await mintMediaAssetUrl(admin as never, 'a1', 'u1')
    expect(url).toBeNull()
  })

  it('returns null when the storage layer fails to sign', async () => {
    const admin = makeAdmin({
      asset: { storage_path: 'u1/f1/a1.jpg', is_archived: false },
      signedUrl: null,
    })
    const url = await mintMediaAssetUrl(admin as never, 'a1', 'u1')
    expect(url).toBeNull()
  })
})

describe('mintActionPageDeeplink', () => {
  it('returns the signed deeplink with PSID, pageId, and exp claims', async () => {
    const admin = makeAdmin({ page: { slug: 'booking', signing_secret: 'secret-xyz' } })
    const url = await mintActionPageDeeplink(admin as never, 'page-1', {
      psid: 'PSID123',
      pageId: 'pageuuid-456',
    })
    expect(url).toMatch(/https:\/\/app\/a\/booking\?psid=PSID123&pid=pageuuid-456&exp=\d+&sig=secr/)
  })

  it('returns null when the action page is missing', async () => {
    const admin = makeAdmin({ page: null })
    const url = await mintActionPageDeeplink(admin as never, 'page-1', {
      psid: 'PSID123',
      pageId: 'pageuuid-456',
    })
    expect(url).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails (module not found)**

Run: `npx vitest run src/lib/followups/attachments.test.ts`
Expected: FAIL — `Cannot find module './attachments'`.

- [ ] **Step 3: Create the implementation**

Create `src/lib/followups/attachments.ts`:

```ts
// src/lib/followups/attachments.ts
//
// Pure helpers for the auto-followup fire path. Both return null on any
// failure so the fire path can degrade gracefully — the text bubble has
// already landed by the time these run.

import type { SupabaseClient } from '@supabase/supabase-js'
import { deeplinkActionPageUrl } from '@/lib/action-pages/urls'

const SIGNED_URL_TTL_SECONDS = 60 * 60          // 1 hour
const DEEPLINK_TTL_SECONDS = 30 * 24 * 60 * 60  // 30 days

export async function mintMediaAssetUrl(
  admin: SupabaseClient,
  assetId: string,
  userId: string,
): Promise<string | null> {
  const { data: asset } = await admin
    .from('media_assets')
    .select('storage_path, is_archived')
    .eq('id', assetId)
    .eq('user_id', userId)
    .maybeSingle<{ storage_path: string; is_archived: boolean }>()
  if (!asset || asset.is_archived) return null

  const { data: signed, error } = await admin.storage
    .from('media-assets')
    .createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SECONDS)
  if (error || !signed?.signedUrl) return null
  return signed.signedUrl
}

export async function mintActionPageDeeplink(
  admin: SupabaseClient,
  pageId: string,
  recipient: { psid: string; pageId: string },
): Promise<string | null> {
  const { data: page } = await admin
    .from('action_pages')
    .select('slug, signing_secret')
    .eq('id', pageId)
    .maybeSingle<{ slug: string; signing_secret: string }>()
  if (!page) return null

  const exp = Math.floor(Date.now() / 1000) + DEEPLINK_TTL_SECONDS
  return deeplinkActionPageUrl(page.signing_secret, {
    slug: page.slug,
    psid: recipient.psid,
    pageId: recipient.pageId,
    exp,
  })
}
```

- [ ] **Step 4: Run the tests, confirm green**

Run: `npx vitest run src/lib/followups/attachments.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/attachments.ts src/lib/followups/attachments.test.ts
git commit -m "feat(followups): mint media-asset signed URLs and action-page deeplinks"
```

---

## Task 5: Wire `fire.ts` to send text → image → button card

**Files:**
- Modify: `src/lib/followups/fire.ts`
- Test: `src/lib/followups/fire.test.ts`

The existing fire test mocks `sendOutbound` and `isInsideWindow`. We add new mocks for `resolveSendPolicy` and the attachment helpers, then add tests covering all four outcomes (RESPONSE+attachments, HUMAN_AGENT+attachments-dropped, partial attachments, helper-returns-null).

- [ ] **Step 1: Write failing tests**

Open `src/lib/followups/fire.test.ts` and extend the existing `vi.hoisted(...)` block to include three new mocks:

```ts
const { sendOutboundMock, generateMock, shouldSeedMock, resolvePolicyMock, mintAssetMock, mintDeeplinkMock } = vi.hoisted(() => ({
  sendOutboundMock: vi.fn(),
  generateMock: vi.fn(),
  shouldSeedMock: vi.fn(),
  resolvePolicyMock: vi.fn(),
  mintAssetMock: vi.fn(),
  mintDeeplinkMock: vi.fn(),
}))
```

Replace the existing `vi.mock('@/lib/messenger/outbound', ...)` line with:

```ts
vi.mock('@/lib/messenger/outbound', () => ({
  sendOutbound: sendOutboundMock,
  resolveSendPolicy: resolvePolicyMock,
}))
```

Add new mocks below the existing `vi.mock` calls:

```ts
vi.mock('./attachments', () => ({
  mintMediaAssetUrl:        mintAssetMock,
  mintActionPageDeeplink:   mintDeeplinkMock,
}))
```

In the existing `beforeEach` (or add one if missing), reset all mocks and set sensible defaults:

```ts
beforeEach(() => {
  sendOutboundMock.mockReset()
  generateMock.mockReset()
  shouldSeedMock.mockReset()
  resolvePolicyMock.mockReset()
  mintAssetMock.mockReset()
  mintDeeplinkMock.mockReset()

  shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
  generateMock.mockResolvedValue('Hi Maria, balikan lang po.')
  sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fbm-1' })
  resolvePolicyMock.mockResolvedValue({ mode: 'RESPONSE' })
  mintAssetMock.mockResolvedValue('https://signed/img.jpg')
  mintDeeplinkMock.mockResolvedValue('https://app/a/booking?psid=p&pid=g&exp=1&sig=x')
})
```

Now add four new tests at the bottom of the existing `describe('handleFollowupSend', ...)` block (or in a fresh describe block):

```ts
describe('handleFollowupSend — attachments', () => {
  function baseSeed(snapshotEntry: Record<string, unknown> = {}) {
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
          image_media_asset_id: null,
          action_page_id: null,
          ...snapshotEntry,
        }],
      },
      thread:  { id: 't1', psid: 'PSID', last_inbound_at: new Date(Date.now() - 60_000).toISOString(), full_name: 'Maria' },
      page:    { id: 'p1', page_access_token: 'enc-token' },
      lead:    { name: 'Maria' },
      chatbot: { persona: null, instructions: null },
      history: [],
    }
  }

  it('sends text → image → button in order when policy is RESPONSE and both attachments are set', async () => {
    const seed = baseSeed({
      image_media_asset_id: '11111111-1111-1111-1111-111111111111',
      action_page_id:        '22222222-2222-2222-2222-222222222222',
    })
    const admin = makeAdmin(seed)
    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(sendOutboundMock).toHaveBeenCalledTimes(3)
    const kinds = sendOutboundMock.mock.calls.map((c) => c[0].payload.kind)
    expect(kinds).toEqual(['text', 'image', 'button'])
    expect(sendOutboundMock.mock.calls[1][0].payload).toMatchObject({
      kind: 'image', imageUrl: 'https://signed/img.jpg',
    })
    expect(sendOutboundMock.mock.calls[2][0].payload).toMatchObject({
      kind: 'button',
      text: 'Tap below to continue 👇',
      ctaLabel: 'View',
      url: 'https://app/a/booking?psid=p&pid=g&exp=1&sig=x',
    })
  })

  it('sends text only when policy is HUMAN_AGENT, even with attachments configured', async () => {
    resolvePolicyMock.mockResolvedValue({ mode: 'HUMAN_AGENT' })
    const seed = baseSeed({
      image_media_asset_id: '11111111-1111-1111-1111-111111111111',
      action_page_id:        '22222222-2222-2222-2222-222222222222',
    })
    const admin = makeAdmin(seed)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(sendOutboundMock).toHaveBeenCalledTimes(1)
    expect(sendOutboundMock.mock.calls[0][0].payload.kind).toBe('text')
    expect(mintAssetMock).not.toHaveBeenCalled()
    expect(mintDeeplinkMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      '[followups.fire] attachments skipped — outside 24h window',
      expect.objectContaining({ dropped_image: true, dropped_action_page: true }),
    )
    warn.mockRestore()
  })

  it('sends only text + image when action_page_id is null', async () => {
    const seed = baseSeed({
      image_media_asset_id: '11111111-1111-1111-1111-111111111111',
      action_page_id: null,
    })
    const admin = makeAdmin(seed)
    await handleFollowupSend(admin as never, { scheduleId: 's1' })
    const kinds = sendOutboundMock.mock.calls.map((c) => c[0].payload.kind)
    expect(kinds).toEqual(['text', 'image'])
  })

  it('skips the image silently when mintMediaAssetUrl returns null', async () => {
    mintAssetMock.mockResolvedValue(null)
    const seed = baseSeed({
      image_media_asset_id: '11111111-1111-1111-1111-111111111111',
      action_page_id: null,
    })
    const admin = makeAdmin(seed)
    await handleFollowupSend(admin as never, { scheduleId: 's1' })
    const kinds = sendOutboundMock.mock.calls.map((c) => c[0].payload.kind)
    expect(kinds).toEqual(['text'])
  })

  it('passes a non-empty attachmentHint to the generator inside the window', async () => {
    const seed = baseSeed({
      image_media_asset_id: '11111111-1111-1111-1111-111111111111',
      action_page_id:        '22222222-2222-2222-2222-222222222222',
    })
    // Make the admin return useful titles when fire.ts looks them up:
    seed.lead = { name: 'Maria' }
    const admin = makeAdmin(seed)
    await handleFollowupSend(admin as never, { scheduleId: 's1' })
    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({
      attachmentHint: expect.stringContaining('photo'),
    }))
  })

  it('passes empty attachmentHint when policy is HUMAN_AGENT', async () => {
    resolvePolicyMock.mockResolvedValue({ mode: 'HUMAN_AGENT' })
    const seed = baseSeed({
      image_media_asset_id: '11111111-1111-1111-1111-111111111111',
      action_page_id:        '22222222-2222-2222-2222-222222222222',
    })
    const admin = makeAdmin(seed)
    await handleFollowupSend(admin as never, { scheduleId: 's1' })
    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({
      attachmentHint: '',
    }))
  })
})
```

The existing fire tests must still pass. They use the older snapshot shape (no `image_media_asset_id` / `action_page_id`); the `?? null` defaults in `fire.ts` (Step 3 below) keep them working.

- [ ] **Step 2: Run the tests, confirm the new ones fail**

Run: `npx vitest run src/lib/followups/fire.test.ts -t "attachments"`
Expected: FAIL — `sendOutbound` only called once (text), policy probe not happening, mint helpers never called.

- [ ] **Step 3: Modify `fire.ts`**

Open `src/lib/followups/fire.ts`. Update the imports at the top:

```ts
import { sendOutbound, resolveSendPolicy } from '@/lib/messenger/outbound'
import { mintMediaAssetUrl, mintActionPageDeeplink } from './attachments'
```

Extend `ScheduleRow`'s `offsets_snapshot` typing and `handleFollowupSend` to pull attachment fields out of the entry. Locate the line where `entry` is destructured (around `const entry = snapshot[schedule.next_offset_idx]`). Below the existing `if (!entry) { await markDone(...); return }` early-return, add:

```ts
  const imageMediaAssetId = (entry as { image_media_asset_id?: string | null }).image_media_asset_id ?? null
  const actionPageId      = (entry as { action_page_id?: string | null }).action_page_id ?? null
```

Above the existing `const insideWindow = isInsideWindow(thread.last_inbound_at)` line, add a policy probe:

```ts
  const policy = await resolveSendPolicy(admin, thread.id, thread.last_inbound_at, insideWindowKind(thread.last_inbound_at))
  const canAttach = policy.mode === 'RESPONSE'
```

Where `insideWindowKind` is a tiny inline helper — add it near the top of the file (after imports):

```ts
function insideWindowKind(lastInboundAt: string | null): 'bot' | 'workflow_human_agent' {
  return isInsideWindow(lastInboundAt) ? 'bot' : 'workflow_human_agent'
}
```

Then build the attachment hint BEFORE the LLM call. Find the existing `const text = await generateFollowupMessage({ ... })` call and replace it with:

```ts
  let attachmentHint = ''
  if (canAttach) {
    const hintParts: string[] = []
    if (imageMediaAssetId) {
      const { data: asset } = await admin
        .from('media_assets')
        .select('name')
        .eq('id', imageMediaAssetId)
        .eq('user_id', schedule.user_id)
        .maybeSingle<{ name: string }>()
      if (asset?.name) hintParts.push(`a photo (${asset.name})`)
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

  const text = await generateFollowupMessage({
    kind: schedule.conversation_kind,
    slot: entry.slot,
    leadName,
    personalityBlock,
    recentMessages,
    instruction: entry.instruction ?? '',
    attachmentHint,
  })
```

The existing `sendKind` calculation and text send stay as they are. After the existing text-send block (the `if (!result.sent)` early-return), add the image + button sends:

```ts
  if (canAttach) {
    if (imageMediaAssetId) {
      const imageUrl = await mintMediaAssetUrl(admin, imageMediaAssetId, schedule.user_id)
      if (imageUrl) {
        try {
          await sendOutbound({
            admin,
            thread: { id: thread.id, psid: thread.psid, last_inbound_at: thread.last_inbound_at },
            pageToken,
            payload: { kind: 'image', imageUrl },
            kind: 'bot',
          })
        } catch (e) {
          console.warn('[followups.fire] image send failed', schedule.id, e instanceof Error ? e.message : String(e))
        }
      }
    }
    if (actionPageId) {
      const url = await mintActionPageDeeplink(admin, actionPageId, {
        psid: thread.psid,
        pageId: thread.page_id,
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
  } else if (imageMediaAssetId || actionPageId) {
    console.warn('[followups.fire] attachments skipped — outside 24h window', {
      scheduleId: schedule.id,
      slot: entry.slot,
      dropped_image: !!imageMediaAssetId,
      dropped_action_page: !!actionPageId,
    })
  }
```

Leave the existing `await advanceSchedule(...)` call in place (it runs after the attachments block).

- [ ] **Step 4: Run tests, confirm green**

Run: `npx vitest run src/lib/followups/fire.test.ts`
Expected: all tests pass (existing + 6 new).

Common failure: the existing `makeAdmin` helper in `fire.test.ts` doesn't handle the new `select('name')` query on `media_assets` or `select('title')` on `action_pages`. Extend its `maybeSingle` branches to return the seed-provided values. If you need to look at the helper, it's at the top of `fire.test.ts`.

If the existing `makeAdmin` doesn't differentiate by `select`, just return `{ name: 'My asset' }` and `{ title: 'My page' }` unconditionally for those two tables when the test seeds an attachment.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/fire.ts src/lib/followups/fire.test.ts
git commit -m "feat(followups): fire image + button card after the text bubble inside 24h window"
```

---

## Task 6: Add ownership checks to `PUT /api/chatbot/followup-settings`

**Files:**
- Modify: `src/app/api/chatbot/followup-settings/route.ts`
- Test: `src/app/api/chatbot/followup-settings/route.test.ts`

- [ ] **Step 1: Write failing tests**

Open `src/app/api/chatbot/followup-settings/route.test.ts` and add inside `describe('PUT /api/chatbot/followup-settings', ...)`:

```ts
  it('returns 400 when image_media_asset_id belongs to another user', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })

    const settingsWithImage = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        ...t,
        image_media_asset_id: i === 0 ? '11111111-1111-1111-1111-111111111111' : null,
        action_page_id: null,
      })),
    }

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === 'media_assets') {
        // Asset owned by another user → query returns zero rows
        return {
          select: () => ({
            in: () => ({
              eq: async () => ({ data: [], error: null }),
            }),
          }),
        }
      }
      // chatbot_configs upsert never reached
      return { upsert: async () => ({ error: null }) }
    })

    const res = await PUT(makeReq({ settings: settingsWithImage }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_attachment_reference')
  })

  it('returns 400 when action_page_id belongs to another user', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })

    const settingsWithPage = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        ...t,
        image_media_asset_id: null,
        action_page_id: i === 0 ? '22222222-2222-2222-2222-222222222222' : null,
      })),
    }

    supabaseFromMock.mockImplementation((table: string) => {
      if (table === 'action_pages') {
        return {
          select: () => ({
            in: () => ({
              eq: async () => ({ data: [], error: null }),
            }),
          }),
        }
      }
      return { upsert: async () => ({ error: null }) }
    })

    const res = await PUT(makeReq({ settings: settingsWithPage }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_attachment_reference')
  })

  it('persists when both attachment ids are owned by the user', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })

    const settings = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        ...t,
        image_media_asset_id: i === 0 ? '11111111-1111-1111-1111-111111111111' : null,
        action_page_id:        i === 0 ? '22222222-2222-2222-2222-222222222222' : null,
      })),
    }

    let upserted = false
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === 'media_assets') {
        return {
          select: () => ({
            in: () => ({
              eq: async () => ({ data: [{ id: '11111111-1111-1111-1111-111111111111' }], error: null }),
            }),
          }),
        }
      }
      if (table === 'action_pages') {
        return {
          select: () => ({
            in: () => ({
              eq: async () => ({ data: [{ id: '22222222-2222-2222-2222-222222222222' }], error: null }),
            }),
          }),
        }
      }
      if (table === 'chatbot_configs') {
        return {
          upsert: async () => { upserted = true; return { error: null } },
        }
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
    })

    const res = await PUT(makeReq({ settings }))
    expect(res.status).toBe(200)
    expect(upserted).toBe(true)
  })
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run src/app/api/chatbot/followup-settings/route.test.ts -t "invalid_attachment_reference|persists when both"`
Expected: FAIL — route doesn't perform any check, currently returns 200 even with foreign-user IDs.

- [ ] **Step 3: Add the ownership checks in the route**

Open `src/app/api/chatbot/followup-settings/route.ts`. After the existing zod parse and before the upsert, add:

```ts
  const allAssetIds = parsed.data.touchpoints
    .map((t) => t.image_media_asset_id)
    .filter((v): v is string => !!v)
  const allPageIds = parsed.data.touchpoints
    .map((t) => t.action_page_id)
    .filter((v): v is string => !!v)

  if (allAssetIds.length > 0) {
    const uniq = Array.from(new Set(allAssetIds))
    const { data, error } = await supabase
      .from('media_assets')
      .select('id')
      .in('id', uniq)
      .eq('user_id', user.id)
    if (error || (data?.length ?? 0) !== uniq.length) {
      return NextResponse.json({ error: 'invalid_attachment_reference' }, { status: 400 })
    }
  }

  if (allPageIds.length > 0) {
    const uniq = Array.from(new Set(allPageIds))
    const { data, error } = await supabase
      .from('action_pages')
      .select('id')
      .in('id', uniq)
      .eq('user_id', user.id)
    if (error || (data?.length ?? 0) !== uniq.length) {
      return NextResponse.json({ error: 'invalid_attachment_reference' }, { status: 400 })
    }
  }
```

- [ ] **Step 4: Run, confirm green**

Run: `npx vitest run src/app/api/chatbot/followup-settings/route.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chatbot/followup-settings/route.ts src/app/api/chatbot/followup-settings/route.test.ts
git commit -m "feat(followups): verify attachment ownership on settings PUT"
```

---

## Task 7: Augment media-upload route to return inserted assets

**Files:**
- Modify: `src/app/(app)/dashboard/media/upload/route.ts`

- [ ] **Step 1: Inspect current return shape**

Run: `npx grep -n "ok: true" src/app/\(app\)/dashboard/media/upload/route.ts`
Expected: matches the existing `return NextResponse.json({ ok: true })` on the success line.

- [ ] **Step 2: Modify the route to capture and return inserted assets**

In `src/app/(app)/dashboard/media/upload/route.ts`:

1. Near the top of the `try` block (just above `const created: string[] = []`), add a third tracker:

```ts
  const insertedAssets: Array<{ id: string; name: string; slug: string; storage_path: string; mime_type: string }> = []
```

2. Inside the loop, after the `await enqueueEmbedJob(...)` call and before the closing brace of the loop body, push the newly-created row info. The `inserted` variable already has `id` and `version`; the other fields are local (`assetName`, `assetSlug`, `path`, `file.type`):

```ts
      insertedAssets.push({
        id: inserted.id,
        name: assetName,
        slug: assetSlug,
        storage_path: path,
        mime_type: file.type,
      })
```

3. Replace the success return:

```ts
    return NextResponse.json({ ok: true, assets: insertedAssets })
```

- [ ] **Step 3: Smoke-check with type check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "media/upload" | head`
Expected: no errors specifically in `src/app/(app)/dashboard/media/upload/route.ts`. (Whole-project tsc may emit unrelated errors — only this file matters here.)

If you want a stronger check, the route has no dedicated test file and adding one would be out of scope for this task.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/dashboard/media/upload/route.ts
git commit -m "feat(media): return inserted asset rows from upload endpoint"
```

---

## Task 8: `ensureDefaultFolder` helper + `GET /api/media/default-folder`

**Files:**
- Create: `src/lib/media/default-folder.ts`
- Create: `src/lib/media/default-folder.test.ts`
- Create: `src/app/api/media/default-folder/route.ts`

- [ ] **Step 1: Write the failing tests for the helper**

Create `src/lib/media/default-folder.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ensureDefaultFolder } from './default-folder'

function makeClient(opts: {
  existing?: { id: string } | null
  insertResult?: { id: string } | { error: string }
}) {
  let insertCalled = false
  const client = {
    from(table: string) {
      if (table !== 'media_folders') throw new Error(`unexpected table: ${table}`)
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.order = () => chain
      chain.limit = () => chain
      chain.maybeSingle = async () => ({ data: opts.existing ?? null, error: null })
      chain.insert = () => ({
        select: () => ({
          single: async () => {
            insertCalled = true
            if ('error' in (opts.insertResult ?? {})) {
              return { data: null, error: new Error((opts.insertResult as { error: string }).error) }
            }
            return { data: opts.insertResult ?? { id: 'created-1' }, error: null }
          },
        }),
      })
      return chain
    },
  }
  return { client, wasInserted: () => insertCalled }
}

describe('ensureDefaultFolder', () => {
  it('returns the first existing folder without inserting', async () => {
    const { client, wasInserted } = makeClient({ existing: { id: 'existing-1' } })
    const id = await ensureDefaultFolder(client as never, 'u1')
    expect(id).toBe('existing-1')
    expect(wasInserted()).toBe(false)
  })

  it('inserts a new "Auto Follow-Up" folder when the user has none', async () => {
    const { client, wasInserted } = makeClient({ existing: null, insertResult: { id: 'fresh-1' } })
    const id = await ensureDefaultFolder(client as never, 'u1')
    expect(id).toBe('fresh-1')
    expect(wasInserted()).toBe(true)
  })

  it('throws when the insert fails', async () => {
    const { client } = makeClient({ existing: null, insertResult: { error: 'unique violation' } })
    await expect(ensureDefaultFolder(client as never, 'u1')).rejects.toThrow(/Failed to create default folder/)
  })
})
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run src/lib/media/default-folder.test.ts`
Expected: FAIL — `Cannot find module './default-folder'`.

- [ ] **Step 3: Create the helper**

Create `src/lib/media/default-folder.ts`:

```ts
// src/lib/media/default-folder.ts
//
// Returns the user's first media folder (by position), or creates an
// "Auto Follow-Up" folder if none exist. Used by the chatbot auto-followup
// MediaPickerModal so the "Upload new" affordance has a folder to land in.

import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_NAME = 'Auto Follow-Up'
const DEFAULT_SLUG = 'auto-followup'

export async function ensureDefaultFolder(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from('media_folders')
    .select('id')
    .eq('user_id', userId)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (existing) return existing.id

  const { data: created, error } = await supabase
    .from('media_folders')
    .insert({ user_id: userId, name: DEFAULT_NAME, slug: DEFAULT_SLUG })
    .select('id')
    .single<{ id: string }>()

  if (error || !created) {
    throw new Error('Failed to create default folder')
  }
  return created.id
}
```

- [ ] **Step 4: Run helper tests, confirm green**

Run: `npx vitest run src/lib/media/default-folder.test.ts`
Expected: all pass.

- [ ] **Step 5: Create the API route (no tests; tiny wrapper)**

Create `src/app/api/media/default-folder/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureDefaultFolder } from '@/lib/media/default-folder'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const folderId = await ensureDefaultFolder(supabase, user.id)
    return NextResponse.json({ folderId })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed' },
      { status: 500 },
    )
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/media/default-folder.ts src/lib/media/default-folder.test.ts src/app/api/media/default-folder/route.ts
git commit -m "feat(media): ensureDefaultFolder helper and GET /api/media/default-folder"
```

---

## Task 9: `MediaPickerModal` component

**Files:**
- Create: `src/app/(app)/dashboard/chatbot/_components/MediaPickerModal.tsx`

This component opens from `AutoFollowupForm` rows. It lists the user's active media assets (loaded via a small client-side fetch), supports name-search filtering, and has an "Upload new" affordance.

Since this is a client component that talks to existing endpoints, we don't TDD it — the integration coverage comes from manual smoke testing in Task 11. Keep the implementation lean.

- [ ] **Step 1: Add a list endpoint for active assets**

Check whether a JSON endpoint already returns the user's media assets. Run:

```bash
grep -rln "media_assets" src/app/api/media 2>/dev/null
```

If `/api/media/assets` (or similar) does not exist, create `src/app/api/media/assets/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface AssetRow {
  id: string
  name: string
  slug: string
  storage_path: string
  mime_type: string
  is_archived: boolean
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('media_assets')
    .select('id, name, slug, storage_path, mime_type, is_archived')
    .eq('user_id', user.id)
    .eq('is_archived', false)
    .order('updated_at', { ascending: false })
    .limit(200)
    .returns<AssetRow[]>()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sign URLs in a single batch for thumbnail rendering.
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

- [ ] **Step 2: Create `MediaPickerModal.tsx`**

Create `src/app/(app)/dashboard/chatbot/_components/MediaPickerModal.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'

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
  onSelect: (asset: PickedAsset) => void
}

export function MediaPickerModal({ open, onClose, onSelect }: Props) {
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Load library on open.
  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    fetch('/api/media/assets')
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(await r.text()))))
      .then((j: { assets: AssetRow[] }) => setAssets(j.assets))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const filtered = query.trim()
    ? assets.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()))
    : assets

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

      // Sign the thumb URL by re-fetching the asset list (cheapest path).
      const listRes = await fetch('/api/media/assets')
      const listJson = (await listRes.json()) as { assets: AssetRow[] }
      const fresh = listJson.assets.find((a) => a.id === first.id)
      onSelect({ id: first.id, name: first.name, thumbUrl: fresh?.thumbUrl ?? null })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="mpm-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="mpm-panel" onClick={(e) => e.stopPropagation()}>
        <header className="mpm-head">
          <h3>Pick an image</h3>
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
        {loading && <p className="mpm-empty">Loading…</p>}
        {!loading && filtered.length === 0 && !error && (
          <p className="mpm-empty">No images. Upload one to get started.</p>
        )}

        <ul className="mpm-grid">
          {filtered.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="mpm-tile"
                onClick={() => { onSelect({ id: a.id, name: a.name, thumbUrl: a.thumbUrl }); onClose() }}
              >
                {a.thumbUrl ? (
                  <img src={a.thumbUrl} alt={a.name} loading="lazy" />
                ) : (
                  <div className="mpm-tile-placeholder">{a.name.slice(0, 2).toUpperCase()}</div>
                )}
                <span className="mpm-tile-name" title={a.name}>{a.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles for these files**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "MediaPickerModal|media/assets|default-folder" | head`
Expected: no errors related to these files.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/media/assets/route.ts src/app/\(app\)/dashboard/chatbot/_components/MediaPickerModal.tsx
git commit -m "feat(chatbot): MediaPickerModal with library grid and upload-new"
```

---

## Task 10: Wire `AutoFollowupForm` with attachment controls + page server load

**Files:**
- Modify: `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx`
- Modify: `src/app/(app)/dashboard/chatbot/page.tsx`
- Modify: `src/app/(app)/dashboard/chatbot/chatbot.css`

- [ ] **Step 1: Pass `actionPages` into `AutoFollowupForm` from the page**

In `src/app/(app)/dashboard/chatbot/page.tsx`, the `actionPages` variable is already built. Locate the `followupContent` JSX:

```tsx
const followupContent = (
  <>
    <AutoFollowupForm initial={config.followupSettings} />
    <HumanTakeoverForm />
  </>
)
```

Change the `AutoFollowupForm` invocation to pass the action pages:

```tsx
<AutoFollowupForm
  initial={config.followupSettings}
  actionPages={actionPages.map((p) => ({ id: p.id, title: p.title }))}
/>
```

- [ ] **Step 2: Extend `AutoFollowupForm` types and state**

Open `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx`. Update:

1. The `RowDraft` interface — add two fields:

```ts
interface RowDraft {
  enabled: boolean
  value: number
  unit: Unit
  instruction: string
  imageMediaAssetId: string | null
  imageThumbUrl: string | null   // not persisted; only for preview
  imageName: string | null       // not persisted; only for preview
  actionPageId: string | null
}
```

2. The component signature — add a new prop:

```ts
interface ActionPageOption { id: string; title: string }

export function AutoFollowupForm({
  initial,
  actionPages,
}: {
  initial: FollowupSettings
  actionPages: ActionPageOption[]
}) {
```

3. `settingsToState` — populate the new fields from each touchpoint:

```ts
function settingsToState(s: FollowupSettings): FormState {
  return {
    enabled: s.enabled,
    rows: s.touchpoints.map((t) => {
      const { value, unit } = msToDraft(t.offset_ms)
      return {
        enabled: t.enabled,
        value, unit,
        instruction: t.instruction,
        imageMediaAssetId: t.image_media_asset_id,
        imageThumbUrl: null,
        imageName: null,
        actionPageId: t.action_page_id,
      }
    }),
  }
}
```

4. `stateToSettings` — strip preview-only fields:

```ts
function stateToSettings(s: FormState): FollowupSettings {
  return {
    enabled: s.enabled,
    touchpoints: s.rows.map((r) => ({
      enabled: r.enabled,
      offset_ms: draftToMs(r),
      instruction: r.instruction,
      image_media_asset_id: r.imageMediaAssetId,
      action_page_id: r.actionPageId,
    })),
  }
}
```

- [ ] **Step 3: Render the attachment controls inside each row**

In the same file, import the modal at the top:

```ts
import { MediaPickerModal, type PickedAsset } from './MediaPickerModal'
```

Inside the component body, add modal-routing state:

```ts
const [pickerRowIdx, setPickerRowIdx] = useState<number | null>(null)
```

Inside the `state.rows.map((row, idx) => { ... })` JSX, AFTER the existing `.afu-row-guide` block (and still inside the `<li>`), add:

```tsx
              <div className="afu-row-attach">
                <div className="afu-attach-item">
                  <span className="afu-attach-label">Image</span>
                  {row.imageMediaAssetId ? (
                    <div className="afu-attach-set">
                      {row.imageThumbUrl ? (
                        <img className="afu-attach-thumb" src={row.imageThumbUrl} alt={row.imageName ?? ''} />
                      ) : (
                        <span className="afu-attach-thumb afu-attach-thumb--placeholder" aria-hidden>📷</span>
                      )}
                      <span className="afu-attach-name">{row.imageName ?? 'Selected image'}</span>
                      <button type="button" className="afu-link-btn" onClick={() => setPickerRowIdx(idx)} disabled={!row.enabled}>Change</button>
                      <button
                        type="button"
                        className="afu-link-btn"
                        onClick={() => setRow(idx, { imageMediaAssetId: null, imageThumbUrl: null, imageName: null })}
                        disabled={!row.enabled}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="afu-attach-add" onClick={() => setPickerRowIdx(idx)} disabled={!row.enabled}>
                      + Add image
                    </button>
                  )}
                </div>

                <div className="afu-attach-item">
                  <span className="afu-attach-label">Page</span>
                  <select
                    className="afu-attach-select"
                    value={row.actionPageId ?? ''}
                    onChange={(e) => setRow(idx, { actionPageId: e.target.value || null })}
                    disabled={!row.enabled}
                    aria-label={`Touchpoint ${idx + 1} action page`}
                  >
                    <option value="">— none —</option>
                    {actionPages.map((p) => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                </div>

                {(row.imageMediaAssetId || row.actionPageId) && (
                  <p className="afu-row-attach-note">
                    Attachments are skipped on nudges that fire after 24 hours.
                  </p>
                )}
              </div>
```

And below the `<ol className="afu-rows">...</ol>` block (still inside the outer wrapper), add the modal mount:

```tsx
      <MediaPickerModal
        open={pickerRowIdx !== null}
        onClose={() => setPickerRowIdx(null)}
        onSelect={(picked: PickedAsset) => {
          if (pickerRowIdx === null) return
          setRow(pickerRowIdx, {
            imageMediaAssetId: picked.id,
            imageThumbUrl: picked.thumbUrl,
            imageName: picked.name,
          })
        }}
      />
```

- [ ] **Step 4: Add CSS**

Open `src/app/(app)/dashboard/chatbot/chatbot.css` and append:

```css
.afu-row-attach {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
  align-items: center;
}
.afu-attach-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.afu-attach-label {
  font-size: 12px;
  color: #6B6960;
  min-width: 44px;
}
.afu-attach-add {
  font-size: 12px;
  padding: 4px 10px;
  border: 1px dashed #C5C2BA;
  border-radius: 6px;
  background: transparent;
  color: #3F3D36;
  cursor: pointer;
}
.afu-attach-add:disabled { opacity: 0.5; cursor: default; }
.afu-attach-set { display: flex; align-items: center; gap: 6px; }
.afu-attach-thumb { width: 32px; height: 32px; object-fit: cover; border-radius: 4px; border: 1px solid #E8E6DE; }
.afu-attach-thumb--placeholder { display: inline-flex; align-items: center; justify-content: center; background: #F6F5F1; font-size: 14px; }
.afu-attach-name { font-size: 12px; color: #3F3D36; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.afu-attach-select {
  font-size: 12px;
  padding: 4px 8px;
  border: 1px solid #E8E6DE;
  border-radius: 6px;
  background: #FFFFFF;
  color: #1A1915;
  max-width: 220px;
}
.afu-row-attach-note {
  flex-basis: 100%;
  margin: 4px 0 0;
  font-size: 11px;
  color: #9C9A90;
  font-style: italic;
}

/* MediaPickerModal */
.mpm-backdrop {
  position: fixed; inset: 0;
  background: rgba(26,25,21,0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.mpm-panel {
  background: #FFFFFF;
  border-radius: 12px;
  width: min(720px, 92vw);
  max-height: 84vh;
  display: flex; flex-direction: column;
  border: 1px solid #E8E6DE;
  padding: 16px;
}
.mpm-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.mpm-head h3 { margin: 0; font-size: 16px; color: #1A1915; }
.mpm-head button { background: transparent; border: none; font-size: 20px; cursor: pointer; color: #6B6960; }
.mpm-tools { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
.mpm-search { flex: 1; padding: 6px 10px; border: 1px solid #E8E6DE; border-radius: 6px; font-size: 13px; }
.mpm-upload-btn { padding: 6px 12px; border: 1px solid #1F7A4D; background: #F2F8F4; color: #0F4A30; border-radius: 6px; font-size: 13px; cursor: pointer; }
.mpm-upload-btn:disabled { opacity: 0.5; cursor: default; }
.mpm-error { color: #B91C1C; font-size: 12px; margin: 0 0 8px; }
.mpm-empty { color: #9C9A90; font-size: 13px; text-align: center; margin: 20px 0; }
.mpm-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; overflow-y: auto; }
.mpm-tile { display: flex; flex-direction: column; align-items: stretch; gap: 4px; padding: 4px; border: 1px solid #E8E6DE; background: #FFFFFF; border-radius: 8px; cursor: pointer; width: 100%; }
.mpm-tile img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 4px; }
.mpm-tile-placeholder { width: 100%; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; background: #F6F5F1; border-radius: 4px; font-size: 28px; color: #9C9A90; }
.mpm-tile-name { font-size: 11px; color: #3F3D36; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 5: Smoke-check the type checker on the chatbot tree**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "chatbot/_components|chatbot/page" | head`
Expected: no errors related to these files. If `chatbot.followupSettings` doesn't typecheck (the `image_media_asset_id` / `action_page_id` are missing on the type returned by `getChatbotConfig`), open `src/lib/chatbot/config.ts` and update the typing for `followupSettings` — it already uses the `FollowupSettings` type from `@/lib/followups/settings`, so the change should propagate automatically. If a separate hand-rolled type is in use, sync the two fields there too.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/dashboard/chatbot/_components/AutoFollowupForm.tsx \
        src/app/\(app\)/dashboard/chatbot/page.tsx \
        src/app/\(app\)/dashboard/chatbot/chatbot.css
git commit -m "feat(chatbot): per-touchpoint image + action-page controls in AutoFollowupForm"
```

---

## Task 11: Manual end-to-end verification

This is a manual checklist — no automated test. Run after Task 10 lands.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Open `http://localhost:3000/dashboard/chatbot` (sign in if needed) and switch to the "Follow-up" tab.

- [ ] **Step 2: Verify the form renders the new controls**

Each of the 7 touchpoint rows shows:
- existing Guide input
- "Image: + Add image" button
- "Page: [— none —]" select populated with your published action pages
- (no inline note yet because nothing is attached)

- [ ] **Step 3: Pick an image from the library**

Click "+ Add image" on touchpoint 3. Modal opens, your media-library assets render with thumbnails. Click one. Modal closes. Thumb + name appear in the row. The inline note "Attachments are skipped on nudges that fire after 24 hours." appears.

- [ ] **Step 4: Upload a new image**

Click "+ Add image" on touchpoint 5 → "Upload new" → pick a local JPG/PNG. After upload, the asset is selected automatically. Visit `/dashboard/media` in a new tab; confirm the asset exists in the "Auto Follow-Up" folder (or your existing first folder if you had one).

- [ ] **Step 5: Pick an action page**

On touchpoint 4, select an action page from the dropdown. The inline note appears.

- [ ] **Step 6: Save**

Click Save. Toast shows "Auto follow-up updated". Refresh the page. All selections persist; thumbnails reappear (re-signed on next picker open since they're not persisted — verify by opening the picker again).

- [ ] **Step 7: Trigger a real send**

In a separate Messenger conversation with the page, send an inbound message as a test lead. Wait for the next-due touchpoint (or use the dashboard to manually force-run the followup cron at `/api/cron/followups-tick` — see how existing tests invoke it). Confirm:
- Inside 24h: text bubble → image → button card arrive in order in Messenger.
- The button card's "View" links to the action page with the right PSID claim.
- After 24h: only the text bubble arrives; server logs show `[followups.fire] attachments skipped — outside 24h window`.

- [ ] **Step 8: Verify foreign-asset rejection**

Use a database client (Supabase SQL editor) to manually craft a PUT payload with an `image_media_asset_id` belonging to another user. Send via `curl`:

```bash
curl -X PUT http://localhost:3000/api/chatbot/followup-settings \
  -H "content-type: application/json" \
  --cookie "<session cookie>" \
  -d '{ "settings": { "enabled": true, "touchpoints": [...with foreign UUID...] } }'
```

Expected: HTTP 400, `{"error":"invalid_attachment_reference"}`.

- [ ] **Step 9: Commit nothing — this is verification only**

If any check fails, file the discrepancy and fix in a follow-up task before declaring the feature done.

---

## Self-review summary

**Spec coverage:**
- §Data model → Task 1 (schema + snapshot fields), Task 2 (snapshot pass-through).
- §API → Task 6 (ownership check on PUT), Task 7 (media upload returns assets), Task 8 (default-folder helper + route).
- §Fire path → Task 5 (text → image → button, policy probe, attachment hint built from titles, attachment helpers used).
- §Prompt integration → Task 3 (attachmentHint in GenerateArgs + prompt block).
- §UI → Task 9 (MediaPickerModal), Task 10 (AutoFollowupForm controls + page server load + CSS).
- §Backward compatibility → covered implicitly by `.nullable().default(null)` (Task 1) and `?? null` fallbacks in fire.ts (Task 5).
- §Tests → covered alongside each task.

**Placeholders / vagueness:** None. Every step shows the exact code or command.

**Type consistency:** `image_media_asset_id` / `action_page_id` snake_case throughout the schema, snapshot, route, and zod (matches DB convention). Client-side `RowDraft` uses camelCase `imageMediaAssetId` / `actionPageId` (matches React convention), with explicit mapping in `settingsToState` / `stateToSettings`. `PickedAsset` shape (`id`, `name`, `thumbUrl`) consistent between `MediaPickerModal` and the form.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-24-followup-attachments.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
