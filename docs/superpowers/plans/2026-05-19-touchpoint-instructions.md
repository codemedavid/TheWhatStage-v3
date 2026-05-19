# Per-Touchpoint Instructions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each of the 7 auto follow-up touchpoints carry a short LLM intent/style guide ("just a quick hello", "share a benefit", "graceful sign-off"), so each step sends a different *kind* of message instead of seven near-identical generic nudges.

**Architecture:** Extend the existing `FollowupSettings` JSONB schema with one field — `instruction: string` (max 200 chars) — per touchpoint. Carry it through the seed-time `offsets_snapshot` so in-flight schedules are isolated from later edits. When non-empty, inject the instruction into the LLM system prompt as a "Touchpoint guide" block above the generic per-slot framing; when empty, behavior is unchanged from today. UI gets a single-line text input per row in `AutoFollowupForm`.

**Tech Stack:** TypeScript, Next.js App Router, zod, Supabase JSONB, vitest. Spec: `docs/superpowers/specs/2026-05-19-touchpoint-instructions-design.md`.

---

## File Structure

**Modify:**
- `src/lib/followups/settings.ts` — add `instruction` to `TouchpointSchema`, `SnapshotEntry`, `DEFAULT_FOLLOWUP_SETTINGS`; propagate in `resolveEnabledOffsets`.
- `src/lib/followups/generateMessage.ts` — accept `instruction` in `GenerateArgs`; conditional slot-0 short-circuit; inject guide block when non-empty.
- `src/lib/followups/fire.ts` — read `entry.instruction` from snapshot, forward to `generateFollowupMessage`.
- `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx` — add per-row guide input, thread through `RowDraft.instruction`, `settingsToState`, `stateToSettings`.
- `src/app/(app)/dashboard/chatbot/chatbot.css` — add `.afu-row-guide` styles; widen `.afu-row` to two visual rows.
- Test files updated alongside their sources.

**No new files. No DB migration** — `chatbot_configs.followup_settings` is already `jsonb`.

---

## Task 1: Settings schema — add `instruction` field

**Files:**
- Modify: `src/lib/followups/settings.ts`
- Test: `src/lib/followups/settings.test.ts`

- [ ] **Step 1: Write failing tests in `settings.test.ts`**

Add these tests inside the existing `describe('FOLLOWUP_SETTINGS_SCHEMA', ...)` block:

```ts
  it('defaults instruction to "" when missing on a touchpoint', () => {
    const noInstr = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t) => ({
        enabled: t.enabled,
        offset_ms: t.offset_ms,
      })),
    }
    const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(noInstr)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      for (const tp of parsed.data.touchpoints) {
        expect(tp.instruction).toBe('')
      }
    }
  })

  it('rejects instruction longer than 200 chars', () => {
    const bad = validSettings()
    bad.touchpoints[0] = { ...bad.touchpoints[0], instruction: 'x'.repeat(201) }
    expect(FOLLOWUP_SETTINGS_SCHEMA.safeParse(bad).success).toBe(false)
  })

  it('trims surrounding whitespace from instruction', () => {
    const ok = validSettings()
    ok.touchpoints[0] = { ...ok.touchpoints[0], instruction: '  hello  ' }
    const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(ok)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.touchpoints[0].instruction).toBe('hello')
  })
```

Add this inside `describe('resolveEnabledOffsets', ...)`:

```ts
  it('propagates instruction from touchpoint to snapshot entry', () => {
    const s = validSettings()
    s.touchpoints[0] = { ...s.touchpoints[0], instruction: 'quick hello' }
    s.touchpoints[2] = { ...s.touchpoints[2], instruction: 'share a benefit' }
    const snap = resolveEnabledOffsets(s)
    const slot0 = snap.find((e) => e.slot === 0)
    const slot2 = snap.find((e) => e.slot === 2)
    expect(slot0?.instruction).toBe('quick hello')
    expect(slot2?.instruction).toBe('share a benefit')
  })

  it('snapshot entries default instruction to "" when unset', () => {
    const snap = resolveEnabledOffsets(DEFAULT_FOLLOWUP_SETTINGS)
    for (const e of snap) {
      expect(typeof e.instruction).toBe('string')
    }
  })
```

