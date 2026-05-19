# Auto Follow-Up Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-user "Auto Follow-Up" tab on `/dashboard/chatbot` that lets users toggle the silent auto-followup engine on/off, enable/disable each of the 7 touchpoint slots, and set each slot's interval (1 min – 7 days).

**Architecture:** Settings are stored as JSONB on `chatbot_configs.followup_settings`. At seed time, the engine resolves the user's enabled offsets into a compact `lead_followup_schedules.offsets_snapshot` array (with original slot indices preserved for `FALLBACK_POOL` mapping). In-flight schedules ride out the snapshot they were seeded with; settings changes apply only to new seeds. A new client-side tabbed UI on the chatbot page hosts the form and persists via `PUT /api/chatbot/followup-settings`.

**Tech Stack:** Next.js App Router (Server Components + Client Components), Supabase Postgres + RLS, zod 4 for validation, Vitest for tests, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-05-19-auto-followup-settings-design.md`

---

## File Structure

**New files:**
- `supabase/migrations/20260519000000_followup_settings.sql` — DB columns + backfill
- `src/lib/followups/settings.ts` — zod schema, defaults, `loadFollowupSettings`, `resolveEnabledOffsets`
- `src/lib/followups/settings.test.ts` — unit tests for schema + resolve + load
- `src/app/api/chatbot/followup-settings/route.ts` — GET/PUT API
- `src/app/api/chatbot/followup-settings/route.test.ts` — API tests
- `src/app/(app)/dashboard/chatbot/_components/ChatbotTabs.tsx` — tab shell + URL sync
- `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx` — the form
- `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.css` — form styles (matches chatbot.css aesthetic)

**Modified files:**
- `src/lib/followups/config.ts` — derive `OFFSETS_MS` from settings defaults; drop `MAX_OFFSET_IDX`
- `src/lib/followups/generateMessage.ts` — rename `offsetIdx` → `slot`; replace `MAX_OFFSET_IDX` usage
- `src/lib/followups/seed.ts` — load settings, write `offsets_snapshot`
- `src/lib/followups/seed.test.ts` — extend cases for snapshot + master OFF
- `src/lib/followups/fire.ts` — read `offsets_snapshot`, advance by snapshot length, pass `slot`
- `src/lib/followups/fire.test.ts` — extend for snapshot-driven advancement
- `src/lib/chatbot/config.ts` — extend `ChatbotConfig` + `getChatbotConfig` to return parsed `followupSettings`
- `src/app/(app)/dashboard/chatbot/page.tsx` — wrap existing content + new tab content with `ChatbotTabs`; fetch settings

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260519000000_followup_settings.sql`

- [ ] **Step 1: Create the migration file**

Write `supabase/migrations/20260519000000_followup_settings.sql`:

```sql
-- =========================================================================
-- Auto Follow-Up Settings: per-user master toggle + per-touchpoint enable/
-- interval stored as JSONB on chatbot_configs. Snapshot of resolved offsets
-- captured on lead_followup_schedules at seed time so in-flight schedules
-- ride out subsequent settings changes.
-- =========================================================================

-- 1. Per-user settings on chatbot_configs.
--    NULL = "use defaults" (preserves current behavior for existing users).
alter table public.chatbot_configs
  add column followup_settings jsonb;

-- 2. Snapshot of resolved offsets per schedule.
--    Shape: [{ "offset_ms": <int>, "slot": <int 0..6> }, ...] (ascending)
--    Existing rows are backfilled with the historical 7-touchpoint default.
alter table public.lead_followup_schedules
  add column offsets_snapshot jsonb not null default '[]'::jsonb;

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

- [ ] **Step 2: Apply the migration locally**

Run: `npx supabase db reset` (or `npx supabase migration up` if the env supports it).
Expected: migration applies cleanly, no errors.

- [ ] **Step 3: Verify the columns**

Run:
```bash
npx supabase db diff --linked --schema public | grep -E "followup_settings|offsets_snapshot"
```
Expected: no diff (migration is in sync).

Or open `psql` and run:
```sql
\d+ public.chatbot_configs
\d+ public.lead_followup_schedules
```
Expected: `followup_settings jsonb` on `chatbot_configs`; `offsets_snapshot jsonb not null default '[]'` on `lead_followup_schedules`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260519000000_followup_settings.sql
git commit -m "feat(db): add followup_settings + offsets_snapshot columns

Per-user auto-followup config column on chatbot_configs and a per-schedule
snapshot column on lead_followup_schedules. Backfills existing schedules with
the historical 7-touchpoint default."
```

---

## Task 2: Settings library — schema, defaults, loader, resolver

**Files:**
- Create: `src/lib/followups/settings.ts`
- Test: `src/lib/followups/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `src/lib/followups/settings.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import {
  FOLLOWUP_SETTINGS_SCHEMA,
  DEFAULT_FOLLOWUP_SETTINGS,
  resolveEnabledOffsets,
  loadFollowupSettings,
  type FollowupSettings,
} from './settings'

function validSettings(overrides: Partial<FollowupSettings> = {}): FollowupSettings {
  return {
    enabled: true,
    touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t) => ({ ...t })),
    ...overrides,
  }
}