Also update the existing `'returns 7-entry snapshot with slots 0..6 on defaults'` test — the existing length/slot assertions still pass, but defaults now include non-empty instructions. Add one assertion confirming slot 0's default instruction is the starter line from the spec:

```ts
    expect(snap[0].instruction).toMatch(/Quick light hello/i)
```

Update the `'cancels existing schedule then inserts new pending row when gates pass'` test's expected `offsets_snapshot` in `seed.test.ts` later in Task 4 — not here.

- [ ] **Step 2: Run failing tests**

Run: `npx vitest run src/lib/followups/settings.test.ts`

Expected: the 4 new tests fail. The existing snapshot-defaults test also fails on the new `instruction` assertion. Other tests pass.

- [ ] **Step 3: Update `settings.ts`**

Replace the file contents with:

```ts
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
const TOUCHPOINT_COUNT = 7
const MAX_INSTRUCTION_LEN = 200

const TouchpointSchema = z.object({
  enabled: z.boolean(),
  offset_ms: z.number().int().min(MIN_OFFSET_MS).max(MAX_OFFSET_MS),
  instruction: z.string().trim().max(MAX_INSTRUCTION_LEN).default(''),
})

export const FOLLOWUP_SETTINGS_SCHEMA = z
  .object({
    enabled: z.boolean(),
    touchpoints: z.array(TouchpointSchema).length(TOUCHPOINT_COUNT),
  })
  .superRefine((val, ctx) => {
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
    { enabled: true, offset_ms: 5 * 60_000,        instruction: 'Quick light hello — just ask if still interested po.' },
    { enabled: true, offset_ms: 60 * 60_000,       instruction: 'Friendly nudge — offer to answer any questions.' },
    { enabled: true, offset_ms: 5 * 3_600_000,     instruction: 'Share one concrete benefit or social proof — keep it short.' },
    { enabled: true, offset_ms: 8 * 3_600_000,     instruction: "Ask one focused question to surface what's blocking them." },
    { enabled: true, offset_ms: 12 * 3_600_000,    instruction: 'Light reminder — emphasize convenience and flexibility.' },
    { enabled: true, offset_ms: 18 * 3_600_000,    instruction: 'Soft scarcity or a clear call to decide — no pressure.' },
    { enabled: true, offset_ms: 24 * 3_600_000,    instruction: 'Last graceful check — invite them to message anytime.' },
  ],
}

export interface SnapshotEntry {
  offset_ms: number
  slot: number
  instruction: string
}

export function resolveEnabledOffsets(settings: FollowupSettings): SnapshotEntry[] {
  if (!settings.enabled) return []
  const entries: SnapshotEntry[] = settings.touchpoints
    .map((t, slot) => ({ t, slot }))
    .filter((x) => x.t.enabled)
    .map((x) => ({
      slot: x.slot,
      offset_ms: x.t.offset_ms,
      instruction: x.t.instruction,
    }))
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

Notes on the change:
- `TouchpointSchema` has `instruction: z.string().trim().max(200).default('')`. The `.default('')` makes the field optional on input, so legacy DB rows that omit it parse cleanly.
- `SnapshotEntry` gains `instruction: string`.
- `DEFAULT_FOLLOWUP_SETTINGS` ships starter instructions matching the spec table.
- `resolveEnabledOffsets` copies instruction into snapshot entries.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/followups/settings.test.ts`