describe('FOLLOWUP_SETTINGS_SCHEMA', () => {
  it('accepts the defaults', () => {
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(DEFAULT_FOLLOWUP_SETTINGS).success).toBe(true)
  })

  it('rejects touchpoints.length !== 7', () => {
    const bad = { ...DEFAULT_FOLLOWUP_SETTINGS, touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.slice(0, 6) }
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('rejects offset_ms below 1 minute', () => {
    const bad = validSettings()
    bad.touchpoints[0] = { enabled: true, offset_ms: 30_000 } // 30s
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('rejects offset_ms above 7 days', () => {
    const bad = validSettings()
    bad.touchpoints[6] = { enabled: true, offset_ms: 8 * 24 * 3_600_000 } // 8 days
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('rejects non-strictly-increasing enabled rows', () => {
    const bad = validSettings()
    bad.touchpoints[1] = { enabled: true, offset_ms: 60_000 } // 1m, less than slot 0's 5m
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('ignores ordering of disabled rows', () => {
    const ok = validSettings()
    ok.touchpoints[1] = { enabled: false, offset_ms: 60_000 } // disabled, ignore
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(ok).success).toBe(true)
  })

  it('rejects master enabled with zero enabled rows', () => {
    const bad = validSettings()
    bad.touchpoints = bad.touchpoints.map((t) => ({ ...t, enabled: false }))
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('allows master disabled with any (or zero) enabled rows', () => {
    const ok = validSettings({ enabled: false })
    ok.touchpoints = ok.touchpoints.map((t) => ({ ...t, enabled: false }))
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(ok).success).toBe(true)
  })
})

describe('resolveEnabledOffsets', () => {
  it('returns 7-entry snapshot with slots 0..6 on defaults', () => {
    const snap = resolveEnabledOffsets(DEFAULT_FOLLOWUP_SETTINGS)
    expect(snap).toHaveLength(7)
    expect(snap.map((s) => s.slot)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(snap[0].offset_ms).toBe(300_000)
    expect(snap[6].offset_ms).toBe(86_400_000)
  })

  it('skips disabled rows and preserves original slot indices', () => {
    const settings = validSettings()
    settings.touchpoints[1].enabled = false // slot 1 (1h) off
    settings.touchpoints[3].enabled = false // slot 3 (8h) off
    settings.touchpoints[5].enabled = false // slot 5 (18h) off
    const snap = resolveEnabledOffsets(settings)
    expect(snap.map((s) => s.slot)).toEqual([0, 2, 4, 6])
  })

  it('returns [] when master toggle is off', () => {
    expect(resolveEnabledOffsets(validSettings({ enabled: false }))).toEqual([])
  })

  it('returns [] when master is on but every row disabled (defensive)', () => {
    const s = validSettings()
    s.touchpoints = s.touchpoints.map((t) => ({ ...t, enabled: false }))
    expect(resolveEnabledOffsets(s)).toEqual([])
  })

  it('sorts ascending by offset_ms even if user reordered', () => {
    const s = validSettings()
    // swap slot 5 and slot 6 offsets
    s.touchpoints[5] = { enabled: true, offset_ms: 86_400_000 } // 24h
    s.touchpoints[6] = { enabled: true, offset_ms: 64_800_000 } // 18h
    // schema would reject this (not increasing), but resolver must not crash;
    // it normalizes by sorting
    const snap = resolveEnabledOffsets(s)
    expect(snap.map((e) => e.offset_ms)).toEqual([...snap.map((e) => e.offset_ms)].sort((a, b) => a - b))
  })
})

describe('loadFollowupSettings', () => {
  function makeAdmin(result: { data: unknown; error: unknown }) {
    return {
      from() {
        const chain: Record<string, unknown> = {}
        chain.select = () => chain
        chain.eq = () => chain
        chain.maybeSingle = async () => result
        return chain
      },
    } as never
  }

  it('returns defaults when row missing', async () => {
    const admin = makeAdmin({ data: null, error: null })
    expect(await loadFollowupSettings(admin, 'u1')).toEqual(DEFAULT_FOLLOWUP_SETTINGS)
  })

  it('returns defaults when followup_settings column is null', async () => {
    const admin = makeAdmin({ data: { followup_settings: null }, error: null })
    expect(await loadFollowupSettings(admin, 'u1')).toEqual(DEFAULT_FOLLOWUP_SETTINGS)
  })

  it('returns defaults and logs once when stored value fails to parse', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const admin = makeAdmin({ data: { followup_settings: { enabled: 'yes' } }, error: null })
    expect(await loadFollowupSettings(admin, 'u1')).toEqual(DEFAULT_FOLLOWUP_SETTINGS)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns defaults and logs once on DB error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const admin = makeAdmin({ data: null, error: { message: 'boom' } })
    expect(await loadFollowupSettings(admin, 'u1')).toEqual(DEFAULT_FOLLOWUP_SETTINGS)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns parsed settings when stored value is valid', async () => {
    const stored = { enabled: false, touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints }
    const admin = makeAdmin({ data: { followup_settings: stored }, error: null })
    expect(await loadFollowupSettings(admin, 'u1')).toEqual(stored)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/followups/settings.test.ts`
Expected: FAIL — `./settings` cannot be resolved.

- [ ] **Step 3: Implement `src/lib/followups/settings.ts`**

Write `src/lib/followups/settings.ts`:

```typescript
// src/lib/followups/settings.ts
//
// Per-user configuration for the silent auto-followup engine. Single source
// of truth for the default schedule and the zod schema enforced at write
// time. The engine reads settings via loadFollowupSettings and resolves a
// compact snapshot via resolveEnabledOffsets — that snapshot is persisted
// on each lead_followup_schedules row so in-flight schedules are unaffected
// by subsequent setting changes.

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

const MIN_OFFSET_MS = 60_000                       // 1 minute
const MAX_OFFSET_MS = 7 * 24 * 3_600_000           // 7 days
export const TOUCHPOINT_COUNT = 7

const TouchpointSchema = z.object({
  enabled: z.boolean(),
  offset_ms: z.number().int().min(MIN_OFFSET_MS).max(MAX_OFFSET_MS),
})

export const FOLLOWUP_SETTINGS_SCHEMA = z
  .object({
    enabled: z.boolean(),
    touchpoints: z.array(TouchpointSchema).length(TOUCHPOINT_COUNT),
  })
  .superRefine((val, ctx) => {
    // Enabled rows must be strictly increasing in offset_ms.
    const enabled = val.touchpoints
      .map((t, idx) => ({ t, idx }))
      .filter((x) => x.t.enabled)
    for (let i = 1; i < enabled.length; i++) {
      if (enabled[i].t.offset_ms <= enabled[i - 1].t.offset_ms) {
        ctx.addIssue({
          code: 'custom',
          message: `Touchpoint ${enabled[i].idx + 1} must be later than touchpoint ${enabled[i - 1].idx + 1}.`,
          path: ['touchpoints', enabled[i].idx, 'offset_ms'],
        })
      }
    }
    // If the master toggle is ON, at least one row must be enabled.
    if (val.enabled && enabled.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enable at least one touchpoint or turn the master toggle off.',
        path: ['touchpoints'],
      })
    }
  })

export type FollowupSettings = z.infer<typeof FOLLOWUP_SETTINGS_SCHEMA>

export const DEFAULT_FOLLOWUP_SETTINGS: FollowupSettings = {
  enabled: true,
  touchpoints: [
    { enabled: true, offset_ms: 5 * 60_000 },        // 5m
    { enabled: true, offset_ms: 60 * 60_000 },       // 1h
    { enabled: true, offset_ms: 5 * 3_600_000 },     // 5h
    { enabled: true, offset_ms: 8 * 3_600_000 },     // 8h
    { enabled: true, offset_ms: 12 * 3_600_000 },    // 12h
    { enabled: true, offset_ms: 18 * 3_600_000 },    // 18h
    { enabled: true, offset_ms: 24 * 3_600_000 },    // 24h
  ],
}

export interface SnapshotEntry {
  offset_ms: number
  slot: number
}

export function resolveEnabledOffsets(settings: FollowupSettings): SnapshotEntry[] {
  if (!settings.enabled) return []
  const entries: SnapshotEntry[] = settings.touchpoints
    .map((t, slot) => ({ t, slot }))
    .filter((x) => x.t.enabled)
    .map((x) => ({ slot: x.slot, offset_ms: x.t.offset_ms }))
  if (entries.length === 0) return []
  entries.sort((a, b) => a.offset_ms - b.offset_ms)
  return entries
}

export async function loadFollowupSettings(
  admin: SupabaseClient,
  userId: string,
): Promise<FollowupSettings> {
  const { data, error } = await admin
    .from('chatbot_configs')
    .select('followup_settings')
    .eq('user_id', userId)
    .maybeSingle<{ followup_settings: unknown }>()

  if (error) {
    console.warn('[followups.settings] db error, using defaults', error)
    return DEFAULT_FOLLOWUP_SETTINGS
  }
  if (!data || data.followup_settings == null) {
    return DEFAULT_FOLLOWUP_SETTINGS
  }
  const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(data.followup_settings)
  if (!parsed.success) {
    console.warn('[followups.settings] parse failed, using defaults', parsed.error.issues[0])
    return DEFAULT_FOLLOWUP_SETTINGS
  }
  return parsed.data
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/followups/settings.test.ts`
Expected: all 16 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/settings.ts src/lib/followups/settings.test.ts
git commit -m "feat(followups): settings schema, defaults, loader, resolver"
```

---

## Task 3: Refactor `config.ts` to derive `OFFSETS_MS` from settings defaults

**Files:**
- Modify: `src/lib/followups/config.ts`

Goal: remove the parallel definition; the defaults in `settings.ts` are the single source of truth. Keep the other exports intact so the rest of the codebase keeps compiling.

- [ ] **Step 1: Rewrite `src/lib/followups/config.ts`**

Replace the entire contents with:

```typescript
// src/lib/followups/config.ts
//
// Re-exports the historical defaults plus the engine's other knobs. The
// canonical schedule lives in ./settings (DEFAULT_FOLLOWUP_SETTINGS); this
// file keeps OFFSETS_MS for any caller that still needs a static list.

import { DEFAULT_FOLLOWUP_SETTINGS } from './settings'

export const OFFSETS_MS = DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map(
  (t) => t.offset_ms,
) as readonly number[]

export const REAL_CONVERSATION_LEAD_MSG_THRESHOLD = 4
export const MAX_LIFETIME_LEAD_INBOUND = 15

export type ConversationKind = 'generic' | 'real'
export type FollowupStatus = 'pending' | 'running' | 'done' | 'cancelled' | 'failed'
```

Notes:
- `MAX_OFFSET_IDX` is removed — engine code now uses `snapshot.length - 1`.
- `OFFSETS_MS` is retained because `generateMessage.ts` uses it for fallback bounds checking (we'll update that next task).

- [ ] **Step 2: Find broken imports**

Run:
```bash
grep -rn "MAX_OFFSET_IDX" src/
```
Expected: matches in `src/lib/followups/generateMessage.ts` and `src/lib/followups/fire.ts`. We fix those in Tasks 4 and 6 — leave the imports alone for now if you stop here, but to keep the tree green between tasks, also do this small edit:

In `src/lib/followups/fire.ts`, change:
```typescript
import { OFFSETS_MS, MAX_OFFSET_IDX } from './config'
```
to:
```typescript
import { OFFSETS_MS } from './config'
```

…and replace the single use of `MAX_OFFSET_IDX` in `advanceSchedule` with the inline literal `OFFSETS_MS.length - 1` (Task 6 replaces this whole function anyway):

```typescript
async function advanceSchedule(admin: SupabaseClient, schedule: ScheduleRow): Promise<void> {
  if (schedule.next_offset_idx >= OFFSETS_MS.length - 1) {
    await markDone(admin, schedule.id)
    return
  }
  const nextIdx = schedule.next_offset_idx + 1
  const nextRunAt = new Date(Date.parse(schedule.started_at) + OFFSETS_MS[nextIdx]).toISOString()
  await admin
    .from('lead_followup_schedules')
    .update({
      next_offset_idx: nextIdx,
      next_run_at: nextRunAt,
      status: 'pending',
      job_id: null,
    })
    .eq('id', schedule.id)
}
```

In `src/lib/followups/generateMessage.ts`, change:
```typescript
import { MAX_OFFSET_IDX, type ConversationKind } from './config'
```
to:
```typescript
import { OFFSETS_MS, type ConversationKind } from './config'
```
and replace `Math.min(MAX_OFFSET_IDX, idx)` (inside `fallback`) with `Math.min(OFFSETS_MS.length - 1, idx)`.

- [ ] **Step 3: Type-check and run the existing followups tests**

Run:
```bash
npx tsc --noEmit
npx vitest run src/lib/followups
```
Expected: type check clean, all existing followups tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/followups/config.ts src/lib/followups/fire.ts src/lib/followups/generateMessage.ts
git commit -m "refactor(followups): derive OFFSETS_MS from settings defaults

Drop MAX_OFFSET_IDX in favor of OFFSETS_MS.length - 1 inline. settings.ts is
now the single source of truth for the default schedule; config.ts re-exports
the static list for callers that need it."
```

---

## Task 4: Rename `offsetIdx` → `slot` in `generateMessage.ts`

**Files:**
- Modify: `src/lib/followups/generateMessage.ts`
- Modify: `src/lib/followups/generateMessage.test.ts`

The parameter is the original 0..6 slot index. After this change, callers will pass `snapshot[next_offset_idx].slot` so disabling rows doesn't shift the message variety.

- [ ] **Step 1: Update the file**

In `src/lib/followups/generateMessage.ts`:

Replace the `GenerateArgs` interface:
```typescript
export interface GenerateArgs {
  kind: ConversationKind
  slot: number
  leadName: string | null
  personalityBlock: string
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
}
```

Update `fallback`:
```typescript
function fallback(kind: ConversationKind, slot: number, leadName: string | null): string {
  const safeSlot = Math.max(0, Math.min(OFFSETS_MS.length - 1, slot))
  const line = FALLBACK_POOL[kind][safeSlot]
  const fn = firstName(leadName)
  return sanitizeFollowup(line.replace('{name}', fn || 'there'))
}
```

Update `buildSystemPrompt` — replace both occurrences of `args.offsetIdx + 1` with `args.slot + 1`.

Update `buildUserPrompt` — replace both occurrences of `args.offsetIdx + 1` with `args.slot + 1`.

Update `generateFollowupMessage`:
```typescript
export async function generateFollowupMessage(args: GenerateArgs): Promise<string> {
  if (args.slot === 0) {
    return fallback(args.kind, 0, args.leadName)
  }
  try {
    const llm = new HfRouterLlm({ model: ragConfig.classifierModel })
    const raw = await withTimeout(
      llm.complete(
        [
          { role: 'system', content: buildSystemPrompt(args) },
          { role: 'user', content: buildUserPrompt(args) },
        ],
        { temperature: 0.6, maxTokens: 160 },
      ),
      LLM_TIMEOUT_MS,
    )
    const cleaned = sanitizeFollowup(raw)
    if (!cleaned) throw new Error('empty')
    return cleaned
  } catch {
    return fallback(args.kind, args.slot, args.leadName)
  }
}
```

- [ ] **Step 2: Update the existing test file to use `slot`**

In `src/lib/followups/generateMessage.test.ts`, find every literal `offsetIdx:` and replace with `slot:`. Check by running:

```bash
grep -n "offsetIdx" src/lib/followups/generateMessage.test.ts
```
Expected: no matches after the edit.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/lib/followups/generateMessage.test.ts`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/followups/generateMessage.ts src/lib/followups/generateMessage.test.ts
git commit -m "refactor(followups): rename offsetIdx → slot in generateMessage

The parameter has always been the 0..6 slot index. Renaming makes room for
the upcoming snapshot, where the schedule's compact next_offset_idx and the
message-pool slot can differ."
```

---

## Task 5: Wire settings into `seed.ts`

**Files:**
- Modify: `src/lib/followups/seed.ts`
- Modify: `src/lib/followups/seed.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace `src/lib/followups/seed.test.ts` with:

```typescript
// These tests exercise the seed logic against a hand-rolled fake admin
// client. They do NOT touch Postgres — the goal is to lock in the call
// sequence (cancel-then-insert), the conversation_kind decision, and the
// snapshot that gets written to lead_followup_schedules.

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./gates', () => ({ shouldSeed: vi.fn() }))
vi.mock('./settings', async () => {
  const actual = await vi.importActual<typeof import('./settings')>('./settings')
  return {
    ...actual,
    loadFollowupSettings: vi.fn(),
  }
})

import { shouldSeed } from './gates'
import { loadFollowupSettings, DEFAULT_FOLLOWUP_SETTINGS } from './settings'
import { maybeScheduleFollowup } from './seed'

type Captured = { table: string; op: string; values?: unknown; match?: unknown }

function makeAdmin(): { admin: unknown; captured: Captured[] } {
  const captured: Captured[] = []
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      chain.update = (values: unknown) => {
        captured.push({ table, op: 'update', values })
        return chain
      }
      chain.insert = (values: unknown) => {
        captured.push({ table, op: 'insert', values })
        return Promise.resolve({ data: null, error: null })
      }
      chain.eq = (col: string, val: unknown) => {
        captured.push({ table, op: 'eq', match: { col, val } })
        return chain
      }
      chain.in = () => chain
      chain.select = () => chain
      return chain
    },
  }
  return { admin, captured }
}

const mockShouldSeed = shouldSeed as unknown as ReturnType<typeof vi.fn>
const mockLoadSettings = loadFollowupSettings as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockShouldSeed.mockReset()
  mockLoadSettings.mockReset()
  mockLoadSettings.mockResolvedValue(DEFAULT_FOLLOWUP_SETTINGS)
})

describe('maybeScheduleFollowup', () => {
  it('cancels existing schedule then inserts new pending row when gates pass', async () => {
    mockShouldSeed.mockResolvedValue({ ok: true, inboundCount: 2 })
    const { admin, captured } = makeAdmin()
    const lastInboundAt = new Date('2026-05-17T10:00:00Z').toISOString()

    await maybeScheduleFollowup(admin as never, {
      threadId: 't1', leadId: 'l1', userId: 'u1', pageId: 'p1', lastInboundAt,
    })

    const ops = captured.filter((c) => c.op === 'update' || c.op === 'insert')
    expect(ops[0]).toMatchObject({ table: 'lead_followup_schedules', op: 'update' })
    expect(ops[ops.length - 1]).toMatchObject({ table: 'lead_followup_schedules', op: 'insert' })
    const inserted = ops[ops.length - 1].values as Record<string, unknown>
    expect(inserted.conversation_kind).toBe('generic')
    expect(inserted.next_offset_idx).toBe(0)
    expect(inserted.started_at).toBe(lastInboundAt)
    expect(inserted.next_run_at).toBe(new Date(Date.parse(lastInboundAt) + 5 * 60_000).toISOString())
    expect(inserted.offsets_snapshot).toEqual([
      { offset_ms: 300000,   slot: 0 },
      { offset_ms: 3600000,  slot: 1 },
      { offset_ms: 18000000, slot: 2 },
      { offset_ms: 28800000, slot: 3 },
      { offset_ms: 43200000, slot: 4 },
      { offset_ms: 64800000, slot: 5 },
      { offset_ms: 86400000, slot: 6 },
    ])
  })

  it('decides conversation_kind=real when inboundCount >= 4', async () => {
    mockShouldSeed.mockResolvedValue({ ok: true, inboundCount: 7 })
    const { admin, captured } = makeAdmin()
    await maybeScheduleFollowup(admin as never, {
      threadId: 't2', leadId: 'l2', userId: 'u1', pageId: 'p1',
      lastInboundAt: new Date().toISOString(),
    })
    const ins = captured.find((c) => c.op === 'insert')!
    expect((ins.values as Record<string, unknown>).conversation_kind).toBe('real')
  })

  it('cancels existing schedule but does not insert when gates fail', async () => {
    mockShouldSeed.mockResolvedValue({ ok: false, reason: 'inbound_count_15' })
    const { admin, captured } = makeAdmin()
    await maybeScheduleFollowup(admin as never, {
      threadId: 't3', leadId: 'l3', userId: 'u1', pageId: 'p1',
      lastInboundAt: new Date().toISOString(),
    })
    expect(captured.find((c) => c.op === 'insert')).toBeUndefined()
    expect(captured.find((c) => c.op === 'update')).toBeDefined()
  })

  it('skips insert when master toggle is off (but still cancels)', async () => {
    mockShouldSeed.mockResolvedValue({ ok: true, inboundCount: 1 })
    mockLoadSettings.mockResolvedValue({ ...DEFAULT_FOLLOWUP_SETTINGS, enabled: false })
    const { admin, captured } = makeAdmin()
    await maybeScheduleFollowup(admin as never, {
      threadId: 't4', leadId: 'l4', userId: 'u1', pageId: 'p1',
      lastInboundAt: new Date().toISOString(),
    })
    expect(captured.find((c) => c.op === 'insert')).toBeUndefined()
    expect(captured.find((c) => c.op === 'update')).toBeDefined()
  })

  it('honors per-touchpoint disable: snapshot contains only enabled rows with original slots', async () => {
    mockShouldSeed.mockResolvedValue({ ok: true, inboundCount: 1 })
    const settings = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, idx) => ({
        ...t,
        enabled: idx % 2 === 0, // keep slots 0, 2, 4, 6
      })),
    }
    mockLoadSettings.mockResolvedValue(settings)
    const { admin, captured } = makeAdmin()
    const lastInboundAt = new Date('2026-05-17T10:00:00Z').toISOString()
    await maybeScheduleFollowup(admin as never, {
      threadId: 't5', leadId: 'l5', userId: 'u1', pageId: 'p1', lastInboundAt,
    })
    const ins = captured.find((c) => c.op === 'insert')!.values as Record<string, unknown>
    expect(ins.offsets_snapshot).toEqual([
      { offset_ms: 300000,   slot: 0 },
      { offset_ms: 18000000, slot: 2 },
      { offset_ms: 43200000, slot: 4 },
      { offset_ms: 86400000, slot: 6 },
    ])
    // next_run_at uses the first enabled offset (slot 0 = 5m).
    expect(ins.next_run_at).toBe(new Date(Date.parse(lastInboundAt) + 300_000).toISOString())
  })

  it('skips insert when master ON but no rows enabled (defensive)', async () => {
    mockShouldSeed.mockResolvedValue({ ok: true, inboundCount: 1 })
    mockLoadSettings.mockResolvedValue({
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t) => ({ ...t, enabled: false })),
    })
    const { admin, captured } = makeAdmin()
    await maybeScheduleFollowup(admin as never, {
      threadId: 't6', leadId: 'l6', userId: 'u1', pageId: 'p1',
      lastInboundAt: new Date().toISOString(),
    })
    expect(captured.find((c) => c.op === 'insert')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/followups/seed.test.ts`
Expected: at least the new "snapshot" and "master off" tests fail because seed.ts doesn't read settings or write the snapshot yet.

- [ ] **Step 3: Update `src/lib/followups/seed.ts`**

Replace the contents with:

```typescript
// src/lib/followups/seed.ts
//
// Seed and cancel logic for the auto-followup schedule. Called from the
// messenger inbound worker after the inbound message row is committed.
//
// Idempotency: the `uniq_active_followup_per_thread` partial unique index
// guarantees no two pending/running rows for the same thread. Two concurrent
// inbound deliveries can both arrive here; the loser's insert errors with
// 23505 and we swallow it.

import type { SupabaseClient } from '@supabase/supabase-js'
import { shouldSeed } from './gates'
import { REAL_CONVERSATION_LEAD_MSG_THRESHOLD } from './config'
import { loadFollowupSettings, resolveEnabledOffsets } from './settings'

export interface SeedArgs {
  threadId: string
  leadId: string
  userId: string
  pageId: string
  lastInboundAt: string
}

export async function cancelActiveFollowup(
  admin: SupabaseClient,
  threadId: string,
): Promise<void> {
  await admin
    .from('lead_followup_schedules')
    .update({ status: 'cancelled' })
    .eq('thread_id', threadId)
    .in('status', ['pending', 'running'])
}

export async function maybeScheduleFollowup(
  admin: SupabaseClient,
  args: SeedArgs,
): Promise<void> {
  // 1. Cancel any active schedule for this thread. Always runs — even when
  //    gates or settings will block re-seeding — so a lead crossing the
  //    15-message line (or one whose user just turned off the engine) cleans up.
  await cancelActiveFollowup(admin, args.threadId)

  // 2. Re-evaluate gates after cancel.
  const gate = await shouldSeed(admin, {
    threadId: args.threadId,
    leadId: args.leadId,
  })
  if (!gate.ok) return

  // 3. Resolve the user's per-account schedule. Empty snapshot means
  //    master OFF, all rows disabled, or a bad config — never seed.
  const settings = await loadFollowupSettings(admin, args.userId)
  const snapshot = resolveEnabledOffsets(settings)
  if (snapshot.length === 0) return

  const conversation_kind =
    gate.inboundCount >= REAL_CONVERSATION_LEAD_MSG_THRESHOLD ? 'real' : 'generic'
  const next_run_at = new Date(
    Date.parse(args.lastInboundAt) + snapshot[0].offset_ms,
  ).toISOString()

  const { error } = await admin
    .from('lead_followup_schedules')
    .insert({
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
      offsets_snapshot: snapshot,
    })

  // 23505 = unique_violation. A concurrent inbound already seeded — fine.
  if (error && (error as { code?: string }).code !== '23505') {
    console.warn('[followups.seed] insert failed', error.message)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/followups/seed.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/seed.ts src/lib/followups/seed.test.ts
git commit -m "feat(followups): seed reads user settings and writes offsets_snapshot

maybeScheduleFollowup now consults loadFollowupSettings + resolveEnabledOffsets
before inserting. Master OFF and all-disabled states cancel any active row but
do not seed a new one. The compact snapshot is persisted on the schedule row."
```

---

## Task 6: Read snapshot in `fire.ts`

**Files:**
- Modify: `src/lib/followups/fire.ts`
- Modify: `src/lib/followups/fire.test.ts`

- [ ] **Step 1: Update the failing tests**

Replace `src/lib/followups/fire.test.ts` with:

```typescript
// Exercises the per-job handler: load schedule → re-check gates → generate →
// sanitize → send → advance. The send and generator are mocked.

import { describe, expect, it, vi, beforeEach } from 'vitest'

const { sendOutboundMock, generateMock, shouldSeedMock } = vi.hoisted(() => ({
  sendOutboundMock: vi.fn(),
  generateMock: vi.fn(),
  shouldSeedMock: vi.fn(),
}))

vi.mock('@/lib/messenger/outbound', () => ({ sendOutbound: sendOutboundMock }))
vi.mock('@/lib/facebook/crypto', () => ({ decryptToken: (s: string) => `dec:${s}` }))
vi.mock('@/lib/agent/classifyPolicy', () => ({
  isInsideWindow: (s: string | null) => !!s && Date.now() - new Date(s).getTime() < 24 * 3600_000,
}))
vi.mock('./generateMessage', () => ({ generateFollowupMessage: generateMock }))
vi.mock('./gates', () => ({ shouldSeed: shouldSeedMock }))

import { handleFollowupSend } from './fire'

interface FakeRow {
  id: string
  user_id: string
  lead_id: string
  thread_id: string
  page_id: string
  started_at: string
  next_offset_idx: number
  conversation_kind: 'generic' | 'real'
  status: string
  offsets_snapshot: Array<{ offset_ms: number; slot: number }>
}

function makeAdmin(seed: {
  schedule: FakeRow
  thread: Record<string, unknown>
  page: Record<string, unknown>
  lead: Record<string, unknown>
  chatbot: Record<string, unknown>
  history: unknown[]
}) {
  const updates: Array<{ table: string; values: unknown; match: unknown }> = []
  const inserts: Array<{ table: string; values: unknown }> = []
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      let pendingMatch: Record<string, unknown> = {}
      let pendingUpdate: unknown = null
      chain.select = () => chain
      chain.order = () => chain
      chain.limit = () => chain
      chain.eq = (col: string, val: unknown) => {
        pendingMatch = { ...pendingMatch, [col]: val }
        return chain
      }
      chain.maybeSingle = async () => {
        if (table === 'lead_followup_schedules') return { data: seed.schedule, error: null }
        if (table === 'messenger_threads') return { data: seed.thread, error: null }
        if (table === 'facebook_pages') return { data: seed.page, error: null }
        if (table === 'leads') return { data: seed.lead, error: null }
        if (table === 'chatbot_configs') return { data: seed.chatbot, error: null }
        return { data: null, error: null }
      }
      chain.update = (values: unknown) => {
        pendingUpdate = values
        return chain
      }
      chain.insert = (values: unknown) => {
        inserts.push({ table, values })
        return Promise.resolve({ data: null, error: null })
      }
      chain.then = (resolve: (r: { data: unknown[]; error: null }) => void) => {
        if (pendingUpdate !== null) {
          updates.push({ table, values: pendingUpdate, match: pendingMatch })
        }
        if (table === 'messenger_messages' && pendingUpdate === null) {
          resolve({ data: seed.history, error: null })
        } else {
          resolve({ data: [], error: null })
        }
      }
      return chain
    },
  }
  return { admin, updates, inserts }
}

const DEFAULT_SNAPSHOT = [
  { offset_ms: 300000,   slot: 0 },
  { offset_ms: 3600000,  slot: 1 },
  { offset_ms: 18000000, slot: 2 },
  { offset_ms: 28800000, slot: 3 },
  { offset_ms: 43200000, slot: 4 },
  { offset_ms: 64800000, slot: 5 },
  { offset_ms: 86400000, slot: 6 },
]

beforeEach(() => {
  sendOutboundMock.mockReset()
  generateMock.mockReset()
  shouldSeedMock.mockReset()
})

describe('handleFollowupSend', () => {
  const schedule: FakeRow = {
    id: 's1', user_id: 'u1', lead_id: 'l1', thread_id: 't1', page_id: 'p1',
    started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    next_offset_idx: 0,
    conversation_kind: 'generic',
    status: 'pending',
    offsets_snapshot: DEFAULT_SNAPSHOT,
  }
  const baseSeed = {
    schedule,
    thread: { id: 't1', psid: 'ps1', last_inbound_at: schedule.started_at, page_id: 'p1', full_name: 'Ana Cruz' },
    page: { id: 'p1', page_access_token: 'enc-token' },
    lead: { name: 'Ana Cruz' },
    chatbot: { persona: 'warm, casual' },
    history: [],
  }

  it('generates, sends, and advances to next offset using snapshot', async () => {
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('Hi Ana, interested pa po kayo?')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb1' })
    const { admin, updates } = makeAdmin(baseSeed)

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(sendOutboundMock).toHaveBeenCalledTimes(1)
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 0 }),
    )
    const upd = updates.filter((u) => u.table === 'lead_followup_schedules')
    const last = upd[upd.length - 1].values as Record<string, unknown>
    expect(last.next_offset_idx).toBe(1)
    expect(last.status).toBe('pending')
    // next_run_at uses snapshot[1].offset_ms = 1h
    expect(last.next_run_at).toBe(
      new Date(Date.parse(schedule.started_at) + 3_600_000).toISOString(),
    )
  })

  it('passes the original slot index (not next_offset_idx) to generateMessage', async () => {
    // Snapshot with rows 1 and 2 disabled (slots 0, 3, 5 only). Schedule at idx=1
    // means we're firing the row whose original slot is 3.
    const compactSnap = [
      { offset_ms: 300000,   slot: 0 },
      { offset_ms: 28800000, slot: 3 },
      { offset_ms: 64800000, slot: 5 },
    ]
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('hi')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb2' })
    const { admin } = makeAdmin({
      ...baseSeed,
      schedule: { ...schedule, next_offset_idx: 1, offsets_snapshot: compactSnap },
    })

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({ slot: 3 }))
  })

  it('marks done when firing the last entry in the snapshot', async () => {
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('hi')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb7' })
    const { admin, updates } = makeAdmin({
      ...baseSeed,
      schedule: { ...schedule, next_offset_idx: 6 },
    })

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    const upd = updates.filter((u) => u.table === 'lead_followup_schedules')
    const last = upd[upd.length - 1].values as Record<string, unknown>
    expect(last.status).toBe('done')
  })

  it('marks done at snapshot.length - 1 even when snapshot is shorter than 7', async () => {
    const compactSnap = [
      { offset_ms: 300000,   slot: 0 },
      { offset_ms: 28800000, slot: 3 },
    ]
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('hi')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fbx' })
    const { admin, updates } = makeAdmin({
      ...baseSeed,
      schedule: { ...schedule, next_offset_idx: 1, offsets_snapshot: compactSnap },
    })

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    const upd = updates.filter((u) => u.table === 'lead_followup_schedules')
    expect((upd[upd.length - 1].values as Record<string, unknown>).status).toBe('done')
  })

  it('marks done without sending when gates fail mid-schedule', async () => {
    shouldSeedMock.mockResolvedValue({ ok: false, reason: 'page_action_completed' })
    const { admin, updates } = makeAdmin(baseSeed)

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(sendOutboundMock).not.toHaveBeenCalled()
    const upd = updates.filter((u) => u.table === 'lead_followup_schedules')
    expect((upd[upd.length - 1].values as Record<string, unknown>).status).toBe('done')
  })

  it('marks failed on send error', async () => {
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('hi')
    sendOutboundMock.mockResolvedValue({ sent: false, reason: 'window' })
    const { admin, updates } = makeAdmin(baseSeed)

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    const upd = updates.filter((u) => u.table === 'lead_followup_schedules')
    const last = upd[upd.length - 1].values as Record<string, unknown>
    expect(last.status).toBe('failed')
    expect(last.last_error).toContain('window')
  })
})
```

- [ ] **Step 2: Update `src/lib/followups/fire.ts`**

Replace the file contents:

```typescript
// src/lib/followups/fire.ts
//
// Per-schedule fire handler. Invoked from the messenger worker via the
// `followup_send` job kind. We re-evaluate gates on every fire so a lead
// who completes a booking between schedule creation and the next touchpoint
// stops getting pinged. After a successful send the row is either advanced
// to the next pending offset or marked done.
//
// The schedule carries its own offsets_snapshot (captured at seed time);
// changes to the user's settings after seed do NOT affect in-flight schedules.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptToken } from '@/lib/facebook/crypto'
import { sendOutbound } from '@/lib/messenger/outbound'
import { isInsideWindow } from '@/lib/agent/classifyPolicy'
import { shouldSeed } from './gates'
import { generateFollowupMessage } from './generateMessage'
import type { SnapshotEntry } from './settings'

interface ScheduleRow {
  id: string
  user_id: string
  lead_id: string
  thread_id: string
  page_id: string
  started_at: string
  next_offset_idx: number
  conversation_kind: 'generic' | 'real'
  status: string
  offsets_snapshot: SnapshotEntry[]
}

interface ThreadRow {
  id: string
  psid: string
  last_inbound_at: string | null
  full_name: string | null
}

export interface FollowupSendJob {
  id: string
  payload: { schedule_id: string } | null
}

export async function handleFollowupSend(
  admin: SupabaseClient,
  args: { scheduleId: string },
): Promise<void> {
  const { data: schedule } = await admin
    .from('lead_followup_schedules')
    .select('id, user_id, lead_id, thread_id, page_id, started_at, next_offset_idx, conversation_kind, status, offsets_snapshot')
    .eq('id', args.scheduleId)
    .maybeSingle<ScheduleRow>()

  if (!schedule) return
  if (schedule.status !== 'running' && schedule.status !== 'pending') return

  const snapshot = schedule.offsets_snapshot ?? []
  if (snapshot.length === 0) {
    // Defensive — a schedule should never have an empty snapshot in practice.
    await markDone(admin, schedule.id)
    return
  }

  const entry = snapshot[schedule.next_offset_idx]
  if (!entry) {
    await markDone(admin, schedule.id)
    return
  }

  // Re-check gates: a lead who booked between scheduling and firing should
  // not receive the touchpoint.
  const gate = await shouldSeed(admin, {
    threadId: schedule.thread_id,
    leadId: schedule.lead_id,
  })
  if (!gate.ok) {
    await markDone(admin, schedule.id)
    return
  }

  // Load thread + page + chatbot personality + last 20 messages.
  const { data: thread } = await admin
    .from('messenger_threads')
    .select('id, psid, last_inbound_at, full_name')
    .eq('id', schedule.thread_id)
    .maybeSingle<ThreadRow>()
  if (!thread) {
    await markDone(admin, schedule.id)
    return
  }

  const { data: page } = await admin
    .from('facebook_pages')
    .select('id, page_access_token')
    .eq('id', schedule.page_id)
    .maybeSingle<{ id: string; page_access_token: string }>()
  if (!page) {
    await markFailed(admin, schedule.id, 'page missing')
    return
  }

  const { data: chatbot } = await admin
    .from('chatbot_configs')
    .select('persona, instructions')
    .eq('user_id', schedule.user_id)
    .maybeSingle<{ persona: string | null; instructions: string | null }>()

  const { data: leadRow } = await admin
    .from('leads')
    .select('name')
    .eq('id', schedule.lead_id)
    .maybeSingle<{ name: string | null }>()

  const personalityBlock = [chatbot?.persona, chatbot?.instructions]
    .filter((s) => typeof s === 'string' && s.trim())
    .join('\n\n')

  // For 'real' conversations, load the last 20 messages so the LLM can
  // reference them. For 'generic', skip the DB read — we don't use them.
  let recentMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  if (schedule.conversation_kind === 'real') {
    const { data: msgs } = await admin
      .from('messenger_messages')
      .select('direction, body, created_at')
      .eq('thread_id', schedule.thread_id)
      .order('created_at', { ascending: false })
      .limit(20)
    recentMessages = ((msgs ?? []) as Array<{ direction: string; body: string }>)
      .reverse()
      .filter((m) => m.body?.trim())
      .map((m) => ({
        role: m.direction === 'outbound' ? ('assistant' as const) : ('user' as const),
        content: m.body,
      }))
  }

  const leadName = leadRow?.name ?? thread.full_name ?? null

  const text = await generateFollowupMessage({
    kind: schedule.conversation_kind,
    slot: entry.slot,
    leadName,
    personalityBlock,
    recentMessages,
  })

  if (!text) {
    await markFailed(admin, schedule.id, 'empty message')
    return
  }

  const insideWindow = isInsideWindow(thread.last_inbound_at)
  const sendKind = insideWindow ? 'bot' : 'workflow_human_agent'
  const pageToken = decryptToken(page.page_access_token)

  const result = await sendOutbound({
    admin,
    thread: { id: thread.id, psid: thread.psid, last_inbound_at: thread.last_inbound_at },
    pageToken,
    payload: { kind: 'text', text },
    kind: sendKind,
  })

  if (!result.sent) {
    const reason = (result as { sent: false; reason: string }).reason
    await markFailed(admin, schedule.id, `send_blocked:${reason}`)
    return
  }

  await admin
    .from('messenger_messages')
    .insert({
      thread_id: thread.id,
      user_id: schedule.user_id,
      direction: 'outbound',
      sender: 'bot',
      fb_message_id: result.messageId,
      body: text,
    })
    .then(({ error }) => {
      if (error && (error as { code?: string }).code !== '23505') {
        console.warn('[followups.fire] message insert failed', error.message)
      }
    })

  await advanceSchedule(admin, schedule)
}

async function advanceSchedule(admin: SupabaseClient, schedule: ScheduleRow): Promise<void> {
  const snapshot = schedule.offsets_snapshot
  if (schedule.next_offset_idx >= snapshot.length - 1) {
    await markDone(admin, schedule.id)
    return
  }
  const nextIdx = schedule.next_offset_idx + 1
  const nextRunAt = new Date(
    Date.parse(schedule.started_at) + snapshot[nextIdx].offset_ms,
  ).toISOString()
  await admin
    .from('lead_followup_schedules')
    .update({
      next_offset_idx: nextIdx,
      next_run_at: nextRunAt,
      status: 'pending',
      job_id: null,
    })
    .eq('id', schedule.id)
}

async function markDone(admin: SupabaseClient, id: string): Promise<void> {
  await admin.from('lead_followup_schedules').update({ status: 'done' }).eq('id', id)
}

async function markFailed(admin: SupabaseClient, id: string, reason: string): Promise<void> {
  await admin
    .from('lead_followup_schedules')
    .update({ status: 'failed', last_error: reason.slice(0, 500) })
    .eq('id', id)
}

// Worker entry point — called from `messenger/process` route's `runJob`
// branch when `job.kind === 'followup_send'`.
export async function handleFollowupSendJob(
  admin: SupabaseClient,
  job: FollowupSendJob,
): Promise<void> {
  const scheduleId = job.payload?.schedule_id
  if (!scheduleId) {
    await admin
      .from('messenger_jobs')
      .update({ status: 'skipped', finished_at: new Date().toISOString() })
      .eq('id', job.id)
    return
  }
  try {
    await handleFollowupSend(admin, { scheduleId })
    await admin
      .from('messenger_jobs')
      .update({ status: 'done', finished_at: new Date().toISOString() })
      .eq('id', job.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[followups.fire] handler threw', job.id, msg)
    await admin
      .from('messenger_jobs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        last_error: msg.slice(0, 1000),
      })
      .eq('id', job.id)
  }
}
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/lib/followups/fire.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 4: Run the full followups suite**

Run: `npx vitest run src/lib/followups`
Expected: all tests pass across the directory.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/fire.ts src/lib/followups/fire.test.ts
git commit -m "feat(followups): fire reads offsets_snapshot for advance and slot

handleFollowupSend now reads offsets_snapshot off the schedule row. The
compact next_offset_idx walks the snapshot; the entry's original slot is
passed to generateFollowupMessage so the FALLBACK_POOL mapping survives
mid-sequence disables."
```

---

## Task 7: API route — `GET / PUT /api/chatbot/followup-settings`

**Files:**
- Create: `src/app/api/chatbot/followup-settings/route.ts`
- Test: `src/app/api/chatbot/followup-settings/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `src/app/api/chatbot/followup-settings/route.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { getUserMock, supabaseFromMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  supabaseFromMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: supabaseFromMock,
  }),
}))

import { GET, PUT } from './route'
import { DEFAULT_FOLLOWUP_SETTINGS } from '@/lib/followups/settings'

function asJson(req: { json: () => Promise<unknown> }) {
  return req.json()
}

beforeEach(() => {
  getUserMock.mockReset()
  supabaseFromMock.mockReset()
})

describe('GET /api/chatbot/followup-settings', () => {
  it('returns 401 without a session', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await GET(new Request('http://x/api/chatbot/followup-settings'))
    expect(res.status).toBe(401)
  })

  it('returns defaults when no chatbot_configs row exists', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }))
    const res = await GET(new Request('http://x/api/chatbot/followup-settings'))
    expect(res.status).toBe(200)
    expect(await asJson(res)).toEqual({ settings: DEFAULT_FOLLOWUP_SETTINGS })
  })

  it('returns saved settings when present', async () => {
    const stored = { ...DEFAULT_FOLLOWUP_SETTINGS, enabled: false }
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { followup_settings: stored }, error: null }),
        }),
      }),
    }))
    const res = await GET(new Request('http://x/api/chatbot/followup-settings'))
    expect(res.status).toBe(200)
    expect(await asJson(res)).toEqual({ settings: stored })
  })
})