Expected: all tests pass (existing 14 + 4 new = 18).

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/settings.ts src/lib/followups/settings.test.ts
git commit -m "feat(followups): add per-touchpoint instruction to settings schema"
```

---

## Task 2: `generateMessage.ts` — accept and use the instruction

**Files:**
- Modify: `src/lib/followups/generateMessage.ts`
- Test: `src/lib/followups/generateMessage.test.ts`

- [ ] **Step 1: Write failing tests in `generateMessage.test.ts`**

Append these tests to the existing `describe('generateFollowupMessage', ...)` block:

```ts
  it('calls the LLM for slot 0 when an instruction is set (no short-circuit)', async () => {
    completeMock.mockResolvedValueOnce('Hi Ana, kumusta na po?')
    const text = await generateFollowupMessage({
      kind: 'generic',
      slot: 0,
      leadName: 'Ana',
      personalityBlock: '',
      recentMessages: [],
      instruction: 'Quick warm hello, ask if still interested.',
    })
    expect(completeMock).toHaveBeenCalledTimes(1)
    expect(text).toBe('Hi Ana, kumusta na po?')
  })

  it('still short-circuits slot 0 to the fallback when instruction is empty', async () => {
    const text = await generateFollowupMessage({
      kind: 'generic',
      slot: 0,
      leadName: 'Jay',
      personalityBlock: '',
      recentMessages: [],
      instruction: '',
    })
    expect(completeMock).not.toHaveBeenCalled()
    expect(text).toBe('Hi Jay, interested pa po kayo?')
  })

  it('injects the Touchpoint guide block into the system prompt when instruction is set', async () => {
    completeMock.mockResolvedValueOnce('Hi Ana, share lang po na flexible kami sa schedule.')
    await generateFollowupMessage({
      kind: 'real',
      slot: 2,
      leadName: 'Ana',
      personalityBlock: 'warm',
      recentMessages: [
        { role: 'user', content: 'magkano po?' },
        { role: 'assistant', content: '5k po.' },
      ],
      instruction: 'Share a concrete benefit or social proof.',
    })
    const messages = completeMock.mock.calls[0][0] as Array<{ role: string; content: string }>
    const system = messages.find((m) => m.role === 'system')!
    expect(system.content).toContain('Touchpoint guide for THIS message')
    expect(system.content).toContain('Share a concrete benefit or social proof.')
  })

  it('omits the Touchpoint guide block when instruction is empty (no behavior change)', async () => {
    completeMock.mockResolvedValueOnce('hi')
    await generateFollowupMessage({
      kind: 'real',
      slot: 3,
      leadName: 'Ana',
      personalityBlock: '',
      recentMessages: [],
      instruction: '',
    })
    const messages = completeMock.mock.calls[0][0] as Array<{ role: string; content: string }>
    const system = messages.find((m) => m.role === 'system')!
    expect(system.content).not.toContain('Touchpoint guide')
  })

  it('falls back when LLM fails even with an instruction set', async () => {
    completeMock.mockRejectedValueOnce(new Error('boom'))
    const text = await generateFollowupMessage({
      kind: 'generic',
      slot: 4,
      leadName: 'Jay',
      personalityBlock: '',
      recentMessages: [],
      instruction: 'Light reminder.',
    })
    // Fallback for slot 4 generic.
    expect(text).toBe('Hi Jay, available pa po kayo to chat?')
  })
```

Update the existing tests that call `generateFollowupMessage` without `instruction`:

```ts
  // 'uses the LLM response when it returns content (real, offset 2)' — add `instruction: ''` to args
  // 'uses the fallback pool when LLM throws (generic, offset 0)' — add `instruction: ''`
  // 'forces offset 0 to be a light check-in for both kinds' — add `instruction: ''`
  // 'sanitizes LLM output (dashes stripped, one line)' — add `instruction: ''`
```

Also rename `'forces offset 0 to be a light check-in for both kinds'` → `'short-circuits slot 0 to the fallback when instruction is empty (both kinds)'` for clarity, or leave the name and just thread through `instruction: ''`. The existing assertion that `completeMock` was set but is never used should hold — slot 0 with empty instruction still skips the LLM.

Actually re-read the existing test: it calls `completeMock.mockResolvedValueOnce(' "Hi Ana, interested pa po kayo?" ')` and expects the fallback `'Hi Ana, interested pa po kayo?'`. This test currently passes *because* slot 0 short-circuits the LLM call — the `mockResolvedValueOnce` is set but never consumed. Keep the behavior identical with `instruction: ''`.

- [ ] **Step 2: Run failing tests**

Run: `npx vitest run src/lib/followups/generateMessage.test.ts`

Expected: the 5 new tests fail (with `instruction is undefined` or similar). Existing tests fail because `instruction` is now a required arg on `GenerateArgs`. That's fine — we update them in Step 3.

- [ ] **Step 3: Update `generateMessage.ts`**

Replace the file with:

```ts
// src/lib/followups/generateMessage.ts
//
// One LLM call per follow-up. Hard rules baked into the system prompt:
//   one line, ≤200 chars, no dashes, no markdown, match personality.
// Slot 0 short-circuits to the fallback pool ONLY when no per-touchpoint
// instruction is set — when the user provides a guide for slot 0 we honor
// it and pay for the LLM call. Generic-kind messages don't include the
// message history. Real-kind messages pass the last 20 turns so the LLM
// can reference what was said. 8s LLM timeout; on failure or empty response,
// fall back to a curated per-offset pool so the user never sees a dropped
// touchpoint.