describe('PUT /api/chatbot/followup-settings', () => {
  function makeReq(body: unknown): Request {
    return new Request('http://x/api/chatbot/followup-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('returns 401 without a session', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await PUT(makeReq({ settings: DEFAULT_FOLLOWUP_SETTINGS }))
    expect(res.status).toBe(401)
  })

  it('returns 400 on invalid shape', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const res = await PUT(makeReq({ settings: { enabled: 'yes', touchpoints: [] } }))
    expect(res.status).toBe(400)
    const body = (await asJson(res)) as { error: string }
    expect(body.error).toBeTruthy()
  })

  it('saves valid settings and round-trips the value', async () => {
    let stored: unknown = null
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    supabaseFromMock.mockImplementation(() => ({
      upsert: vi.fn(async (row: { user_id: string; followup_settings: unknown }) => {
        stored = row.followup_settings
        return { error: null }
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { followup_settings: stored }, error: null }),
        }),
      }),
    }))

    const desired = { ...DEFAULT_FOLLOWUP_SETTINGS, enabled: false }
    const putRes = await PUT(makeReq({ settings: desired }))
    expect(putRes.status).toBe(200)
    expect(await asJson(putRes)).toEqual({ settings: desired })

    const getRes = await GET(new Request('http://x/api/chatbot/followup-settings'))
    expect(await asJson(getRes)).toEqual({ settings: desired })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/api/chatbot/followup-settings`
Expected: FAIL — `./route` cannot be resolved.

- [ ] **Step 3: Implement `src/app/api/chatbot/followup-settings/route.ts`**

Write the route file:

```typescript
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  FOLLOWUP_SETTINGS_SCHEMA,
  DEFAULT_FOLLOWUP_SETTINGS,
} from '@/lib/followups/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('chatbot_configs')
    .select('followup_settings')
    .eq('user_id', user.id)
    .maybeSingle<{ followup_settings: unknown }>()

  if (error) {
    console.warn('[followup-settings.GET] db error', error.message)
    return NextResponse.json({ settings: DEFAULT_FOLLOWUP_SETTINGS })
  }
  if (!data || data.followup_settings == null) {
    return NextResponse.json({ settings: DEFAULT_FOLLOWUP_SETTINGS })
  }

  const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(data.followup_settings)
  if (!parsed.success) {
    console.warn('[followup-settings.GET] stored value invalid', parsed.error.issues[0])
    return NextResponse.json({ settings: DEFAULT_FOLLOWUP_SETTINGS })
  }
  return NextResponse.json({ settings: parsed.data })
}