import { HfRouterLlm } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'
import { manilaNowBlock } from '@/lib/time/manilaNow'
import { sanitizeFollowup } from './sanitize'
import { OFFSETS_MS, type ConversationKind } from './config'

const LLM_TIMEOUT_MS = 8_000

export interface GenerateArgs {
  kind: ConversationKind
  slot: number
  leadName: string | null
  personalityBlock: string
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  instruction: string
}

const FALLBACK_POOL: Record<ConversationKind, string[]> = {
  generic: [
    'Hi {name}, interested pa po kayo?',
    'Hi {name}, may follow up lang po, anything I can help with?',
    'Hi {name}, balik lang po ako, anong sa tingin niyo?',
    'Hi {name}, gusto niyo pa po ba ituloy?',
    'Hi {name}, available pa po kayo to chat?',
    'Hi {name}, last check po, may itatanong pa po ba kayo?',
    'Hi {name}, balik na lang po kayo anytime kung interested.',
  ],
  real: [
    'Hi {name}, interested pa po kayo?',
    'Hi {name}, anything pa po na gusto niyong i clarify?',
    'Hi {name}, balikan lang po, ano sa tingin niyo so far?',
    'Hi {name}, naisip niyo na po ba ituloy?',
    'Hi {name}, sabihan niyo lang po kung kailangan pa ng info.',
    'Hi {name}, follow up po, gusto niyo pa po ba i pursue?',
    'Hi {name}, kahit anong oras po pwede tayo ulit mag usap.',
  ],
}

function firstName(name: string | null): string {
  if (!name) return ''
  return name.trim().split(/\s+/)[0]
}

function fallback(kind: ConversationKind, slot: number, leadName: string | null): string {
  const safeSlot = Math.max(0, Math.min(OFFSETS_MS.length - 1, slot))
  const line = FALLBACK_POOL[kind][safeSlot]
  const fn = firstName(leadName)
  return sanitizeFollowup(line.replace('{name}', fn || 'there'))
}

function buildSystemPrompt(args: GenerateArgs): string {
  const rules =
    'Hard rules: one line only, max 200 characters, no dashes ("-", "—", "–"), no markdown, no emojis ' +
    'unless the personality calls for them. Match the personality language (Tagalog, Taglish, or English). ' +
    'Sound human, never robotic. Never start with "Hello! I am..." or generic AI phrasing.'
  const personality = args.personalityBlock?.trim()
    ? `Personality / tone:\n${args.personalityBlock.trim()}\n\n`
    : ''
  const fnHint = firstName(args.leadName) ? `Use the customer's first name once: ${firstName(args.leadName)}.\n` : ''
  const prefix = `${manilaNowBlock()}\n\n`

  const trimmedInstr = args.instruction?.trim() ?? ''
  const guide = trimmedInstr
    ? `Touchpoint guide for THIS message (#${args.slot + 1} of 7):\n` +
      `${JSON.stringify(trimmedInstr)}\n` +
      `Follow this guide. Keep the personality and language rules.\n\n`
    : ''

  if (args.kind === 'generic') {
    return (
      prefix +
      `${personality}` +
      `${guide}` +
      `You are writing follow-up message #${args.slot + 1} of 7 to a Messenger lead who replied earlier ` +
      `but has gone quiet. The previous exchange had less than 4 messages from the lead, so DO NOT pretend ` +
      `to remember specifics. Write a warm, light check-in that nudges them to reply. ` +
      `${fnHint}${rules}`
    )
  }
  return (
    prefix +
    `${personality}` +
    `${guide}` +
    `You are writing follow-up message #${args.slot + 1} of 7 to a Messenger lead who has gone quiet ` +
    `after a real back-and-forth. Reference what was already discussed naturally and propose a concrete ` +
    `next step or ask one focused question. ${fnHint}${rules}`
  )
}