export async function PUT(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { settings?: unknown }
  try {
    body = (await req.json()) as { settings?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(body.settings)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return NextResponse.json(
      { error: first.message, path: first.path },
      { status: 400 },
    )
  }

  const { error } = await supabase.from('chatbot_configs').upsert(
    { user_id: user.id, followup_settings: parsed.data },
    { onConflict: 'user_id' },
  )
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ settings: parsed.data })
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/api/chatbot/followup-settings`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chatbot/followup-settings/route.ts src/app/api/chatbot/followup-settings/route.test.ts
git commit -m "feat(api): GET/PUT /api/chatbot/followup-settings

Zod-validated upsert on chatbot_configs.followup_settings. GET returns
DEFAULT_FOLLOWUP_SETTINGS when missing/invalid; PUT 400s with the offending
zod path so the client can highlight the row."
```

---

## Task 8: Extend `getChatbotConfig` to return `followupSettings`

**Files:**
- Modify: `src/lib/chatbot/config.ts`

The chatbot page needs the parsed settings alongside the personality/persona. We extend the returned `ChatbotConfig` rather than adding a second server fetch.

- [ ] **Step 1: Update `src/lib/chatbot/config.ts`**

At the top, add the import:

```typescript
import { DEFAULT_FOLLOWUP_SETTINGS, FOLLOWUP_SETTINGS_SCHEMA, type FollowupSettings } from '@/lib/followups/settings'
```

Extend the `ChatbotConfigRow` type — add the column:

```typescript
export type ChatbotConfigRow = {
  // ...existing fields...
  primary_action_page_id: string | null
  followup_settings: unknown          // ← new
  created_at: string
  updated_at: string
}
```

Extend `ChatbotConfig`:

```typescript
export type ChatbotConfig = ChatbotPersona & {
  temperature: number
  maxContext: number
  autoClassifyEnabled: boolean
  activeTemplateId: string | null
  personalitySource: 'custom' | 'template'
  recommendationRules: RecommendationRulesMap
  primaryActionPageId: string | null
  followupSettings: FollowupSettings   // ← new
  updatedAt: string
}
```

Extend `DEFAULT_CHATBOT_CONFIG`:

```typescript
export const DEFAULT_CHATBOT_CONFIG: ChatbotConfig = {
  ...DEFAULT_CHATBOT_PERSONA,
  temperature: 0.4,
  maxContext: 6,
  autoClassifyEnabled: true,
  activeTemplateId: null,
  personalitySource: 'custom',
  recommendationRules: DEFAULT_RECOMMENDATION_RULES,
  primaryActionPageId: null,
  followupSettings: DEFAULT_FOLLOWUP_SETTINGS,   // ← new
  updatedAt: '',
}
```