function buildUserPrompt(args: GenerateArgs): string {
  if (args.kind === 'generic' || args.recentMessages.length === 0) {
    return `Write follow-up #${args.slot + 1} now. Do not repeat earlier phrasings.`
  }
  const transcript = args.recentMessages
    .slice(-20)
    .map((m) => (m.role === 'user' ? `Customer: ${m.content}` : `You earlier: ${m.content}`))
    .join('\n')
  return `Last messages in the conversation:\n${transcript}\n\nWrite follow-up #${args.slot + 1} now.`
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('llm_timeout')), ms)),
  ])
}

export async function generateFollowupMessage(args: GenerateArgs): Promise<string> {
  const hasInstruction = (args.instruction ?? '').trim().length > 0
  if (!hasInstruction && args.slot === 0) {
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

Key changes:
- `GenerateArgs.instruction: string` added (required).
- Slot-0 short-circuit now gated on instruction being empty.
- New `guide` block injected after personality and before the slot framing when instruction is non-empty. `JSON.stringify(trimmedInstr)` wraps the user text in escaped quotes so embedded quotes/newlines never break the prompt structure.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/followups/generateMessage.test.ts`

Expected: all 9 tests pass (4 existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/generateMessage.ts src/lib/followups/generateMessage.test.ts
git commit -m "feat(followups): honor per-touchpoint instruction in LLM prompt"
```

---

## Task 3: `fire.ts` — forward instruction from snapshot

**Files:**
- Modify: `src/lib/followups/fire.ts`
- Test: `src/lib/followups/fire.test.ts`

- [ ] **Step 1: Write failing test in `fire.test.ts`**

Add inside `describe('handleFollowupSend', ...)`:

```ts
  it('forwards the instruction from the snapshot entry to generateFollowupMessage', async () => {
    const snapWithInstr = [
      { offset_ms: 300000,   slot: 0, instruction: 'quick hello po' },
      { offset_ms: 3600000,  slot: 1, instruction: 'ask one question' },
      { offset_ms: 18000000, slot: 2, instruction: 'share a benefit' },
      { offset_ms: 28800000, slot: 3, instruction: '' },
      { offset_ms: 43200000, slot: 4, instruction: '' },
      { offset_ms: 64800000, slot: 5, instruction: '' },
      { offset_ms: 86400000, slot: 6, instruction: '' },
    ]
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('hi')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fbi' })
    const { admin } = makeAdmin({
      ...baseSeed,
      schedule: { ...schedule, next_offset_idx: 2, offsets_snapshot: snapWithInstr },
    })

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 2, instruction: 'share a benefit' }),
    )
  })

  it('forwards instruction="" when snapshot entry lacks the field (legacy)', async () => {
    // Legacy snapshot rows seeded before this feature have no `instruction` key.
    const legacySnap = [
      { offset_ms: 300000,   slot: 0 },
      { offset_ms: 3600000,  slot: 1 },
      { offset_ms: 18000000, slot: 2 },
      { offset_ms: 28800000, slot: 3 },
      { offset_ms: 43200000, slot: 4 },
      { offset_ms: 64800000, slot: 5 },
      { offset_ms: 86400000, slot: 6 },
    ]
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('hi')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fbl' })
    const { admin } = makeAdmin({
      ...baseSeed,
      schedule: { ...schedule, next_offset_idx: 1, offsets_snapshot: legacySnap as never },
    })

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 1, instruction: '' }),
    )
  })
```

Also update the existing `FakeRow.offsets_snapshot` type in this file to allow the optional `instruction` field:

```ts
  offsets_snapshot: Array<{ offset_ms: number; slot: number; instruction?: string }>
```

- [ ] **Step 2: Run failing tests**

Run: `npx vitest run src/lib/followups/fire.test.ts`

Expected: the 2 new tests fail because `fire.ts` doesn't pass `instruction` yet.

- [ ] **Step 3: Update `fire.ts`**

In the `generateFollowupMessage` call (around `fire.ts:139`), add `instruction`:

```ts
  const text = await generateFollowupMessage({
    kind: schedule.conversation_kind,
    slot: entry.slot,
    leadName,
    personalityBlock,
    recentMessages,
    instruction: entry.instruction ?? '',
  })
```

The `?? ''` is defensive against legacy snapshot rows that pre-date this feature.

The `SnapshotEntry` import already comes from `./settings` and now carries `instruction`, so no other change needed.

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/followups/fire.test.ts`

Expected: all tests pass (existing 6 + 2 new = 8).

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/fire.ts src/lib/followups/fire.test.ts
git commit -m "feat(followups): forward instruction from snapshot to generator"
```

---

## Task 4: Update `seed.test.ts` snapshot expectations

**Files:**
- Modify: `src/lib/followups/seed.test.ts`

The seed code itself (`seed.ts`) does not change — `resolveEnabledOffsets` already includes `instruction` after Task 1. But two existing tests assert the literal shape of `offsets_snapshot` without instructions and now fail.

- [ ] **Step 1: Run the existing tests to confirm the breakage**

Run: `npx vitest run src/lib/followups/seed.test.ts`

Expected: two tests fail — `'cancels existing schedule then inserts new pending row when gates pass'` and `'honors per-touchpoint disable: snapshot contains only enabled rows with original slots'`. Both fail because the inserted `offsets_snapshot` now carries an `instruction` field on each entry.

- [ ] **Step 2: Update the first expected snapshot**

In the `'cancels existing schedule then inserts new pending row when gates pass'` test, replace the `expect(inserted.offsets_snapshot).toEqual([...])` block with:

```ts
    expect(inserted.offsets_snapshot).toEqual([
      { offset_ms: 300000,   slot: 0, instruction: 'Quick light hello — just ask if still interested po.' },
      { offset_ms: 3600000,  slot: 1, instruction: 'Friendly nudge — offer to answer any questions.' },
      { offset_ms: 18000000, slot: 2, instruction: 'Share one concrete benefit or social proof — keep it short.' },
      { offset_ms: 28800000, slot: 3, instruction: "Ask one focused question to surface what's blocking them." },
      { offset_ms: 43200000, slot: 4, instruction: 'Light reminder — emphasize convenience and flexibility.' },
      { offset_ms: 64800000, slot: 5, instruction: 'Soft scarcity or a clear call to decide — no pressure.' },
      { offset_ms: 86400000, slot: 6, instruction: 'Last graceful check — invite them to message anytime.' },
    ])
```

- [ ] **Step 3: Update the second expected snapshot**

In the `'honors per-touchpoint disable: snapshot contains only enabled rows with original slots'` test, replace its `expect(ins.offsets_snapshot).toEqual([...])` block with:

```ts
    expect(ins.offsets_snapshot).toEqual([
      { offset_ms: 300000,   slot: 0, instruction: 'Quick light hello — just ask if still interested po.' },
      { offset_ms: 18000000, slot: 2, instruction: 'Share one concrete benefit or social proof — keep it short.' },
      { offset_ms: 43200000, slot: 4, instruction: 'Light reminder — emphasize convenience and flexibility.' },
      { offset_ms: 86400000, slot: 6, instruction: 'Last graceful check — invite them to message anytime.' },
    ])
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/followups/seed.test.ts`

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/seed.test.ts
git commit -m "test(followups): update seed snapshot expectations for instruction field"
```

---

## Task 5: API route test — instruction round-trip

**Files:**
- Modify: `src/app/api/chatbot/followup-settings/route.test.ts`

- [ ] **Step 1: Add a failing-then-passing legacy-payload test**

Append to `describe('PUT /api/chatbot/followup-settings', ...)`:

```ts
  it('accepts payloads missing the instruction field and defaults to ""', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    let captured: unknown = null
    const upsertSpy = vi.fn(async (row: unknown) => {
      captured = row
      return { error: null }
    })
    supabaseFromMock.mockImplementation(() => ({ upsert: upsertSpy }))

    const legacyPayload = {
      enabled: true,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t) => ({
        enabled: t.enabled,
        offset_ms: t.offset_ms,
      })),
    }
    const res = await PUT(makeReq({ settings: legacyPayload }))
    expect(res.status).toBe(200)
    const stored = (captured as { followup_settings: { touchpoints: Array<{ instruction: string }> } })
      .followup_settings
    for (const tp of stored.touchpoints) {
      expect(tp.instruction).toBe('')
    }
  })

  it('round-trips a payload with instructions set', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const upsertSpy = vi.fn(async () => ({ error: null }))
    supabaseFromMock.mockImplementation(() => ({ upsert: upsertSpy }))

    const withInstrs = {
      ...DEFAULT_FOLLOWUP_SETTINGS,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        ...t,
        instruction: `step ${i + 1} guide`,
      })),
    }
    const res = await PUT(makeReq({ settings: withInstrs }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { settings: typeof withInstrs }
    expect(body.settings.touchpoints.map((t) => t.instruction)).toEqual([
      'step 1 guide', 'step 2 guide', 'step 3 guide', 'step 4 guide',
      'step 5 guide', 'step 6 guide', 'step 7 guide',
    ])
  })

  it('rejects an instruction longer than 200 chars with 400', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const bad = {
      ...DEFAULT_FOLLOWUP_SETTINGS,
      touchpoints: DEFAULT_FOLLOWUP_SETTINGS.touchpoints.map((t, i) => ({
        ...t,
        instruction: i === 0 ? 'x'.repeat(201) : '',
      })),
    }
    const res = await PUT(makeReq({ settings: bad }))
    expect(res.status).toBe(400)
  })
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/app/api/chatbot/followup-settings/route.test.ts`

Expected: all 3 new tests pass — they exercise behavior already provided by the schema change in Task 1. Existing tests still pass.

If a test fails, debug; the route code itself does not need changes.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/chatbot/followup-settings/route.test.ts
git commit -m "test(followups): cover instruction round-trip and legacy payloads"
```