Add a helper near `parseRecommendationRules`:

```typescript
export function parseFollowupSettings(raw: unknown): FollowupSettings {
  if (raw == null) return DEFAULT_FOLLOWUP_SETTINGS
  const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_FOLLOWUP_SETTINGS
}
```

Update `rowToConfig` — add the new field at the end of the returned object:

```typescript
export function rowToConfig(row: ChatbotConfigRow): ChatbotConfig {
  return {
    name: row.name || DEFAULT_CHATBOT_CONFIG.name,
    persona: row.persona || DEFAULT_CHATBOT_CONFIG.persona,
    instructions: row.instructions ?? '',
    doRules: row.do_rules?.length ? row.do_rules : DEFAULT_CHATBOT_CONFIG.doRules,
    dontRules: row.dont_rules?.length ? row.dont_rules : DEFAULT_CHATBOT_CONFIG.dontRules,
    fallbackMessage: row.fallback_message || DEFAULT_CHATBOT_CONFIG.fallbackMessage,
    temperature: row.temperature ?? DEFAULT_CHATBOT_CONFIG.temperature,
    maxContext: row.max_context ?? DEFAULT_CHATBOT_CONFIG.maxContext,
    autoClassifyEnabled: row.auto_classify_enabled ?? DEFAULT_CHATBOT_CONFIG.autoClassifyEnabled,
    activeTemplateId: row.active_template_id ?? null,
    personalitySource: (row.personality_source as ChatbotConfig['personalitySource']) ?? 'custom',
    recommendationRules: parseRecommendationRules(row.recommendation_rules),
    primaryActionPageId: row.primary_action_page_id ?? null,
    followupSettings: parseFollowupSettings(row.followup_settings),
    updatedAt: row.updated_at ?? '',
  }
}
```

`getChatbotConfig` itself doesn't change — it already calls `rowToConfig` and falls back to `DEFAULT_CHATBOT_CONFIG` when the row is missing.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run the chatbot-related tests**

Run: `npx vitest run src/lib/chatbot`
Expected: any existing tests still pass; no new tests needed for this trivial extension (the parsing is exercised by Task 2 tests + Task 7 API tests).

- [ ] **Step 4: Commit**

```bash
git add src/lib/chatbot/config.ts
git commit -m "feat(chatbot): expose followupSettings on ChatbotConfig

rowToConfig now parses chatbot_configs.followup_settings via the shared zod
schema. Defaults to DEFAULT_FOLLOWUP_SETTINGS on missing/invalid input."
```

---

## Task 9: `ChatbotTabs` component (tab shell + URL sync)

**Files:**
- Create: `src/app/(app)/dashboard/chatbot/_components/ChatbotTabs.tsx`

- [ ] **Step 1: Write the component**

Write `src/app/(app)/dashboard/chatbot/_components/ChatbotTabs.tsx`:

```typescript
'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type TabKey = 'personality' | 'followup'

interface ChatbotTabsProps {
  personalityContent: ReactNode
  followupContent: ReactNode
}

export function ChatbotTabs({ personalityContent, followupContent }: ChatbotTabsProps) {
  const router = useRouter()
  const pathname = usePathname() ?? '/dashboard/chatbot'
  const searchParams = useSearchParams()
  const urlTab = searchParams?.get('tab')
  const initial: TabKey = urlTab === 'followup' ? 'followup' : 'personality'
  const [active, setActive] = useState<TabKey>(initial)

  // Keep URL in sync when the user clicks a tab.
  useEffect(() => {
    const next = new URLSearchParams(searchParams?.toString() ?? '')
    if (active === 'personality') {
      next.delete('tab')
    } else {
      next.set('tab', active)
    }
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [active, pathname, router, searchParams])

  return (
    <>
      <nav
        role="tablist"
        aria-label="Chatbot sections"
        className="cb-toplevel-tabs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={active === 'personality'}
          className={`cb-toplevel-tab${active === 'personality' ? ' active' : ''}`}
          onClick={() => setActive('personality')}
        >
          Personality
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === 'followup'}
          className={`cb-toplevel-tab${active === 'followup' ? ' active' : ''}`}
          onClick={() => setActive('followup')}
        >
          Auto Follow-Up
        </button>
      </nav>

      <div role="tabpanel" hidden={active !== 'personality'}>
        {personalityContent}
      </div>
      <div role="tabpanel" hidden={active !== 'followup'}>
        {followupContent}
      </div>
    </>
  )
}
```

- [ ] **Step 2: Add the styles for the top-level tabs**

Append to `src/app/(app)/dashboard/chatbot/chatbot.css`:

```css
.cb-toplevel-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid #E5E7EB;
  margin-bottom: 16px;
}

.cb-toplevel-tab {
  position: relative;
  margin-bottom: -1px;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 500;
  color: #6B7280;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 120ms;
}

.cb-toplevel-tab:hover {
  color: #111827;
}

.cb-toplevel-tab.active {
  color: #111827;
  border-bottom-color: #059669;
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/dashboard/chatbot/_components/ChatbotTabs.tsx src/app/\(app\)/dashboard/chatbot/chatbot.css
git commit -m "feat(ui): ChatbotTabs shell with URL sync (?tab=followup)"
```

---

## Task 10: `AutoFollowupForm` component

**Files:**
- Create: `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx`
- Modify: `src/app/(app)/dashboard/chatbot/chatbot.css`

- [ ] **Step 1: Write the component**

Write `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx`:

```typescript
'use client'

import { useMemo, useState } from 'react'
import {
  DEFAULT_FOLLOWUP_SETTINGS,
  type FollowupSettings,
} from '@/lib/followups/settings'

type Unit = 'minutes' | 'hours' | 'days'

interface RowDraft {
  enabled: boolean
  value: number
  unit: Unit
}

interface FormState {
  enabled: boolean
  rows: RowDraft[]
}

const UNIT_FACTOR: Record<Unit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
}

function msToDraft(offsetMs: number): { value: number; unit: Unit } {
  // Largest unit U such that offsetMs is a whole multiple of one U.
  if (offsetMs % UNIT_FACTOR.days === 0) return { value: offsetMs / UNIT_FACTOR.days, unit: 'days' }
  if (offsetMs % UNIT_FACTOR.hours === 0) return { value: offsetMs / UNIT_FACTOR.hours, unit: 'hours' }
  return { value: Math.round(offsetMs / UNIT_FACTOR.minutes), unit: 'minutes' }
}

function draftToMs(row: RowDraft): number {
  return Math.round(row.value * UNIT_FACTOR[row.unit])
}

function settingsToState(s: FollowupSettings): FormState {
  return {
    enabled: s.enabled,
    rows: s.touchpoints.map((t) => {
      const { value, unit } = msToDraft(t.offset_ms)
      return { enabled: t.enabled, value, unit }
    }),
  }
}

function stateToSettings(s: FormState): FollowupSettings {
  return {
    enabled: s.enabled,
    touchpoints: s.rows.map((r) => ({
      enabled: r.enabled,
      offset_ms: draftToMs(r),
    })),
  }
}

const MIN_MS = 60_000
const MAX_MS = 7 * 24 * 3_600_000

interface ValidationResult {
  rowErrors: Map<number, string>
  formError: string | null
}

function validate(state: FormState): ValidationResult {
  const rowErrors = new Map<number, string>()
  let formError: string | null = null

  state.rows.forEach((row, idx) => {
    if (!Number.isFinite(row.value) || row.value <= 0) {
      rowErrors.set(idx, 'Enter a positive number.')
      return
    }
    const ms = draftToMs(row)
    if (ms < MIN_MS) {
      rowErrors.set(idx, 'Minimum is 1 minute.')
    } else if (ms > MAX_MS) {
      rowErrors.set(idx, 'Maximum is 7 days.')
    }
  })

  const enabledIndexed = state.rows
    .map((r, idx) => ({ ms: draftToMs(r), enabled: r.enabled, idx }))
    .filter((x) => x.enabled)

  for (let i = 1; i < enabledIndexed.length; i++) {
    if (enabledIndexed[i].ms <= enabledIndexed[i - 1].ms) {
      const prev = enabledIndexed[i - 1].idx + 1
      const cur = enabledIndexed[i].idx + 1
      rowErrors.set(
        enabledIndexed[i].idx,
        `Must be later than touchpoint ${prev}.`,
      )
      formError = `Touchpoint ${cur} must be later than touchpoint ${prev}.`
    }
  }

  if (state.enabled && enabledIndexed.length === 0) {
    formError = 'Enable at least one touchpoint or turn the master toggle off.'
  }

  return { rowErrors, formError }
}

export function AutoFollowupForm({ initial }: { initial: FollowupSettings }) {
  const [baseline, setBaseline] = useState<FollowupSettings>(initial)
  const [state, setState] = useState<FormState>(() => settingsToState(initial))
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [topError, setTopError] = useState<string | null>(null)

  const { rowErrors, formError } = useMemo(() => validate(state), [state])
  const dirty = useMemo(
    () => JSON.stringify(stateToSettings(state)) !== JSON.stringify(baseline),
    [state, baseline],
  )
  const canSave = dirty && !formError && rowErrors.size === 0 && !saving

  function setRow(idx: number, patch: Partial<RowDraft>) {
    setState((s) => ({
      ...s,
      rows: s.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }))
  }

  function onReset() {
    if (!window.confirm('Reset all touchpoints to the default schedule?')) return
    setState(settingsToState(DEFAULT_FOLLOWUP_SETTINGS))
  }

  function onCancel() {
    setState(settingsToState(baseline))
    setTopError(null)
  }

  async function onSave() {
    setSaving(true)
    setTopError(null)
    try {
      const res = await fetch('/api/chatbot/followup-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: stateToSettings(state) }),
      })
      const body = (await res.json()) as { settings?: FollowupSettings; error?: string }
      if (!res.ok) {
        setTopError(body.error ?? `Save failed (${res.status})`)
        return
      }
      if (body.settings) {
        setBaseline(body.settings)
        setState(settingsToState(body.settings))
      }
      setToast('Auto follow-up updated')
      setTimeout(() => setToast(null), 2500)
    } catch (e) {
      setTopError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="afu-wrap" data-master={state.enabled ? 'on' : 'off'}>
      <header className="afu-header">
        <div>
          <h2 className="afu-title">Auto Follow-Up</h2>
          <p className="afu-help">
            When a lead goes quiet, send up to 7 nudges before stopping.
          </p>
        </div>
        <label className="afu-toggle">
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => setState((s) => ({ ...s, enabled: e.target.checked }))}
          />
          <span>{state.enabled ? 'Enabled' : 'Disabled'}</span>
        </label>
      </header>

      <div className="afu-rows-head">
        <span>Touchpoints</span>
        <button type="button" className="afu-link-btn" onClick={onReset}>
          Reset to defaults
        </button>
      </div>

      <ol className="afu-rows">
        {state.rows.map((row, idx) => {
          const err = rowErrors.get(idx)
          return (
            <li key={idx} className={`afu-row${row.enabled ? '' : ' is-disabled'}${err ? ' has-error' : ''}`}>
              <label className="afu-row-check">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(e) => setRow(idx, { enabled: e.target.checked })}
                />
              </label>
              <span className="afu-row-num">{idx + 1}.</span>
              <input
                type="number"
                min={1}
                step={1}
                className="afu-row-value"
                value={row.value}
                onChange={(e) => setRow(idx, { value: Number(e.target.value) })}
                disabled={!row.enabled}
                aria-label={`Touchpoint ${idx + 1} interval value`}
              />
              <select
                className="afu-row-unit"
                value={row.unit}
                onChange={(e) => setRow(idx, { unit: e.target.value as Unit })}
                disabled={!row.enabled}
                aria-label={`Touchpoint ${idx + 1} interval unit`}
              >
                <option value="minutes">minutes</option>
                <option value="hours">hours</option>
                <option value="days">days</option>
              </select>
              <span className="afu-row-suffix">after last reply</span>
              {err && <span className="afu-row-error" role="alert">{err}</span>}
            </li>
          )
        })}
      </ol>

      {formError && <div className="afu-form-error" role="alert">{formError}</div>}
      {topError && <div className="afu-form-error" role="alert">{topError}</div>}

      <div className="afu-actions">
        {toast && <span className="afu-toast" role="status">{toast}</span>}
        <button type="button" className="afu-btn-secondary" onClick={onCancel} disabled={!dirty || saving}>
          Cancel
        </button>
        <button type="button" className="afu-btn-primary" onClick={onSave} disabled={!canSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the styles**

Append to `src/app/(app)/dashboard/chatbot/chatbot.css`:

```css
.afu-wrap {
  background: #ffffff;
  border: 1px solid #E5E7EB;
  border-radius: 12px;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.afu-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.afu-title {
  font-size: 16px;
  font-weight: 600;
  color: #111827;
  margin: 0;
}

.afu-help {
  font-size: 13px;
  color: #6B7280;
  margin: 4px 0 0;
}

.afu-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #111827;
  cursor: pointer;
}