---

## Task 6: UI — `AutoFollowupForm` guide input per row

**Files:**
- Modify: `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx`

This task has no automated test — the form is exercised manually after the change. The dirty/cancel/save logic uses `JSON.stringify` comparison so it picks up the new field automatically.

- [ ] **Step 1: Update `RowDraft` and the converters**

In `AutoFollowupForm.tsx`, change:

```ts
interface RowDraft {
  enabled: boolean
  value: number
  unit: Unit
  instruction: string
}
```

Update `settingsToState`:

```ts
function settingsToState(s: FollowupSettings): FormState {
  return {
    enabled: s.enabled,
    rows: s.touchpoints.map((t) => {
      const { value, unit } = msToDraft(t.offset_ms)
      return { enabled: t.enabled, value, unit, instruction: t.instruction }
    }),
  }
}
```

Update `stateToSettings`:

```ts
function stateToSettings(s: FormState): FollowupSettings {
  return {
    enabled: s.enabled,
    touchpoints: s.rows.map((r) => ({
      enabled: r.enabled,
      offset_ms: draftToMs(r),
      instruction: r.instruction,
    })),
  }
}
```

- [ ] **Step 2: Add the guide input to each row in the JSX**

Find the existing `<li>` row in the `state.rows.map` block (around line 192). Replace it with:

```tsx
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
              <div className="afu-row-guide">
                <label className="afu-row-guide-label" htmlFor={`afu-guide-${idx}`}>
                  Guide
                </label>
                <input
                  id={`afu-guide-${idx}`}
                  type="text"
                  className="afu-row-guide-input"
                  maxLength={200}
                  value={row.instruction}
                  onChange={(e) => setRow(idx, { instruction: e.target.value })}
                  disabled={!row.enabled}
                  placeholder="Leave blank to use the default style for this touchpoint."
                  aria-label={`Touchpoint ${idx + 1} message guide`}
                />
                <span className="afu-row-guide-count" aria-hidden="true">
                  {row.instruction.length}/200
                </span>
              </div>
            </li>
```

- [ ] **Step 3: Smoke-test the form manually**

Run the dev server: `npm run dev`

Open `/dashboard/chatbot?tab=followup` and verify:
1. Each touchpoint shows a "Guide" input below the timing row, prefilled with the starter instruction.
2. Editing a guide marks the form dirty (Save button enables).
3. The 200-char counter updates as you type and the input enforces the cap.
4. Disabling a row greys out the guide input.
5. "Reset to defaults" restores the starter instructions.
6. Saving persists, then reloading the page shows the new values.

If the dev server is already running, just refresh.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/dashboard/chatbot/_components/AutoFollowupForm.tsx
git commit -m "feat(ui): per-touchpoint guide input in AutoFollowupForm"
```

---

## Task 7: CSS for the guide row

**Files:**
- Modify: `src/app/(app)/dashboard/chatbot/chatbot.css`

- [ ] **Step 1: Add the new selectors**

Append after the existing `.afu-row-error { ... }` block (around line 1201):

```css
.afu-row-guide {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 64px 1fr auto;
  align-items: center;
  gap: 8px;
  padding-left: 70px;
  padding-top: 2px;
}