.afu-rows-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  padding-bottom: 4px;
  border-bottom: 1px solid #E5E7EB;
}

.afu-link-btn {
  background: transparent;
  border: none;
  color: #059669;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  padding: 0;
}

.afu-link-btn:hover {
  text-decoration: underline;
}

.afu-rows {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.afu-row {
  display: grid;
  grid-template-columns: 28px 24px 80px 110px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 8px 4px;
  border-radius: 6px;
}

.afu-row.is-disabled {
  opacity: 0.55;
}

.afu-row.has-error {
  background: #FEF2F2;
}

.afu-row-num {
  font-size: 13px;
  color: #6B7280;
  text-align: right;
}

.afu-row-value {
  width: 80px;
  padding: 6px 10px;
  border: 1px solid #D1D5DB;
  border-radius: 6px;
  font-size: 13px;
}

.afu-row-unit {
  padding: 6px 10px;
  border: 1px solid #D1D5DB;
  border-radius: 6px;
  background: white;
  font-size: 13px;
}

.afu-row-suffix {
  font-size: 13px;
  color: #6B7280;
}

.afu-row-error {
  grid-column: 1 / -1;
  font-size: 12px;
  color: #B91C1C;
  padding-left: 70px;
}

.afu-form-error {
  background: #FEF2F2;
  border: 1px solid #FECACA;
  color: #B91C1C;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 13px;
}

.afu-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid #F3F4F6;
}

.afu-toast {
  margin-right: auto;
  font-size: 13px;
  color: #059669;
}

.afu-btn-primary,
.afu-btn-secondary {
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
}

.afu-btn-primary {
  background: #059669;
  color: white;
}

.afu-btn-primary:disabled {
  background: #A7F3D0;
  cursor: not-allowed;
}

.afu-btn-secondary {
  background: white;
  color: #111827;
  border-color: #D1D5DB;
}

.afu-btn-secondary:disabled {
  color: #9CA3AF;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/dashboard/chatbot/_components/AutoFollowupForm.tsx src/app/\(app\)/dashboard/chatbot/chatbot.css
git commit -m "feat(ui): AutoFollowupForm with master toggle + 7 row editor"
```

---

## Task 11: Wire the new tab into `chatbot/page.tsx`

**Files:**
- Modify: `src/app/(app)/dashboard/chatbot/page.tsx`

- [ ] **Step 1: Update the page**

Replace `src/app/(app)/dashboard/chatbot/page.tsx` with:

```typescript
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getChatbotConfig } from '@/lib/chatbot/config'
import { listPublicTemplates, getLatestAppliedAdoption } from '@/lib/chatbot/personality/queries'
import { fetchMediaAssets, fetchMediaFolders } from '@/app/(app)/dashboard/media/_lib/queries'
import { ConfigForm } from './_components/ConfigForm'
import { TestChat } from './_components/TestChat'
import { PersonalityTemplates } from './_components/PersonalityTemplates'
import { PrimaryGoalSection, type PrimaryGoalOption } from './_components/PrimaryGoalSection'
import { ChatbotTabs } from './_components/ChatbotTabs'
import { AutoFollowupForm } from './_components/AutoFollowupForm'
import type { PersonalityTemplate } from '@/lib/chatbot/personality/types'
import './chatbot.css'

export const dynamic = 'force-dynamic'

export default async function ChatbotPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [config, templates, latestAdoption, mediaFolders, mediaAssets, actionPagesData] = await Promise.all([
    getChatbotConfig(supabase, user.id),
    listPublicTemplates(supabase),
    getLatestAppliedAdoption(supabase, user.id),
    fetchMediaFolders(supabase, user.id),
    fetchMediaAssets(supabase, user.id, null),
    supabase
      .from('action_pages')
      .select('id, slug, title, cta_label')
      .eq('user_id', user.id)
      .eq('status', 'published')
      .order('title', { ascending: true }),
  ])
  const actionPages = (actionPagesData.data ?? []).map((p) => ({
    id: p.id as string,
    slug: p.slug as string,
    title: p.title as string,
    ctaLabel: (p.cta_label as string | null) ?? '',
  }))

  const goalOptions: PrimaryGoalOption[] = actionPages.map((p) => ({
    id: p.id,
    title: p.title,
    slug: p.slug,
  }))

  const activeTemplate = config.activeTemplateId
    ? (templates.find((t) => t.id === config.activeTemplateId) ?? null)
    : null

  const personalityContent = (
    <>
      <PersonalityTemplates
        templates={templates}
        activeTemplate={activeTemplate as PersonalityTemplate | null}
        activeAdoptionId={latestAdoption?.id ?? null}
      />
      <PrimaryGoalSection
        current={config.primaryActionPageId ?? null}
        options={goalOptions}
      />
      <ConfigForm
        key={config.updatedAt}
        initial={config}
        mediaFolders={mediaFolders}
        mediaAssets={mediaAssets}
        actionPages={actionPages}
      />
    </>
  )

  const followupContent = (
    <AutoFollowupForm initial={config.followupSettings} />
  )

  return (
    <div data-chatbot-page>
      <div className="cb-wrap">
        <div className="cb-editor">
          <ChatbotTabs
            personalityContent={personalityContent}
            followupContent={followupContent}
          />
        </div>

        <aside className="cb-test-aside">
          <TestChat name={config.name} />
        </aside>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/dashboard/chatbot/page.tsx
git commit -m "feat(ui): mount Personality + Auto Follow-Up tabs on chatbot page"
```

---

## Task 12: Manual smoke test

**Files:** none

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`
Expected: app boots on `http://localhost:3000`. Sign in.

- [ ] **Step 2: Verify the new tab loads**

Navigate to `/dashboard/chatbot`. Expected: two tabs at the top — **Personality** (active) and **Auto Follow-Up**. Personality content unchanged.

Click **Auto Follow-Up**. Expected:
- URL becomes `/dashboard/chatbot?tab=followup`.
- Master toggle is on.
- All 7 rows visible with the defaults: 5 / minutes, 1 / hours, 5 / hours, 8 / hours, 12 / hours, 18 / hours, 24 / hours.
- "Cancel" and "Save" disabled (no changes yet).

- [ ] **Step 3: Validation checks**

- Set row 3 to `30` / `minutes` (less than row 2's 1 hour). Expected: inline red error under row 3, top form error, **Save** disabled.
- Restore row 3 to `5` / `hours`.
- Set row 4 to `0`. Expected: row error "Enter a positive number." or "Minimum is 1 minute."
- Restore row 4 to `8` / `hours`.
- Uncheck all 7 rows with master ON. Expected: top form error "Enable at least one touchpoint…", **Save** disabled.
- Toggle master OFF. Expected: top error clears, rows visually dim, **Save** enabled.

- [ ] **Step 4: Save round-trip**

Toggle master OFF, click **Save**. Expected: toast "Auto follow-up updated", **Save** disables (no longer dirty). Reload the page and switch to the tab — master should remain OFF.

Re-enable master, set row 2 to `15` / `minutes`, save. Expected: success.

- [ ] **Step 5: Verify engine behavior (DB inspection)**

In `psql` (or the Supabase SQL editor), query the most recent `lead_followup_schedules` row inserted after your save. Expected: `offsets_snapshot` reflects the new schedule shape.

If you have a test Messenger thread, trigger a new lead inbound and confirm:
- With master OFF: no new row in `lead_followup_schedules`.
- With master ON and row 2 disabled: snapshot omits slot 1.

- [ ] **Step 6: Final commit (if any fixes)**

If smoke testing surfaced bugs, fix them, run `npx vitest run src/lib/followups src/app/api/chatbot/followup-settings`, and commit each fix with a descriptive message.

---

## Spec coverage check

| Spec section | Task |
|---|---|
| `chatbot_configs.followup_settings` column | Task 1 |
| `lead_followup_schedules.offsets_snapshot` column + backfill | Task 1 |
| `FOLLOWUP_SETTINGS_SCHEMA` + refinements | Task 2 |
| `DEFAULT_FOLLOWUP_SETTINGS` (single source of truth) | Task 2 |
| `loadFollowupSettings` (with DB-error fallback) | Task 2 |
| `resolveEnabledOffsets` with `slot` preservation | Task 2 |
| `OFFSETS_MS` derived from settings; `MAX_OFFSET_IDX` removed | Task 3 |
| `generateMessage` `offsetIdx` → `slot` rename | Task 4 |
| `seed.ts` consults settings + writes snapshot | Task 5 |
| `fire.ts` reads snapshot + passes `slot` | Task 6 |
| `GET / PUT /api/chatbot/followup-settings` | Task 7 |
| `getChatbotConfig` returns `followupSettings` | Task 8 |
| Tabbed UI on `/dashboard/chatbot` with URL sync | Task 9 |
| `AutoFollowupForm` (master toggle, 7 rows, validation, save) | Task 10 |
| Page wires both tab contents | Task 11 |
| Manual smoke covering validation + persistence + engine | Task 12 |