.afu-row-guide-label {
  font-size: 12px;
  color: #6B7280;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.afu-row-guide-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #D1D5DB;
  border-radius: 6px;
  font-size: 13px;
  background: white;
}

.afu-row-guide-input:disabled {
  background: #F9FAFB;
  cursor: not-allowed;
}

.afu-row-guide-count {
  font-size: 11px;
  color: #9CA3AF;
  font-variant-numeric: tabular-nums;
  min-width: 48px;
  text-align: right;
}
```

The `padding-left: 70px` aligns the guide row's content with the controls above it (matching `.afu-row-error`'s existing alignment trick).

- [ ] **Step 2: Verify in the browser**

Refresh `/dashboard/chatbot?tab=followup`. Confirm:
- The "Guide" label and input render on a second visual row beneath the timing controls.
- Disabled rows show a greyed-out input background.
- The counter is right-aligned and reads e.g. `42/200`.
- Layout is not crowded on standard desktop widths.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/dashboard/chatbot/chatbot.css
git commit -m "feat(ui): styles for AutoFollowupForm guide row"
```

---

## Final verification

- [ ] **Step 1: Run the full followups test suite**

Run: `npx vitest run src/lib/followups src/app/api/chatbot/followup-settings`

Expected: every test passes (settings, generateMessage, fire, seed, gates, sanitize, route).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Manual end-to-end sanity check**

In `/dashboard/chatbot?tab=followup`:
1. Change touchpoint 1's guide to something distinctive, e.g. `"Just a quick hello po — ask kung interested pa rin sila."`. Save.
2. (Optional) Trigger the seed path by replying as a test lead through Messenger, then watch `lead_followup_schedules.offsets_snapshot` in Supabase — slot 0's row should carry your new instruction string.
3. (Optional, takes 5 minutes) Let the first touchpoint fire and confirm the LLM output reflects the guide instead of a generic check-in.

For (2) and (3), the test environment may not have Messenger wired up — skip if not available, the unit tests cover the integration.

---

## Self-Review

**Spec coverage:**
- Data model + `instruction` field + zod schema → Task 1.
- Starter defaults table → Task 1, Step 3 (DEFAULT_FOLLOWUP_SETTINGS).
- Snapshot behavior (`SnapshotEntry`, `resolveEnabledOffsets`) → Task 1.
- Conditional slot-0 short-circuit → Task 2.
- "Touchpoint guide" system-prompt block → Task 2.
- `GenerateArgs.instruction` → Task 2.
- Fire path forwards instruction → Task 3.
- Seed-time snapshot persistence test coverage → Task 4 (snapshot expectations updated).
- API route round-trip + legacy payload + 400 on over-long → Task 5.
- UI per-row guide input → Task 6.
- CSS → Task 7.
- Backward compatibility (legacy rows + snapshots) → covered in Task 1 (schema `.default('')`) and Task 3 (`entry.instruction ?? ''`).

**Placeholder scan:** No "TBD", no "implement later", no "add validation appropriately". Every code step shows complete code. Every test step shows full assertion code.

**Type consistency:** `instruction: string` used identically across `Touchpoint`, `SnapshotEntry`, `GenerateArgs`, `RowDraft`. Defaults to `''`. The `?? ''` fallback in `fire.ts` is the only spot it can be undefined at runtime (legacy snapshots).

**Scope check:** Single-feature plan, all changes in `src/lib/followups`, one component, one CSS file. One coherent diff.

No issues found.
