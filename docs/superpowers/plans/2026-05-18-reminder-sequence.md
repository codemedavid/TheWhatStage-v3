# Reminder Sequence + Time-Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated 7-touchpoint Fibonacci-cadence reminder sequence that activates when a customer requests a future follow-up, suppresses the default auto silent-followup for the duration, and pre-generates message bodies upfront. Also inject "current Manila time" into every customer-facing LLM call so the AI stops fabricating dates.

**Architecture:** New table `lead_reminder_sequences` (one row per request, holds anchor + topic + status). Touchpoint rows are normal `lead_reminders` rows linked by `sequence_id` + `sequence_position` — so the existing cron, fire worker, and dashboard keep working unchanged for the firing path. The sequence row's `status` is the only gate any touchpoint consults at fire time, so cancel/resolve/reschedule update one row. A shared `manilaNowBlock()` helper is prepended to every LLM system prompt that writes customer-facing text.

**Tech Stack:** Next.js App Router (Node runtime), Supabase Postgres + pg_cron, Vitest. LLM client = existing `HfRouterLlm` (`src/lib/rag/llm.ts`) backed by DeepSeek-V4-Flash via OpenRouter (configured in `src/lib/rag/config.ts`).

---

## File structure

**Create:**
- `src/lib/time/manilaNow.ts` — shared "Asia/Manila now" helper + system-prompt one-liner builder.
- `src/lib/time/manilaNow.test.ts`
- `src/lib/reminders/hasTimeMarker.ts` — regex pre-filter so `extractReminder` skips chatty messages with no time intent.
- `src/lib/reminders/hasTimeMarker.test.ts`
- `src/lib/reminders/sequence.ts` — `SEQUENCE_OFFSETS_DAYS`, `SEQUENCE_LENGTH`, position-role descriptions, `scheduledAtForPosition()`.
- `src/lib/reminders/sequence-fallbacks.ts` — curated per-position fallback lines (Taglish), sanitized.
- `src/lib/reminders/sequence-generate.ts` — pure prompt builder + single-position LLM call with timeout + sanitization.
- `src/lib/reminders/sequence-generate.test.ts`
- `src/lib/reminders/sequence-seed.ts` — `seedReminderSequence`: cancels prior active, inserts sequence row + 7 touchpoints with parallel pre-generation via `Promise.allSettled`.
- `src/lib/reminders/sequence-seed.test.ts`
- `src/lib/reminders/sequence-resolve.ts` — `resolveActiveSequence`: wraps `resolveTopics` against the single shared topic and flips the sequence row.
- `src/lib/reminders/sequence-resolve.test.ts`
- `src/app/api/reminders/sequences/[id]/route.ts` — `PATCH` cancel + `GET` detail (sequence + its 7 touchpoints).
- `supabase/migrations/20260602000000_lead_reminder_sequences.sql`

**Modify:**
- `src/lib/reminders/extract.ts` — swap inline `nowInManila()` for shared `manilaNow()`; add `hasTimeMarker` pre-filter.
- `src/lib/reminders/fire.ts` — load parent sequence when `sequence_id` set; skip if `status != 'active'`; use late-refresh order (fresh LLM → `pre_generated_text` → `fallback_text`); add `manilaNowBlock` to the prompt.
- `src/lib/rag/prompt-builder.ts` — prepend `manilaNowBlock()` to `assembleSystemPrompt`.
- `src/lib/agent/generateDraft.ts` — prepend `manilaNowBlock()` to the system message.
- `src/lib/followups/generateMessage.ts` — prepend `manilaNowBlock()` to `buildSystemPrompt`.
- `src/app/api/messenger/process/route.ts` — move `extractReminder` call to pre-reply (synchronous); gate `maybeScheduleFollowup` on (a) reminder detection AND (b) active sequence presence; replace plain `lead_reminders` insert in `processReminderHooks` with `seedReminderSequence`; route resolution through `resolveActiveSequence` when a sequence is active.
- `src/app/(app)/dashboard/reminders/page.tsx` — group rows by `sequence_id` when present.
- `src/app/(app)/dashboard/reminders/_components/RemindersClient.tsx` — render sequence groups with a single cancel-all button.

**Do NOT change:**
- `src/lib/reminders/resolve.ts` — `resolveTopics` is reused as-is.
- `src/app/api/cron/reminders-tick/route.ts` — unchanged; touchpoint rows look exactly like one-off reminders to the cron.
- `src/app/api/reminders/[id]/route.ts` — per-touchpoint operations still work.
- `src/lib/followups/seed.ts`, `gates.ts`, `config.ts` — only the route caller's gating logic changes, not these modules.

---

## Conventions used by this plan

- **Tests live next to implementation files** as `*.test.ts`. Run via `pnpm test <relative-path>` or `pnpm test -- <pattern>`.
- **Mock pattern**: existing tests mock `@/lib/rag/llm` and `@/lib/rag/config` via `vi.mock(...)` returning a class with a `complete` mock. Follow that pattern verbatim.
- **Commit each task individually**. Use `feat:`, `test:`, `chore:`, `refactor:` prefixes matching the repo's existing style.
- **Migrations** are applied via the Supabase MCP `apply_migration` tool (the project is linked, see `AGENTS.md`). Local apply not required for review.

---

### Task 1: Shared Manila time helper

**Files:**
- Create: `src/lib/time/manilaNow.ts`
- Test: `src/lib/time/manilaNow.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/time/manilaNow.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { manilaNow, manilaNowBlock, MANILA_TZ } from './manilaNow'

describe('manilaNow', () => {
  it('formats a known UTC date as Asia/Manila (UTC+08)', () => {
    // 2026-05-18T06:32:00Z -> 2026-05-18 14:32 Asia/Manila (Monday)
    const n = manilaNow(new Date('2026-05-18T06:32:00Z'))
    expect(n.iso).toBe('2026-05-18 14:32')
    expect(n.weekday).toBe('Monday')
    expect(n.dateLong).toBe('Monday, May 18, 2026')
    expect(n.utcIso).toBe('2026-05-18T06:32:00.000Z')
  })

  it('rolls into the next Manila day across UTC midnight', () => {
    // 2026-05-18T16:30:00Z -> 2026-05-19 00:30 Asia/Manila
    const n = manilaNow(new Date('2026-05-18T16:30:00Z'))
    expect(n.iso).toBe('2026-05-19 00:30')
    expect(n.weekday).toBe('Tuesday')
  })

  it('exports the timezone constant', () => {
    expect(MANILA_TZ).toBe('Asia/Manila')
  })
})

describe('manilaNowBlock', () => {
  it('returns a one-line system-prompt prefix with the formatted time', () => {
    const block = manilaNowBlock(new Date('2026-05-18T06:32:00Z'))
    expect(block).toBe(
      'Current time: Monday, May 18, 2026, 14:32 (Asia/Manila, UTC+08:00).',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/time/manilaNow.test.ts`
Expected: FAIL with "Cannot find module './manilaNow'".

- [ ] **Step 3: Implement**

`src/lib/time/manilaNow.ts`:

```ts
// Shared "now in Asia/Manila" helper. Manila is fixed UTC+08:00 (no DST),
// so the formatting is deterministic and safe for system-prompt injection.

export const MANILA_TZ = 'Asia/Manila'

export interface ManilaNow {
  iso: string // "2026-05-18 14:32"
  weekday: string // "Monday"
  dateLong: string // "Monday, May 18, 2026"
  utcIso: string // "2026-05-18T06:32:00.000Z"
}

function partsInManila(d: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'long',
  })
  return Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]))
}

function monthLong(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TZ,
    month: 'long',
  }).format(d)
}

export function manilaNow(d: Date = new Date()): ManilaNow {
  const p = partsInManila(d)
  const hour = p.hour === '24' ? '00' : p.hour // Intl quirk on some Node versions
  const iso = `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}`
  const month = monthLong(d)
  const dateLong = `${p.weekday}, ${month} ${Number(p.day)}, ${p.year}`
  return {
    iso,
    weekday: p.weekday,
    dateLong,
    utcIso: d.toISOString(),
  }
}

export function manilaNowBlock(d: Date = new Date()): string {
  const n = manilaNow(d)
  const time = n.iso.slice(11) // "14:32"
  return `Current time: ${n.dateLong}, ${time} (Asia/Manila, UTC+08:00).`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/time/manilaNow.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/time/manilaNow.ts src/lib/time/manilaNow.test.ts
git commit -m "feat(time): shared manilaNow helper for LLM system prompts"
```

---

### Task 2: hasTimeMarker pre-filter

**Files:**
- Create: `src/lib/reminders/hasTimeMarker.ts`
- Test: `src/lib/reminders/hasTimeMarker.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/reminders/hasTimeMarker.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { hasTimeMarker } from './hasTimeMarker'

describe('hasTimeMarker', () => {
  const positives = [
    'follow up tomorrow',
    'follow up later po',
    'message me at 2pm',
    'follow up Wednesday',
    'chat me back on May 12',
    'ping me sa Lunes',
    'follow up mamaya',
    'kausapin mo ako bukas',
    'follow up next Monday morning',
    "I'll be free at 3:30 PM, ping me then",
    'free ako on July 4',
    'balikan mo ako sa Miyerkules ng hapon',
    'sa Sabado ng umaga',
    "let's talk tonight",
    'try me again sa Linggo',
  ]

  const negatives = [
    'how much po?',
    'thanks!',
    'haha sige',
    'pwede pa po ba?',
    'gusto ko po malaman ang price',
    'di ko alam',
    'okay lang',
    "I'll think about it",
  ]

  it.each(positives)('returns true for: %s', (msg) => {
    expect(hasTimeMarker(msg)).toBe(true)
  })

  it.each(negatives)('returns false for: %s', (msg) => {
    expect(hasTimeMarker(msg)).toBe(false)
  })

  it('handles empty input', () => {
    expect(hasTimeMarker('')).toBe(false)
    expect(hasTimeMarker('   ')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/reminders/hasTimeMarker.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`src/lib/reminders/hasTimeMarker.ts`:

```ts
// Cheap regex pre-filter that decides whether to spend an LLM call on
// `extractReminder`. False positives are fine (extractReminder will say no);
// false negatives are the failure mode we care about — be permissive.

const TIME_WORD_RE = new RegExp(
  [
    // English weekdays
    '\\b(mon|tue|wed|thu|fri|sat|sun)(day)?\\b',
    // Tagalog/Taglish weekdays
    '\\b(lunes|martes|miyerkules|miyerkoles|huwebes|biyernes|sabado|linggo)\\b',
    // English months
    '\\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\\b',
    // Tagalog months
    '\\b(enero|pebrero|marso|abril|mayo|hunyo|hulyo|agosto|setyembre|oktubre|nobyembre|disyembre)\\b',
    // Relative time words
    '\\b(today|tonight|tomorrow|tonite|later|tom|ngayon|bukas|mamaya|kanina|kahapon|kungelan|kelan|kailan)\\b',
    // Tagalog "next/this" markers used with time
    '\\b(next|this|sa|nung|noong)\\s+(week|weekend|month|mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miyerkules|miyerkoles|huwebes|biyernes|sabado|linggo|umaga|hapon|gabi|tanghali)\\b',
    // Time of day phrases (Tagalog)
    '\\b(umaga|hapon|gabi|tanghali|madaling\\s+araw)\\b',
    // Numeric clock times: "2pm", "3:30", "14:30", "at 9"
    '\\b\\d{1,2}\\s*(am|pm)\\b',
    '\\b\\d{1,2}:\\d{2}\\b',
    '\\b(at|by|sa|alas)\\s+\\d{1,2}\\b',
    // "follow up", "ping me back", "message me later", "chat me back"
    '\\b(follow\\s*up|ping\\s+me|chat\\s+me|message\\s+me|hit\\s+me\\s+up|reach\\s+out|kausapin|tawagan|balikan|balik\\s+mo)\\b',
  ].join('|'),
  'i',
)

export function hasTimeMarker(text: string): boolean {
  const t = text?.trim() ?? ''
  if (t.length < 3) return false
  return TIME_WORD_RE.test(t)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/reminders/hasTimeMarker.test.ts`
Expected: PASS — all positives match, all negatives miss.

If any positive fails, expand the regex with the specific word/phrase. If any negative matches, narrow the offending alternative (the negative-test list is the ground truth; do not weaken it).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reminders/hasTimeMarker.ts src/lib/reminders/hasTimeMarker.test.ts
git commit -m "feat(reminders): hasTimeMarker pre-filter for extractReminder"
```

---

### Task 3: Sequence constants + position roles

**Files:**
- Create: `src/lib/reminders/sequence.ts`
- Test: `src/lib/reminders/sequence.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/reminders/sequence.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  SEQUENCE_OFFSETS_DAYS,
  SEQUENCE_LENGTH,
  scheduledAtForPosition,
  roleForPosition,
} from './sequence'

describe('SEQUENCE_OFFSETS_DAYS', () => {
  it('contains exactly the 7 expected offsets', () => {
    expect(Array.from(SEQUENCE_OFFSETS_DAYS)).toEqual([0, 1, 2, 3, 5, 8, 13])
    expect(SEQUENCE_LENGTH).toBe(7)
  })
})

describe('scheduledAtForPosition', () => {
  const anchor = new Date('2026-08-12T06:00:00.000Z') // Wed 2pm Manila

  it('returns anchor itself for position 0', () => {
    expect(scheduledAtForPosition(anchor, 0).toISOString()).toBe(anchor.toISOString())
  })

  it('adds N days for positions 1..6', () => {
    const dayMs = 86_400_000
    expect(scheduledAtForPosition(anchor, 1).getTime()).toBe(anchor.getTime() + 1 * dayMs)
    expect(scheduledAtForPosition(anchor, 3).getTime()).toBe(anchor.getTime() + 3 * dayMs)
    expect(scheduledAtForPosition(anchor, 6).getTime()).toBe(anchor.getTime() + 13 * dayMs)
  })

  it('throws on out-of-range position', () => {
    expect(() => scheduledAtForPosition(anchor, -1)).toThrow()
    expect(() => scheduledAtForPosition(anchor, 7)).toThrow()
  })
})

describe('roleForPosition', () => {
  it('returns a distinct, non-empty role string for each of the 7 positions', () => {
    const roles = new Set<string>()
    for (let i = 0; i < 7; i++) {
      const r = roleForPosition(i)
      expect(r.length).toBeGreaterThan(10)
      roles.add(r)
    }
    expect(roles.size).toBe(7)
  })

  it('throws on out-of-range position', () => {
    expect(() => roleForPosition(7)).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/reminders/sequence.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`src/lib/reminders/sequence.ts`:

```ts
// Schedule shape for the dedicated reminder follow-up sequence. Cumulative
// day offsets from the anchor (the customer's requested follow-up time).

export const SEQUENCE_OFFSETS_DAYS = [0, 1, 2, 3, 5, 8, 13] as const
export const SEQUENCE_LENGTH = SEQUENCE_OFFSETS_DAYS.length

const DAY_MS = 86_400_000

const POSITION_ROLES: readonly string[] = [
  'The promised delivery — honors the requested follow-up directly, references the topic, and asks what the customer would like to do next.',
  'First light nudge one day later. Gentle, references the topic.',
  'Two days after anchor. Offer to clarify or break down something specific about the topic.',
  'Three days after anchor. Brief, low-pressure check-in. Shorter than earlier touchpoints.',
  'Five days after anchor. Re-engage from a fresh angle — propose a new value-add or ask a different question.',
  'Eight days after anchor. Last substantive ping. Could mention flexibility, alternatives, or a specific next step.',
  'Thirteen days after anchor. Gracious final close. Door-open exit: invite them back anytime, no pressure.',
] as const

function assertPos(pos: number): void {
  if (!Number.isInteger(pos) || pos < 0 || pos >= SEQUENCE_LENGTH) {
    throw new RangeError(`sequence position must be 0..${SEQUENCE_LENGTH - 1}, got ${pos}`)
  }
}

export function scheduledAtForPosition(anchor: Date, pos: number): Date {
  assertPos(pos)
  return new Date(anchor.getTime() + SEQUENCE_OFFSETS_DAYS[pos] * DAY_MS)
}

export function roleForPosition(pos: number): string {
  assertPos(pos)
  return POSITION_ROLES[pos]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/reminders/sequence.test.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reminders/sequence.ts src/lib/reminders/sequence.test.ts
git commit -m "feat(reminders): sequence offset + position-role constants"
```

---

### Task 4: Sequence fallback pool

**Files:**
- Create: `src/lib/reminders/sequence-fallbacks.ts`
- Test: `src/lib/reminders/sequence-fallbacks.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/reminders/sequence-fallbacks.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fallbackForPosition, SEQUENCE_FALLBACKS } from './sequence-fallbacks'
import { SEQUENCE_LENGTH } from './sequence'

describe('SEQUENCE_FALLBACKS', () => {
  it('has exactly SEQUENCE_LENGTH entries', () => {
    expect(SEQUENCE_FALLBACKS.length).toBe(SEQUENCE_LENGTH)
  })

  it('has no dashes, no newlines, fits 200 chars', () => {
    for (const line of SEQUENCE_FALLBACKS) {
      expect(line).not.toMatch(/[-‐‑‒–—―]/)
      expect(line.split('\n').length).toBe(1)
      expect(line.length).toBeLessThanOrEqual(200)
      expect(line.length).toBeGreaterThan(5)
    }
  })
})

describe('fallbackForPosition', () => {
  it('substitutes {name} with the lead first name', () => {
    const line = fallbackForPosition(0, 'Maria')
    expect(line).toContain('Maria')
    expect(line).not.toContain('{name}')
  })

  it('uses "there" when name is null', () => {
    const line = fallbackForPosition(0, null)
    expect(line).toContain('there')
    expect(line).not.toContain('{name}')
  })

  it('uses only the first token of a multi-word name', () => {
    const line = fallbackForPosition(0, 'Maria Cruz')
    expect(line).toContain('Maria')
    expect(line).not.toContain('Cruz')
  })

  it('throws on out-of-range position', () => {
    expect(() => fallbackForPosition(7, 'X')).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/reminders/sequence-fallbacks.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`src/lib/reminders/sequence-fallbacks.ts`:

```ts
// Curated per-position fallback lines. Used when pre-generation fails AND
// fire-time refresh also fails. Uses {name} as the substitution token.

import { sanitizeFollowup } from '@/lib/followups/sanitize'
import { SEQUENCE_LENGTH } from './sequence'

export const SEQUENCE_FALLBACKS: readonly string[] = [
  'Hi {name}, balik lang po ako gaya ng usap natin. Pwede pa po ba tayong mag chat ngayon?',
  'Hi {name}, follow up lang po. May oras po ba kayo today para i tuloy yung usapan natin?',
  'Hi {name}, sabihan niyo lang po kung may gusto kayong i clarify or i breakdown.',
  'Hi {name}, nandito lang po ako kung gusto niyong balikan ulit.',
  'Hi {name}, may bago akong idea para sa inyo. Pwede po ba i discuss?',
  'Hi {name}, last in depth check po. May specific concern po ba kayo na pwede kong sagutin?',
  'Hi {name}, kahit anong oras po kayong handa na, dito lang ako. Salamat po sa oras niyo!',
] as const

if (SEQUENCE_FALLBACKS.length !== SEQUENCE_LENGTH) {
  throw new Error('SEQUENCE_FALLBACKS length must match SEQUENCE_LENGTH')
}

function firstToken(name: string | null): string {
  if (!name) return ''
  return name.trim().split(/\s+/)[0] ?? ''
}

export function fallbackForPosition(pos: number, leadName: string | null): string {
  if (!Number.isInteger(pos) || pos < 0 || pos >= SEQUENCE_LENGTH) {
    throw new RangeError(`sequence position must be 0..${SEQUENCE_LENGTH - 1}, got ${pos}`)
  }
  const fn = firstToken(leadName) || 'there'
  return sanitizeFollowup(SEQUENCE_FALLBACKS[pos].replace('{name}', fn))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/reminders/sequence-fallbacks.test.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reminders/sequence-fallbacks.ts src/lib/reminders/sequence-fallbacks.test.ts
git commit -m "feat(reminders): curated sequence fallback pool"
```

---

### Task 5: Sequence message generator (prompt + LLM call)

**Files:**
- Create: `src/lib/reminders/sequence-generate.ts`
- Test: `src/lib/reminders/sequence-generate.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/reminders/sequence-generate.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const completeMock = vi.fn<(messages: unknown, opts?: unknown) => Promise<string>>()

vi.mock('@/lib/rag/llm', () => ({
  HfRouterLlm: class {
    complete = completeMock
  },
}))
vi.mock('@/lib/rag/config', () => ({
  ragConfig: { classifierModel: 'fake-model' },
}))

import { buildSequencePrompt, generateSequenceMessage } from './sequence-generate'

const fixedNow = new Date('2026-08-10T06:00:00.000Z') // Mon 2pm Manila
const anchor = new Date('2026-08-12T06:00:00.000Z') // Wed 2pm Manila

describe('buildSequencePrompt', () => {
  it('includes current Manila time, topic, position, anchor, and scheduled time', () => {
    const { system, user } = buildSequencePrompt({
      now: fixedNow,
      anchor,
      position: 0,
      topic: 'pricing for the 3BR unit',
      leadName: 'Maria',
      personalityBlock: 'warm Taglish sales tone',
      recentMessages: [],
    })
    expect(system).toContain('Current time:')
    expect(system).toContain('Asia/Manila')
    expect(system).toContain('pricing for the 3BR unit')
    expect(system).toContain('message #1 of 7')
    expect(system).toContain('warm Taglish sales tone')
    expect(system).toContain('Maria')
    expect(user.length).toBeGreaterThan(0)
  })

  it('appends transcript to user message when recentMessages are provided', () => {
    const { user } = buildSequencePrompt({
      now: fixedNow,
      anchor,
      position: 2,
      topic: 'pricing',
      leadName: 'Maria',
      personalityBlock: '',
      recentMessages: [
        { role: 'user', content: 'how much po?' },
        { role: 'assistant', content: 'Starts at 5k po.' },
      ],
    })
    expect(user).toContain('how much po?')
    expect(user).toContain('Starts at 5k po.')
  })

  it('throws on out-of-range position', () => {
    expect(() =>
      buildSequencePrompt({
        now: fixedNow,
        anchor,
        position: 7,
        topic: 't',
        leadName: null,
        personalityBlock: '',
        recentMessages: [],
      }),
    ).toThrow()
  })
})

describe('generateSequenceMessage', () => {
  beforeEach(() => completeMock.mockReset())

  it('returns sanitized LLM output on success', async () => {
    completeMock.mockResolvedValueOnce('"Hi Maria, ready na ako para sa pricing - balikan natin?"')
    const text = await generateSequenceMessage({
      now: fixedNow,
      anchor,
      position: 0,
      topic: 'pricing for the 3BR unit',
      leadName: 'Maria',
      personalityBlock: 'warm',
      recentMessages: [],
    })
    expect(text).not.toMatch(/[-‐‑‒–—―]/)
    expect(text!.split('\n').length).toBe(1)
    expect(text).toContain('Maria')
  })

  it('returns null on LLM rejection', async () => {
    completeMock.mockRejectedValueOnce(new Error('boom'))
    const text = await generateSequenceMessage({
      now: fixedNow,
      anchor,
      position: 1,
      topic: 'pricing',
      leadName: null,
      personalityBlock: '',
      recentMessages: [],
    })
    expect(text).toBeNull()
  })

  it('returns null on empty/whitespace LLM response', async () => {
    completeMock.mockResolvedValueOnce('   ')
    const text = await generateSequenceMessage({
      now: fixedNow,
      anchor,
      position: 2,
      topic: 'pricing',
      leadName: 'Maria',
      personalityBlock: '',
      recentMessages: [],
    })
    expect(text).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/reminders/sequence-generate.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`src/lib/reminders/sequence-generate.ts`:

```ts
import { HfRouterLlm } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'
import { sanitizeFollowup } from '@/lib/followups/sanitize'
import { manilaNowBlock, manilaNow, MANILA_TZ } from '@/lib/time/manilaNow'
import { roleForPosition, scheduledAtForPosition, SEQUENCE_LENGTH } from './sequence'

const LLM_TIMEOUT_MS = 8_000

export interface SequencePromptArgs {
  now: Date
  anchor: Date
  position: number // 0..6
  topic: string
  leadName: string | null
  personalityBlock: string
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
}

function manilaLong(d: Date): string {
  const n = manilaNow(d)
  const time = n.iso.slice(11)
  return `${n.dateLong}, ${time}`
}

function firstName(name: string | null): string {
  if (!name) return ''
  return name.trim().split(/\s+/)[0] ?? ''
}

export function buildSequencePrompt(args: SequencePromptArgs): { system: string; user: string } {
  if (!Number.isInteger(args.position) || args.position < 0 || args.position >= SEQUENCE_LENGTH) {
    throw new RangeError(`position must be 0..${SEQUENCE_LENGTH - 1}, got ${args.position}`)
  }
  const scheduledAt = scheduledAtForPosition(args.anchor, args.position)
  const personality = args.personalityBlock?.trim()
    ? `Personality / tone:\n${args.personalityBlock.trim()}\n\n`
    : ''
  const fn = firstName(args.leadName)
  const fnHint = fn ? `Use the customer's first name once: ${fn}.\n` : ''
  const role = roleForPosition(args.position)
  const rules =
    'Hard rules: one line only, max 200 characters, no dashes ("-", "—", "–"), no markdown, no emojis ' +
    'unless personality calls for them. Match the personality language (Tagalog, Taglish, or English). ' +
    'Sound human, never robotic. Reference the topic naturally. Never start with "Hello! I am..." or generic AI phrasing.'

  const system =
    `${manilaNowBlock(args.now)}\n\n` +
    `${personality}` +
    `The customer asked to be followed up at ${manilaLong(args.anchor)} (${MANILA_TZ}) about: "${args.topic}".\n` +
    `You are writing message #${args.position + 1} of ${SEQUENCE_LENGTH} in that scheduled follow-up sequence.\n` +
    `This message will be sent at ${manilaLong(scheduledAt)} (${MANILA_TZ}).\n\n` +
    `Position role: ${role}\n\n` +
    `${fnHint}${rules}`

  const transcript = args.recentMessages.length
    ? `Last messages in the conversation:\n` +
      args.recentMessages
        .slice(-20)
        .map((m) => (m.role === 'user' ? `Customer: ${m.content}` : `You earlier: ${m.content}`))
        .join('\n') +
      '\n\n'
    : ''
  const user = `${transcript}Write message #${args.position + 1} now. Do not repeat earlier phrasings.`

  return { system, user }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('llm_timeout')), ms)),
  ])
}

export async function generateSequenceMessage(args: SequencePromptArgs): Promise<string | null> {
  try {
    const llm = new HfRouterLlm({ model: ragConfig.classifierModel })
    const { system, user } = buildSequencePrompt(args)
    const raw = await withTimeout(
      llm.complete(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        { temperature: 0.6, maxTokens: 160 },
      ),
      LLM_TIMEOUT_MS,
    )
    const cleaned = sanitizeFollowup(raw)
    if (!cleaned) return null
    return cleaned
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/reminders/sequence-generate.test.ts`
Expected: PASS — 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reminders/sequence-generate.ts src/lib/reminders/sequence-generate.test.ts
git commit -m "feat(reminders): sequence message generator (prompt + LLM call)"
```

---

### Task 6: Migration — `lead_reminder_sequences` table + extend `lead_reminders`

**Files:**
- Create: `supabase/migrations/20260602000000_lead_reminder_sequences.sql`

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260602000000_lead_reminder_sequences.sql`:

```sql
-- =========================================================================
-- Lead Reminder Sequences: customer-requested 7-touchpoint Fibonacci-cadence
-- follow-ups. Sequence row holds anchor + topic + lifecycle status. Each of
-- the 7 touchpoints is a regular lead_reminders row, linked by sequence_id
-- + sequence_position, so the existing cron + worker + dashboard keep working.
-- =========================================================================

create table public.lead_reminder_sequences (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id)               on delete cascade,
  lead_id       uuid not null references public.leads(id)             on delete cascade,
  thread_id     uuid not null references public.messenger_threads(id) on delete cascade,

  anchor_at     timestamptz not null,
  topic         text not null check (char_length(topic) between 1 and 500),
  source_message_id uuid references public.messenger_messages(id) on delete set null,

  status text not null default 'active'
    check (status in ('active','resolved','cancelled','exhausted')),
  resolved_at     timestamptz,
  resolved_reason text check (resolved_reason in ('topic_addressed','manual','rescheduled')),
  cancelled_at    timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Only one active sequence per lead.
create unique index uniq_active_reminder_sequence_per_lead
  on public.lead_reminder_sequences (lead_id)
  where status = 'active';

create index idx_reminder_sequences_user_status
  on public.lead_reminder_sequences (user_id, status, anchor_at desc);

alter table public.lead_reminder_sequences enable row level security;

create policy "lead_reminder_sequences_owner_rw" on public.lead_reminder_sequences
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.touch_lead_reminder_sequences_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger lead_reminder_sequences_touch_updated_at
  before update on public.lead_reminder_sequences
  for each row execute function public.touch_lead_reminder_sequences_updated_at();

-- Extend lead_reminders so touchpoints can carry sequence metadata + the
-- pre-generated message content.
alter table public.lead_reminders
  add column sequence_id        uuid references public.lead_reminder_sequences(id) on delete cascade,
  add column sequence_position  smallint check (sequence_position between 0 and 6),
  add column pre_generated_text text check (char_length(pre_generated_text) <= 2000),
  add column fallback_text      text check (char_length(fallback_text) <= 2000);

create unique index uniq_reminder_sequence_position
  on public.lead_reminders (sequence_id, sequence_position)
  where sequence_id is not null;
```

- [ ] **Step 2: Apply via Supabase MCP**

Use the Supabase MCP `apply_migration` tool with:
- `name`: `20260602000000_lead_reminder_sequences`
- `query`: the full contents of the file from Step 1

Expected: success, no errors.

- [ ] **Step 3: Verify via Supabase MCP**

Use the Supabase MCP `list_tables` tool, schemas `['public']`. Confirm `lead_reminder_sequences` is listed and `lead_reminders` shows the four new columns. Then run via `execute_sql`:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='lead_reminders'
  and column_name in ('sequence_id','sequence_position','pre_generated_text','fallback_text')
order by column_name;
```

Expected: 4 rows, all nullable. Indexes present:

```sql
select indexname from pg_indexes where tablename in ('lead_reminders','lead_reminder_sequences')
  and indexname in ('uniq_active_reminder_sequence_per_lead','uniq_reminder_sequence_position','idx_reminder_sequences_user_status');
```

Expected: 3 rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260602000000_lead_reminder_sequences.sql
git commit -m "feat(db): add lead_reminder_sequences table and link to lead_reminders"
```

---

### Task 7: Sequence seeder

**Files:**
- Create: `src/lib/reminders/sequence-seed.ts`
- Test: `src/lib/reminders/sequence-seed.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/reminders/sequence-seed.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const generateMock = vi.fn<() => Promise<string | null>>()

vi.mock('./sequence-generate', () => ({
  generateSequenceMessage: generateMock,
}))

import { seedReminderSequence } from './sequence-seed'

type Captured = { table: string; op: string; values?: unknown; match?: Record<string, unknown> }

function makeAdmin(opts?: { sequenceInsertId?: string; existingActiveId?: string | null }) {
  const captured: Captured[] = []
  const sequenceInsertId = opts?.sequenceInsertId ?? 'seq-1'
  const existingActiveId = opts?.existingActiveId ?? null
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      let pendingMatch: Record<string, unknown> = {}
      let pendingUpdate: unknown = null
      chain.select = () => chain
      chain.eq = (col: string, val: unknown) => {
        pendingMatch = { ...pendingMatch, [col]: val }
        return chain
      }
      chain.maybeSingle = async () => {
        if (table === 'lead_reminder_sequences' && pendingMatch.status === 'active') {
          return existingActiveId
            ? { data: { id: existingActiveId }, error: null }
            : { data: null, error: null }
        }
        return { data: null, error: null }
      }
      chain.single = async () => {
        if (table === 'lead_reminder_sequences') return { data: { id: sequenceInsertId }, error: null }
        return { data: null, error: null }
      }
      chain.update = (values: unknown) => {
        pendingUpdate = values
        return chain
      }
      chain.insert = (values: unknown) => {
        captured.push({ table, op: 'insert', values })
        return {
          ...chain,
          select: () => chain,
        }
      }
      chain.then = (resolve: (r: { data: unknown[]; error: null }) => void) => {
        if (pendingUpdate !== null) {
          captured.push({ table, op: 'update', values: pendingUpdate, match: pendingMatch })
        }
        resolve({ data: [], error: null })
      }
      return chain
    },
  }
  return { admin, captured }
}

beforeEach(() => {
  generateMock.mockReset()
})

describe('seedReminderSequence', () => {
  const baseArgs = {
    userId: 'u1',
    leadId: 'l1',
    threadId: 't1',
    anchor: new Date('2026-08-12T06:00:00.000Z'),
    topic: 'pricing for the 3BR unit',
    leadName: 'Maria',
    personalityBlock: 'warm Taglish sales tone',
    sourceMessageId: 'msg-1',
    now: new Date('2026-08-10T06:00:00.000Z'),
  }

  it('inserts 1 sequence row and 7 touchpoints with monotonic scheduled_at', async () => {
    generateMock.mockResolvedValue('hi maria, message body')
    const { admin, captured } = makeAdmin()

    const result = await seedReminderSequence(admin as never, baseArgs)
    expect(result.ok).toBe(true)

    const seqInserts = captured.filter((c) => c.table === 'lead_reminder_sequences' && c.op === 'insert')
    expect(seqInserts.length).toBe(1)
    const reminderInserts = captured.filter((c) => c.table === 'lead_reminders' && c.op === 'insert')
    expect(reminderInserts.length).toBe(7)
    const times = reminderInserts.map((r) => new Date((r.values as Record<string, unknown>).scheduled_at as string).getTime())
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1])
  })

  it('marks any existing active sequence cancelled with rescheduled reason', async () => {
    generateMock.mockResolvedValue('msg')
    const { admin, captured } = makeAdmin({ existingActiveId: 'seq-old' })
    await seedReminderSequence(admin as never, baseArgs)
    const cancel = captured.find(
      (c) =>
        c.table === 'lead_reminder_sequences' &&
        c.op === 'update' &&
        (c.values as Record<string, unknown>).status === 'cancelled',
    )
    expect(cancel).toBeDefined()
    expect((cancel!.values as Record<string, unknown>).resolved_reason).toBe('rescheduled')
  })

  it('sets auto_send=true and sequence_position 0..6 on every touchpoint', async () => {
    generateMock.mockResolvedValue('msg')
    const { admin, captured } = makeAdmin()
    await seedReminderSequence(admin as never, baseArgs)
    const inserts = captured.filter((c) => c.table === 'lead_reminders' && c.op === 'insert')
    const positions = inserts.map((r) => (r.values as Record<string, unknown>).sequence_position as number)
    expect([...positions].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6])
    for (const r of inserts) {
      expect((r.values as Record<string, unknown>).auto_send).toBe(true)
    }
  })

  it('writes pre_generated_text when LLM returns content, NULL when it fails', async () => {
    let callIndex = 0
    generateMock.mockImplementation(async () => {
      callIndex += 1
      return callIndex % 2 === 0 ? 'generated copy' : null
    })
    const { admin, captured } = makeAdmin()
    await seedReminderSequence(admin as never, baseArgs)
    const rows = captured
      .filter((c) => c.table === 'lead_reminders' && c.op === 'insert')
      .map((r) => r.values as Record<string, unknown>)
    const withPregen = rows.filter((r) => r.pre_generated_text !== null)
    expect(withPregen.length).toBeGreaterThan(0)
    expect(withPregen.length).toBeLessThan(7)
    for (const r of rows) expect(r.fallback_text).toBeTruthy()
  })

  it('still inserts the sequence + touchpoints if every LLM call rejects', async () => {
    generateMock.mockResolvedValue(null)
    const { admin, captured } = makeAdmin()
    const result = await seedReminderSequence(admin as never, baseArgs)
    expect(result.ok).toBe(true)
    expect(captured.filter((c) => c.table === 'lead_reminders' && c.op === 'insert').length).toBe(7)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/reminders/sequence-seed.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`src/lib/reminders/sequence-seed.ts`:

```ts
// Seed a dedicated reminder follow-up sequence: cancel any prior active
// sequence for the lead, insert the sequence row, pre-generate all 7
// message bodies in parallel, and insert the 7 touchpoint rows with
// auto_send=true so the existing reminders cron picks them up.

import type { SupabaseClient } from '@supabase/supabase-js'
import { SEQUENCE_LENGTH, scheduledAtForPosition } from './sequence'
import { fallbackForPosition } from './sequence-fallbacks'
import { generateSequenceMessage } from './sequence-generate'

export interface SeedArgs {
  userId: string
  leadId: string
  threadId: string
  anchor: Date
  topic: string
  leadName: string | null
  personalityBlock: string
  sourceMessageId: string | null
  now?: Date
}

export interface SeedResult {
  ok: boolean
  sequenceId?: string
  reason?: string
}

export async function seedReminderSequence(
  admin: SupabaseClient,
  args: SeedArgs,
): Promise<SeedResult> {
  const now = args.now ?? new Date()

  // 1. Cancel any existing active sequence for this lead (replace on new request).
  const { data: existing } = await admin
    .from('lead_reminder_sequences')
    .select('id')
    .eq('lead_id', args.leadId)
    .eq('status', 'active')
    .maybeSingle<{ id: string }>()

  if (existing) {
    await admin
      .from('lead_reminder_sequences')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        resolved_reason: 'rescheduled',
      })
      .eq('id', existing.id)
  }

  // 2. Insert the new sequence row.
  const { data: seqRow, error: seqErr } = await admin
    .from('lead_reminder_sequences')
    .insert({
      user_id: args.userId,
      lead_id: args.leadId,
      thread_id: args.threadId,
      anchor_at: args.anchor.toISOString(),
      topic: args.topic,
      source_message_id: args.sourceMessageId,
      status: 'active',
    })
    .select('id')
    .single<{ id: string }>()

  if (seqErr || !seqRow) {
    return { ok: false, reason: seqErr?.message ?? 'sequence insert failed' }
  }
  const sequenceId = seqRow.id

  // 3. Pre-generate all 7 message bodies in parallel. Failures leave the row's
  //    pre_generated_text NULL; fallback_text is always populated.
  const positions = Array.from({ length: SEQUENCE_LENGTH }, (_, i) => i)
  const generated = await Promise.allSettled(
    positions.map((pos) =>
      generateSequenceMessage({
        now,
        anchor: args.anchor,
        position: pos,
        topic: args.topic,
        leadName: args.leadName,
        personalityBlock: args.personalityBlock,
        recentMessages: [],
      }),
    ),
  )

  // 4. Insert the 7 touchpoint rows.
  for (let pos = 0; pos < SEQUENCE_LENGTH; pos++) {
    const settled = generated[pos]
    const preGen =
      settled.status === 'fulfilled' && settled.value ? settled.value : null
    const fallback = fallbackForPosition(pos, args.leadName)
    const scheduledAt = scheduledAtForPosition(args.anchor, pos).toISOString()

    await admin.from('lead_reminders').insert({
      user_id: args.userId,
      lead_id: args.leadId,
      thread_id: args.threadId,
      scheduled_at: scheduledAt,
      topic: args.topic,
      source_message_id: pos === 0 ? args.sourceMessageId : null,
      auto_send: true,
      status: 'pending',
      sequence_id: sequenceId,
      sequence_position: pos,
      pre_generated_text: preGen,
      fallback_text: fallback,
    })
  }

  return { ok: true, sequenceId }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/reminders/sequence-seed.test.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reminders/sequence-seed.ts src/lib/reminders/sequence-seed.test.ts
git commit -m "feat(reminders): sequence seeder with parallel pre-generation"
```

---

### Task 8: Sequence resolver

**Files:**
- Create: `src/lib/reminders/sequence-resolve.ts`
- Test: `src/lib/reminders/sequence-resolve.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/reminders/sequence-resolve.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const resolveTopicsMock = vi.fn<(text: string, items: Array<{ id: string; topic: string }>) => Promise<string[]>>()

vi.mock('./resolve', () => ({
  resolveTopics: resolveTopicsMock,
}))

import { resolveActiveSequence } from './sequence-resolve'

type Captured = { table: string; op: string; values?: unknown; match?: Record<string, unknown> }

function makeAdmin(active: { id: string; topic: string } | null) {
  const captured: Captured[] = []
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      let pendingMatch: Record<string, unknown> = {}
      let pendingUpdate: unknown = null
      chain.select = () => chain
      chain.eq = (col: string, val: unknown) => {
        pendingMatch = { ...pendingMatch, [col]: val }
        return chain
      }
      chain.maybeSingle = async () => ({ data: active, error: null })
      chain.update = (values: unknown) => {
        pendingUpdate = values
        return chain
      }
      chain.then = (resolve: (r: { data: unknown; error: null }) => void) => {
        if (pendingUpdate !== null) {
          captured.push({ table, op: 'update', values: pendingUpdate, match: pendingMatch })
        }
        resolve({ data: null, error: null })
      }
      return chain
    },
  }
  return { admin, captured }
}

beforeEach(() => resolveTopicsMock.mockReset())

describe('resolveActiveSequence', () => {
  it('returns false when no active sequence exists', async () => {
    const { admin, captured } = makeAdmin(null)
    const ok = await resolveActiveSequence(admin as never, {
      leadId: 'l1',
      inboundText: 'ok send pricing now',
    })
    expect(ok).toBe(false)
    expect(captured.find((c) => c.op === 'update')).toBeUndefined()
    expect(resolveTopicsMock).not.toHaveBeenCalled()
  })

  it('marks sequence resolved when resolveTopics returns its id', async () => {
    resolveTopicsMock.mockResolvedValue(['seq-1'])
    const { admin, captured } = makeAdmin({ id: 'seq-1', topic: 'pricing' })
    const ok = await resolveActiveSequence(admin as never, {
      leadId: 'l1',
      inboundText: 'ok send pricing now',
    })
    expect(ok).toBe(true)
    const upd = captured.find((c) => c.op === 'update' && c.table === 'lead_reminder_sequences')!
    expect((upd.values as Record<string, unknown>).status).toBe('resolved')
    expect((upd.values as Record<string, unknown>).resolved_reason).toBe('topic_addressed')
  })

  it('leaves the sequence alone when resolveTopics returns nothing', async () => {
    resolveTopicsMock.mockResolvedValue([])
    const { admin, captured } = makeAdmin({ id: 'seq-1', topic: 'pricing' })
    const ok = await resolveActiveSequence(admin as never, {
      leadId: 'l1',
      inboundText: 'haha thanks',
    })
    expect(ok).toBe(false)
    expect(captured.find((c) => c.op === 'update')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/reminders/sequence-resolve.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`src/lib/reminders/sequence-resolve.ts`:

```ts
// If a lead has an active reminder sequence, ask the LLM whether the new
// inbound resolves its single shared topic. On resolution, flip the sequence
// row to 'resolved'; the FK status check at fire time then skips remaining
// touchpoints with no further writes needed.

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveTopics } from './resolve'

export interface ResolveArgs {
  leadId: string
  inboundText: string
}

export async function resolveActiveSequence(
  admin: SupabaseClient,
  args: ResolveArgs,
): Promise<boolean> {
  const { data: seq } = await admin
    .from('lead_reminder_sequences')
    .select('id, topic')
    .eq('lead_id', args.leadId)
    .eq('status', 'active')
    .maybeSingle<{ id: string; topic: string }>()
  if (!seq) return false

  const resolved = await resolveTopics(args.inboundText, [{ id: seq.id, topic: seq.topic }])
  if (resolved.length === 0) return false

  await admin
    .from('lead_reminder_sequences')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolved_reason: 'topic_addressed',
    })
    .eq('id', seq.id)
  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/reminders/sequence-resolve.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reminders/sequence-resolve.ts src/lib/reminders/sequence-resolve.test.ts
git commit -m "feat(reminders): sequence resolver wired through resolveTopics"
```

---

### Task 9: hasTimeMarker pre-filter + shared manilaNow in extractReminder

**Files:**
- Modify: `src/lib/reminders/extract.ts`
- Create: `src/lib/reminders/extract.test.ts`

- [ ] **Step 1: Add the failing test**

`src/lib/reminders/extract.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const completeMock = vi.fn<(messages: unknown, opts?: unknown) => Promise<string>>()

vi.mock('@/lib/rag/llm', () => ({
  HfRouterLlm: class {
    complete = completeMock
  },
}))
vi.mock('@/lib/rag/config', () => ({
  ragConfig: { classifierModel: 'fake-model' },
}))

import { extractReminder } from './extract'

beforeEach(() => completeMock.mockReset())

describe('extractReminder', () => {
  it('returns null without calling the LLM when no time marker is present', async () => {
    const out = await extractReminder('how much po? thanks!')
    expect(out).toBeNull()
    expect(completeMock).not.toHaveBeenCalled()
  })

  it('calls the LLM when a time marker is present', async () => {
    completeMock.mockResolvedValueOnce(
      JSON.stringify({
        has_request: true,
        when_local: '2099-12-31 09:00',
        topic: 'follow up',
        confidence: 'high',
      }),
    )
    const out = await extractReminder('follow up Wednesday morning')
    expect(out).not.toBeNull()
    expect(completeMock).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails (LLM is called even with no marker)**

Run: `pnpm test src/lib/reminders/extract.test.ts`
Expected: FAIL — the "no time marker" test fails because the LLM is currently called regardless.

- [ ] **Step 3: Modify `src/lib/reminders/extract.ts` to use the helper + pre-filter**

Replace the body of `src/lib/reminders/extract.ts`:

```ts
import { HfRouterLlm } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'
import { z } from 'zod'
import { manilaNow } from '@/lib/time/manilaNow'
import { hasTimeMarker } from './hasTimeMarker'

export const REMINDER_TZ = 'Asia/Manila'

export interface ExtractedReminder {
  scheduled_at: string
  topic: string
  confidence: 'low' | 'medium' | 'high'
}

const Schema = z.object({
  has_request: z.boolean(),
  when_local: z.string().nullable(),
  topic: z.string().nullable(),
  confidence: z.enum(['low', 'medium', 'high']).nullable(),
})

function manilaLocalToUtcIso(localStr: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(localStr.trim())
  if (!m) return null
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function buildSystem(now: { iso: string; weekday: string }): string {
  return `You detect when a customer has asked to be contacted again at a specific later time.

Today is ${now.weekday}, ${now.iso} in Asia/Manila timezone (UTC+08:00).

Output ONLY this JSON — no preamble, no markdown:
{
  "has_request": boolean,
  "when_local": string | null,
  "topic": string | null,
  "confidence": "low" | "medium" | "high" | null
}

Rules:
- has_request=true ONLY if the customer is clearly asking to be messaged or called back at a specific later time.
- when_local must be in format "YYYY-MM-DD HH:mm" representing Asia/Manila local time. Resolve relative phrases against the current time above.
  - If only a date is given, default to 09:00.
  - If only a time is given for "later today" and that time has already passed, schedule for the same time the next day.
  - The result must be in the FUTURE relative to current time.
- topic: short phrase capturing WHY they want a follow-up. If no specific topic, use "general follow-up". Max 200 chars.
- confidence: high = unambiguous date+time+intent. medium = clear intent but some inference. low = uncertain.
- If has_request=false, set when_local, topic, confidence to null.`
}

export async function extractReminder(
  inboundText: string,
  llm?: HfRouterLlm,
): Promise<ExtractedReminder | null> {
  const text = inboundText.trim()
  if (text.length < 4) return null
  if (!hasTimeMarker(text)) return null

  const client = llm ?? new HfRouterLlm({ model: ragConfig.classifierModel })
  const now = manilaNow()

  let raw: string
  try {
    raw = await client.complete(
      [
        { role: 'system', content: buildSystem(now) },
        { role: 'user', content: text.slice(0, 1500) },
      ],
      { responseFormat: 'json_object', temperature: 0, maxTokens: 200 },
    )
  } catch (e) {
    console.warn('[reminders.extract] LLM call failed', e)
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const result = Schema.safeParse(parsed)
  if (!result.success) return null
  const data = result.data
  if (!data.has_request || !data.when_local || !data.topic) return null

  const utc = manilaLocalToUtcIso(data.when_local)
  if (!utc) return null
  if (new Date(utc).getTime() <= Date.now() + 60_000) return null

  return {
    scheduled_at: utc,
    topic: data.topic.trim().slice(0, 500),
    confidence: data.confidence ?? 'medium',
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/reminders/extract.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reminders/extract.ts src/lib/reminders/extract.test.ts
git commit -m "refactor(reminders): pre-filter extractReminder with hasTimeMarker, use shared manilaNow"
```

---

### Task 10: Inject manilaNowBlock into chatbot main reply system prompt

**Files:**
- Modify: `src/lib/rag/prompt-builder.ts`
- Create: `src/lib/rag/prompt-builder.test.ts`

This is the highest-impact fix — the customer-facing chatbot reply currently has zero date awareness.

- [ ] **Step 1: Write the failing test**

`src/lib/rag/prompt-builder.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildPrompt } from './prompt-builder'

describe('buildPrompt — current time injection', () => {
  it('includes a "Current time" line at the top of the system prompt', () => {
    const { system } = buildPrompt({
      userQuery: 'hello',
      buckets: { useful: [], ambiguous: [], reject: [] },
      config: {},
      maxContext: 5,
    })
    expect(system.startsWith('Current time:')).toBe(true)
    expect(system).toContain('Asia/Manila')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/rag/prompt-builder.test.ts`
Expected: FAIL — the system prompt does not start with "Current time:" today.

- [ ] **Step 3: Modify `src/lib/rag/prompt-builder.ts`**

At the top of the file, add:

```ts
import { manilaNowBlock } from '@/lib/time/manilaNow'
```

In `assembleSystemPrompt`, prepend the block to both return branches:

```ts
  if (ragConfig.promptLayout === 'legacy') {
    return [
      manilaNowBlock(),
      '',
      ...goalSection,
      ...instructionsSection,
      ...stable,
      ...summarySection,
      ...kb,
    ].join('\n');
  }

  return [
    manilaNowBlock(),
    '',
    ...stable,
    ...goalSection,
    ...instructionsSection,
    ...summarySection,
    ...kb,
  ].join('\n');
```

Also patch the `args.persona` escape-hatch branch in `buildPrompt`:

```ts
  if (args.persona) {
    const system = `${manilaNowBlock()}\n\n${args.persona}\n\n# Knowledge base context\n${contextBlock}`;
    return { system, user: args.userQuery, contextChunkIds: ranked.map((c) => c.id), contextChunks };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/rag/prompt-builder.test.ts`
Expected: PASS.

Run the existing chatbot suite to confirm nothing else broke:

Run: `pnpm test src/lib/chatbot/`
Expected: all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rag/prompt-builder.ts src/lib/rag/prompt-builder.test.ts
git commit -m "feat(chatbot): inject current Manila time into reply system prompt"
```

---

### Task 11: Inject manilaNowBlock into the remaining LLM call sites

**Files:**
- Modify: `src/lib/agent/generateDraft.ts`
- Modify: `src/lib/followups/generateMessage.ts`
- Modify: `src/lib/reminders/fire.ts`

Surgical edits; pre-existing tests still pass.

- [ ] **Step 1: Modify `src/lib/agent/generateDraft.ts`**

Add import:

```ts
import { manilaNowBlock } from '@/lib/time/manilaNow'
```

Change `buildDraftPrompt` to prepend the block:

```ts
  const system = `${manilaNowBlock()}

You are a sales assistant writing a short Messenger follow-up for ${lead.name ?? 'a lead'}.
Tone: ${toneDesc}.
Keep it under 3 sentences. Do NOT use emojis excessively. Sound human, not robotic.
Output ONLY the message text — no quotes, no preamble, no explanation.`
```

- [ ] **Step 2: Modify `src/lib/followups/generateMessage.ts`**

Add import:

```ts
import { manilaNowBlock } from '@/lib/time/manilaNow'
```

In `buildSystemPrompt`, prepend to both `generic` and `real` branches by introducing a `prefix` variable:

```ts
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

  if (args.kind === 'generic') {
    return (
      prefix +
      personality +
      `You are writing follow-up message #${args.offsetIdx + 1} of 7 to a Messenger lead who replied earlier ` +
      `but has gone quiet. The previous exchange had less than 4 messages from the lead, so DO NOT pretend ` +
      `to remember specifics. Write a warm, light check-in that nudges them to reply. ` +
      `${fnHint}${rules}`
    )
  }
  return (
    prefix +
    personality +
    `You are writing follow-up message #${args.offsetIdx + 1} of 7 to a Messenger lead who has gone quiet ` +
    `after a real back-and-forth. Reference what was already discussed naturally and propose a concrete ` +
    `next step or ask one focused question. ${fnHint}${rules}`
  )
}
```

- [ ] **Step 3: Modify `src/lib/reminders/fire.ts`**

Add import:

```ts
import { manilaNowBlock } from '@/lib/time/manilaNow'
```

In `generateFollowUpText`, prepend the block to the `system` string:

```ts
  const system =
    `${manilaNowBlock()}\n\n` +
    'Write a single short, friendly Messenger follow-up message in the same language the topic is written in. ' +
    'Plain text only, no markdown, no emoji unless natural, max 240 characters. ' +
    'Tone: warm, conversational, professional. Mention the topic naturally. ' +
    'Do not invent facts or details not implied by the topic. End with a soft call to action (a question or invitation).'
```

- [ ] **Step 4: Run all affected tests**

Run: `pnpm test src/lib/agent/ src/lib/followups/ src/lib/reminders/`
Expected: all pre-existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/generateDraft.ts src/lib/followups/generateMessage.ts src/lib/reminders/fire.ts
git commit -m "feat(llm): inject manilaNowBlock into agent draft + followup + reminder prompts"
```

---

### Task 12: Fire handler — parent sequence check + late-refresh fallback order

**Files:**
- Modify: `src/lib/reminders/fire.ts`
- Create: `src/lib/reminders/fire-sequence.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/reminders/fire-sequence.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { sendOutboundMock, generateSeqMock } = vi.hoisted(() => ({
  sendOutboundMock: vi.fn(),
  generateSeqMock: vi.fn(),
}))

vi.mock('@/lib/messenger/outbound', () => ({ sendOutbound: sendOutboundMock }))
vi.mock('@/lib/facebook/crypto', () => ({ decryptToken: (s: string) => `dec:${s}` }))
vi.mock('@/lib/agent/classifyPolicy', () => ({
  isInsideWindow: (s: string | null) => !!s && Date.now() - new Date(s).getTime() < 24 * 3600_000,
}))
vi.mock('./sequence-generate', () => ({ generateSequenceMessage: generateSeqMock }))
vi.mock('@/lib/rag/llm', () => ({
  HfRouterLlm: class {
    complete = vi.fn(async () => 'one-off body')
  },
}))
vi.mock('@/lib/rag/config', () => ({ ragConfig: { classifierModel: 'fake' } }))

import { fireReminder } from './fire'

type FakeReminder = {
  id: string
  user_id: string
  lead_id: string
  thread_id: string
  topic: string
  status: string
  auto_send: boolean
  sequence_id: string | null
  sequence_position: number | null
  pre_generated_text: string | null
  fallback_text: string | null
}

function makeAdmin(seed: {
  reminder: FakeReminder
  sequence?: { id: string; status: string; topic: string; anchor_at: string } | null
  thread: Record<string, unknown>
  page: Record<string, unknown>
  lead: Record<string, unknown>
  chatbot?: Record<string, unknown> | null
}) {
  const updates: Array<{ table: string; values: unknown }> = []
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      let pendingUpdate: unknown = null
      chain.select = () => chain
      chain.eq = () => chain
      chain.order = () => chain
      chain.limit = () => chain
      chain.maybeSingle = async () => {
        if (table === 'lead_reminders') return { data: seed.reminder, error: null }
        if (table === 'lead_reminder_sequences')
          return { data: seed.sequence ?? null, error: null }
        if (table === 'messenger_threads') return { data: seed.thread, error: null }
        if (table === 'facebook_pages') return { data: seed.page, error: null }
        if (table === 'leads') return { data: seed.lead, error: null }
        if (table === 'chatbot_configs') return { data: seed.chatbot ?? null, error: null }
        return { data: null, error: null }
      }
      chain.update = (values: unknown) => {
        pendingUpdate = values
        return chain
      }
      chain.insert = () => Promise.resolve({ data: null, error: null })
      chain.then = (resolve: (r: { data: null; error: null }) => void) => {
        if (pendingUpdate !== null) updates.push({ table, values: pendingUpdate })
        resolve({ data: null, error: null })
      }
      return chain
    },
  }
  return { admin, updates }
}

const baseSeed = {
  reminder: {
    id: 'r1',
    user_id: 'u1',
    lead_id: 'l1',
    thread_id: 't1',
    topic: 'pricing',
    status: 'pending',
    auto_send: true,
    sequence_id: 'seq-1',
    sequence_position: 0,
    pre_generated_text: 'pre-gen body',
    fallback_text: 'fallback body',
  } satisfies FakeReminder,
  thread: { id: 't1', psid: 'ps1', last_inbound_at: new Date().toISOString(), page_id: 'p1' },
  page: { id: 'p1', page_access_token: 'enc' },
  lead: { name: 'Maria' },
  chatbot: { persona: 'warm', instructions: '' },
}

beforeEach(() => {
  sendOutboundMock.mockReset()
  generateSeqMock.mockReset()
})

describe('fireReminder — sequence-aware', () => {
  it('cancels the touchpoint and skips send when parent sequence is not active', async () => {
    const { admin, updates } = makeAdmin({
      ...baseSeed,
      sequence: { id: 'seq-1', status: 'cancelled', topic: 'pricing', anchor_at: new Date().toISOString() },
    })
    const result = await fireReminder(admin as never, 'r1')
    expect(result.ok).toBe(false)
    expect(sendOutboundMock).not.toHaveBeenCalled()
    const reminderUpdate = updates.find((u) => u.table === 'lead_reminders')
    expect((reminderUpdate!.values as Record<string, unknown>).status).toBe('cancelled')
  })

  it('uses fresh LLM output when available', async () => {
    generateSeqMock.mockResolvedValue('fresh body')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb-1' })
    const { admin } = makeAdmin({
      ...baseSeed,
      sequence: { id: 'seq-1', status: 'active', topic: 'pricing', anchor_at: new Date().toISOString() },
    })
    await fireReminder(admin as never, 'r1')
    expect(sendOutboundMock).toHaveBeenCalledTimes(1)
    const call = sendOutboundMock.mock.calls[0][0]
    expect(call.payload.text).toBe('fresh body')
  })

  it('falls back to pre_generated_text when fresh LLM returns null', async () => {
    generateSeqMock.mockResolvedValue(null)
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb-1' })
    const { admin } = makeAdmin({
      ...baseSeed,
      sequence: { id: 'seq-1', status: 'active', topic: 'pricing', anchor_at: new Date().toISOString() },
    })
    await fireReminder(admin as never, 'r1')
    const call = sendOutboundMock.mock.calls[0][0]
    expect(call.payload.text).toBe('pre-gen body')
  })

  it('falls back to fallback_text when both fresh and pre-gen are unavailable', async () => {
    generateSeqMock.mockResolvedValue(null)
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb-1' })
    const { admin } = makeAdmin({
      ...baseSeed,
      reminder: { ...baseSeed.reminder, pre_generated_text: null },
      sequence: { id: 'seq-1', status: 'active', topic: 'pricing', anchor_at: new Date().toISOString() },
    })
    await fireReminder(admin as never, 'r1')
    const call = sendOutboundMock.mock.calls[0][0]
    expect(call.payload.text).toBe('fallback body')
  })

  it('uses the legacy one-off path when sequence_id is null (no regression)', async () => {
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb-1' })
    const { admin } = makeAdmin({
      ...baseSeed,
      reminder: {
        ...baseSeed.reminder,
        sequence_id: null,
        sequence_position: null,
        pre_generated_text: null,
        fallback_text: null,
      },
      sequence: null,
    })
    await fireReminder(admin as never, 'r1')
    expect(sendOutboundMock).toHaveBeenCalledTimes(1)
    const call = sendOutboundMock.mock.calls[0][0]
    expect(typeof call.payload.text).toBe('string')
    expect(call.payload.text.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/reminders/fire-sequence.test.ts`
Expected: FAIL — `fireReminder` does not load the parent sequence today.

- [ ] **Step 3: Modify `src/lib/reminders/fire.ts`**

Update the file to:

1. Expand `ReminderRow` to include the new columns.
2. Add a parent-sequence load when `sequence_id` is set.
3. Skip + mark touchpoint `cancelled` when parent sequence is not `active`.
4. Implement the late-refresh order for sequence touchpoints: fresh → `pre_generated_text` → `fallback_text`. One-off reminders (where `sequence_id IS NULL`) keep using `generateFollowUpText`.
5. Mark the parent sequence `exhausted` when position 6 fires successfully.

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptToken } from '@/lib/facebook/crypto'
import { sendOutbound } from '@/lib/messenger/outbound'
import { isInsideWindow } from '@/lib/agent/classifyPolicy'
import { HfRouterLlm } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'
import { manilaNowBlock } from '@/lib/time/manilaNow'
import { generateSequenceMessage } from './sequence-generate'

interface ReminderRow {
  id: string
  user_id: string
  lead_id: string
  thread_id: string | null
  topic: string
  status: string
  auto_send: boolean
  sequence_id: string | null
  sequence_position: number | null
  pre_generated_text: string | null
  fallback_text: string | null
}

interface SequenceRow {
  id: string
  status: 'active' | 'resolved' | 'cancelled' | 'exhausted'
  topic: string
  anchor_at: string
}

interface ThreadRow {
  id: string
  psid: string
  last_inbound_at: string | null
  page_id: string
}

interface PageRow {
  id: string
  page_access_token: string
}

export interface FireResult {
  ok: boolean
  reason?: string
  messageId?: string | null
}

async function generateFollowUpText(topic: string, leadName: string | null): Promise<string> {
  const llm = new HfRouterLlm({ model: ragConfig.classifierModel })
  const system =
    `${manilaNowBlock()}\n\n` +
    'Write a single short, friendly Messenger follow-up message in the same language the topic is written in. ' +
    'Plain text only, no markdown, no emoji unless natural, max 240 characters. ' +
    'Tone: warm, conversational, professional. Mention the topic naturally. ' +
    'Do not invent facts or details not implied by the topic. End with a soft call to action (a question or invitation).'

  const namePart = leadName ? `Customer first name: ${leadName.split(' ')[0]}\n` : ''
  const userBlock = `${namePart}Topic to follow up on: ${topic}`

  try {
    const raw = await llm.complete(
      [
        { role: 'system', content: system },
        { role: 'user', content: userBlock },
      ],
      { temperature: 0.4, maxTokens: 200 },
    )
    const cleaned = raw.trim().replace(/^["']|["']$/g, '').slice(0, 600)
    if (cleaned.length === 0) throw new Error('empty')
    return cleaned
  } catch {
    const name = leadName ? `Hi ${leadName.split(' ')[0]}, ` : 'Hi! '
    return `${name}just following up on ${topic}. Let me know if you'd still like to chat about it!`
  }
}

export async function fireReminder(
  admin: SupabaseClient,
  reminderId: string,
): Promise<FireResult> {
  const { data: reminder } = await admin
    .from('lead_reminders')
    .select(
      'id, user_id, lead_id, thread_id, topic, status, auto_send, sequence_id, sequence_position, pre_generated_text, fallback_text',
    )
    .eq('id', reminderId)
    .maybeSingle<ReminderRow>()

  if (!reminder) return { ok: false, reason: 'reminder missing' }
  if (reminder.status !== 'pending' && reminder.status !== 'snoozed') {
    return { ok: false, reason: `status_${reminder.status}` }
  }
  if (!reminder.thread_id) {
    await markFailed(admin, reminder.id, 'no thread')
    return { ok: false, reason: 'no thread' }
  }

  // Parent sequence gate.
  let sequence: SequenceRow | null = null
  if (reminder.sequence_id) {
    const { data: seq } = await admin
      .from('lead_reminder_sequences')
      .select('id, status, topic, anchor_at')
      .eq('id', reminder.sequence_id)
      .maybeSingle<SequenceRow>()
    sequence = seq ?? null
    if (!sequence || sequence.status !== 'active') {
      await admin
        .from('lead_reminders')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', reminder.id)
      return { ok: false, reason: `sequence_${sequence?.status ?? 'missing'}` }
    }
  }

  const { data: thread } = await admin
    .from('messenger_threads')
    .select('id, psid, last_inbound_at, page_id')
    .eq('id', reminder.thread_id)
    .maybeSingle<ThreadRow>()
  if (!thread) {
    await markFailed(admin, reminder.id, 'thread missing')
    return { ok: false, reason: 'thread missing' }
  }

  const { data: page } = await admin
    .from('facebook_pages')
    .select('id, page_access_token')
    .eq('id', thread.page_id)
    .maybeSingle<PageRow>()
  if (!page) {
    await markFailed(admin, reminder.id, 'page missing')
    return { ok: false, reason: 'page missing' }
  }

  const { data: lead } = await admin
    .from('leads')
    .select('name')
    .eq('id', reminder.lead_id)
    .maybeSingle<{ name: string | null }>()

  let text: string
  if (sequence && reminder.sequence_position !== null) {
    const { data: chatbot } = await admin
      .from('chatbot_configs')
      .select('persona, instructions')
      .eq('user_id', reminder.user_id)
      .maybeSingle<{ persona: string | null; instructions: string | null }>()
    const personalityBlock = [chatbot?.persona, chatbot?.instructions]
      .filter((s) => typeof s === 'string' && s.trim())
      .join('\n\n')

    const { data: msgs } = await admin
      .from('messenger_messages')
      .select('direction, body, created_at')
      .eq('thread_id', reminder.thread_id)
      .order('created_at', { ascending: false })
      .limit(20)
    const recentMessages = ((msgs ?? []) as Array<{ direction: string; body: string }>)
      .reverse()
      .filter((m) => m.body?.trim())
      .map((m) => ({
        role: m.direction === 'outbound' ? ('assistant' as const) : ('user' as const),
        content: m.body,
      }))

    const fresh = await generateSequenceMessage({
      now: new Date(),
      anchor: new Date(sequence.anchor_at),
      position: reminder.sequence_position,
      topic: sequence.topic,
      leadName: lead?.name ?? null,
      personalityBlock,
      recentMessages,
    })
    text = fresh ?? reminder.pre_generated_text ?? reminder.fallback_text ?? ''
  } else {
    text = await generateFollowUpText(reminder.topic, lead?.name ?? null)
  }

  if (!text) {
    await markFailed(admin, reminder.id, 'empty body')
    return { ok: false, reason: 'empty body' }
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
    await admin
      .from('lead_reminders')
      .update({ status: 'failed', fired_at: new Date().toISOString(), resolved_reason: null })
      .eq('id', reminder.id)
    return { ok: false, reason }
  }

  await admin
    .from('lead_reminders')
    .update({ status: 'sent', fired_at: new Date().toISOString() })
    .eq('id', reminder.id)

  if (sequence && reminder.sequence_position === 6) {
    await admin
      .from('lead_reminder_sequences')
      .update({ status: 'exhausted' })
      .eq('id', sequence.id)
  }

  await admin
    .from('messenger_messages')
    .insert({
      thread_id: thread.id,
      user_id: reminder.user_id,
      direction: 'outbound',
      sender: 'bot',
      fb_message_id: result.messageId,
      body: text,
    })
    .then(({ error }) => {
      if (error && (error as { code?: string }).code !== '23505') {
        console.warn('[reminders.fire] message insert failed', error.message)
      }
    })

  return { ok: true, messageId: result.messageId ?? null }
}

async function markFailed(admin: SupabaseClient, id: string, _reason: string): Promise<void> {
  await admin
    .from('lead_reminders')
    .update({ status: 'failed', fired_at: new Date().toISOString() })
    .eq('id', id)
}

interface ReminderJob {
  id: string
  payload: { reminder_id: string } | null
}

export async function handleReminderFire(
  admin: SupabaseClient,
  job: ReminderJob,
): Promise<void> {
  const reminderId = job.payload?.reminder_id
  if (!reminderId) {
    await markJobDone(admin, job.id, 'skipped')
    return
  }
  const result = await fireReminder(admin, reminderId)
  await markJobDone(admin, job.id, result.ok ? 'done' : 'failed')
}

async function markJobDone(
  admin: SupabaseClient,
  jobId: string,
  status: 'done' | 'skipped' | 'failed',
): Promise<void> {
  await admin
    .from('messenger_jobs')
    .update({ status, finished_at: new Date().toISOString() })
    .eq('id', jobId)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/reminders/fire-sequence.test.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reminders/fire.ts src/lib/reminders/fire-sequence.test.ts
git commit -m "feat(reminders): sequence-aware fire handler with late-refresh fallback"
```

---

### Task 13: Wire seeder + resolver + gating into the messenger worker

**Files:**
- Modify: `src/app/api/messenger/process/route.ts`
- Modify: `src/lib/reminders/extract.ts` (export `ExtractedReminder` type)

Three discrete changes:
1. Move `extractReminder` to **pre-reply**, capture the result.
2. Gate `maybeScheduleFollowup` on (a) no reminder detected AND (b) no active sequence for the lead. Cancel any active auto-followup row when suppression is on.
3. In the post-reply `processReminderHooks` block: when a reminder was detected, call `seedReminderSequence` instead of the legacy single-row insert; always call `resolveActiveSequence` to handle the resolution case.

- [ ] **Step 1: Ensure `ExtractedReminder` is exported**

Confirm `src/lib/reminders/extract.ts` has `export interface ExtractedReminder` (it does after Task 9). No code change needed if Task 9 was applied correctly.

- [ ] **Step 2: Update the import block in `src/app/api/messenger/process/route.ts`**

Find the import section near the top and replace the reminder-related imports with:

```ts
import { extractReminder, type ExtractedReminder } from '@/lib/reminders/extract'
import { resolveTopics, type PendingReminder } from '@/lib/reminders/resolve'
import { seedReminderSequence } from '@/lib/reminders/sequence-seed'
import { resolveActiveSequence } from '@/lib/reminders/sequence-resolve'
```

- [ ] **Step 3: Move `extractReminder` to pre-reply and gate the followup seed**

In the worker body (the block that today calls `maybeScheduleFollowup` around line 346), replace it with:

```ts
    // Synchronous reminder detection BEFORE bot reply, so we know whether to
    // suppress the default auto silent-followup for this lead. The hasTimeMarker
    // pre-filter inside extractReminder keeps median-latency cost ~0.
    const extractedReminder: ExtractedReminder | null = await extractReminder(message).catch(
      (e) => {
        console.warn('[messenger.worker] extractReminder failed', e)
        return null
      },
    )

    // Skip the auto silent-followup if (a) the customer just asked for a
    // dated follow-up OR (b) an active reminder sequence already exists.
    let activeSequenceExists = false
    if (thread.lead_id && !extractedReminder) {
      const { data: activeSeq } = await admin
        .from('lead_reminder_sequences')
        .select('id')
        .eq('lead_id', thread.lead_id)
        .eq('status', 'active')
        .maybeSingle<{ id: string }>()
      activeSequenceExists = !!activeSeq
    }
    const suppressFollowup = !!extractedReminder || activeSequenceExists

    if (thread.lead_id && !suppressFollowup) {
      const leadIdForFu = thread.lead_id
      void maybeScheduleFollowup(admin, {
        threadId: thread.id,
        leadId: leadIdForFu,
        userId: thread.user_id,
        pageId: thread.page_id,
        lastInboundAt: inboundAt,
      }).catch((e) => console.warn('[messenger.worker] followup seed failed', e))
    } else if (thread.lead_id) {
      // Cancel any active default auto-followup row for this thread — it
      // would otherwise duplicate the reminder sequence's outreach.
      const threadIdForCancel = thread.id
      void admin
        .from('lead_followup_schedules')
        .update({ status: 'cancelled' })
        .eq('thread_id', threadIdForCancel)
        .in('status', ['pending', 'running'])
        .then(
          () => {},
          (e) => console.warn('[messenger.worker] followup cancel failed', e),
        )
    }
```

- [ ] **Step 4: Update `processReminderHooks` signature + behavior**

Find `processReminderHooks` (around line 1769) and the call site (around line 635).

**Caller (line ~635)** — replace with:

```ts
      if (thread.lead_id) {
        const leadId = thread.lead_id
        const inboundMsgId = job.inbound_msg_id
        const userId = thread.user_id
        const threadId = thread.id
        const personalityBlock = [config?.persona, config?.instructions]
          .filter((s) => typeof s === 'string' && s.trim())
          .join('\n\n')
        const leadName =
          (ctx.lead as { name: string | null } | null)?.name ?? thread.full_name ?? null
        void processReminderHooks(admin, {
          userId,
          leadId,
          threadId,
          inboundText: message,
          inboundMsgId,
          extracted: extractedReminder,
          leadName,
          personalityBlock,
        }).catch((e) => console.warn('[messenger.worker] reminder hooks failed', e))
      }
```

**Function (line ~1769)** — replace body with:

```ts
async function processReminderHooks(
  admin: AdminClient,
  args: {
    userId: string
    leadId: string
    threadId: string
    inboundText: string
    inboundMsgId: string | null
    extracted: ExtractedReminder | null
    leadName: string | null
    personalityBlock: string
  },
): Promise<void> {
  const { userId, leadId, threadId, inboundText, inboundMsgId, extracted, leadName, personalityBlock } = args

  // 1. Resolve any one-off pending reminders the customer's new message addresses.
  const { data: pending } = await admin
    .from('lead_reminders')
    .select('id, topic')
    .eq('lead_id', leadId)
    .eq('status', 'pending')
    .is('sequence_id', null)
    .limit(20)

  const pendingList = (pending ?? []) as PendingReminder[]
  if (pendingList.length > 0) {
    const resolvedIds = await resolveTopics(inboundText, pendingList)
    if (resolvedIds.length > 0) {
      await admin
        .from('lead_reminders')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_reason: 'topic_addressed',
        })
        .in('id', resolvedIds)
    }
  }

  // 2. If there is an active sequence, see whether this message resolves it.
  await resolveActiveSequence(admin, { leadId, inboundText })

  // 3. If a fresh reminder was extracted, seed a new sequence (cancels prior active).
  if (extracted) {
    const seedResult = await seedReminderSequence(admin, {
      userId,
      leadId,
      threadId,
      anchor: new Date(extracted.scheduled_at),
      topic: extracted.topic,
      leadName,
      personalityBlock,
      sourceMessageId: inboundMsgId,
    })
    if (!seedResult.ok) {
      console.warn('[messenger.worker] sequence seed failed', seedResult.reason)
    }
  }
}
```

- [ ] **Step 5: Verify nothing else regressed**

Run: `pnpm test src/lib/reminders/ src/lib/followups/ src/lib/agent/ src/lib/chatbot/ src/lib/rag/`
Expected: all pre-existing tests still pass.

Run: `pnpm tsc --noEmit`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/messenger/process/route.ts src/lib/reminders/extract.ts
git commit -m "feat(messenger): suppress auto-followup on reminder request; seed sequence in hooks"
```

---

### Task 14: Sequence cancel API

**Files:**
- Create: `src/app/api/reminders/sequences/[id]/route.ts`

- [ ] **Step 1: Implement the route**

`src/app/api/reminders/sequences/[id]/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PatchBody {
  status?: 'cancelled'
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { data: sequence, error } = await supabase
    .from('lead_reminder_sequences')
    .select(
      'id, lead_id, thread_id, anchor_at, topic, status, resolved_at, resolved_reason, cancelled_at, created_at',
    )
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!sequence) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { data: touchpoints } = await supabase
    .from('lead_reminders')
    .select(
      'id, sequence_position, scheduled_at, status, pre_generated_text, fallback_text, fired_at',
    )
    .eq('sequence_id', id)
    .order('sequence_position', { ascending: true })

  return NextResponse.json({ sequence, touchpoints: touchpoints ?? [] })
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  if (body.status !== 'cancelled') {
    return NextResponse.json({ error: 'only status=cancelled supported' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('lead_reminder_sequences')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      resolved_reason: 'manual',
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, status, cancelled_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(data)
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/reminders/sequences/[id]/route.ts"
git commit -m "feat(api): sequence GET + cancel route"
```

---

### Task 15: Dashboard grouping — render sequences as one card

**Files:**
- Modify: `src/app/(app)/dashboard/reminders/page.tsx`
- Modify: `src/app/(app)/dashboard/reminders/_components/RemindersClient.tsx`

Minimal scope: don't render 7 individual rows for one ask. Group touchpoints by `sequence_id` into a single card with a "Cancel sequence" button.

- [ ] **Step 1: Extend the page query**

In `src/app/(app)/dashboard/reminders/page.tsx`, replace the supabase block with parallel fetches for reminders + sequences:

```tsx
  const [{ data: reminderRows }, { data: sequenceRows }] = await Promise.all([
    supabase
      .from('lead_reminders')
      .select(
        'id, lead_id, scheduled_at, topic, status, auto_send, fired_at, resolved_at, created_at, sequence_id, sequence_position, leads(name)',
      )
      .eq('user_id', user.id)
      .in('status', ['pending', 'snoozed', 'sent', 'resolved', 'failed', 'cancelled'])
      .order('scheduled_at', { ascending: true })
      .limit(500),
    supabase
      .from('lead_reminder_sequences')
      .select('id, lead_id, anchor_at, topic, status, resolved_at, cancelled_at, created_at')
      .eq('user_id', user.id)
      .order('anchor_at', { ascending: true })
      .limit(200),
  ])
```

Map both into the props you pass to `RemindersClient`. Add `sequence_id` and `sequence_position` to `ReminderRow`. Pass `sequenceRows` as a second prop.

- [ ] **Step 2: Group touchpoints in `RemindersClient`**

In `_components/RemindersClient.tsx`:

1. Extend `ReminderRow` with `sequence_id: string | null` and `sequence_position: number | null`.
2. Accept `sequences: SequenceRow[]` as a new prop where `SequenceRow = { id, lead_id, anchor_at, topic, status, resolved_at, cancelled_at, created_at }`.
3. Group `rows` into `loose` (where `sequence_id IS NULL`) and `bySequence: Map<string, ReminderRow[]>`. Render a new `SequenceCard` for each sequence id present in the map, then the `loose` rows using the existing single-row UI.
4. `SequenceCard` shows: lead name, sequence topic, anchor formatted via the existing `fmtLocal` helper, sequence status badge, and a list of the 7 touchpoints (position + scheduled time + status pill). Add a "Cancel sequence" button when `sequence.status === 'active'`. The button fires `fetch(`/api/reminders/sequences/${seq.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) })` then calls `router.refresh()`.

(Exact JSX omitted — match the existing visual conventions of the file. Keep the change minimal: one new sub-component, one new prop, one filter split. Do not redesign the page.)

- [ ] **Step 3: Verify in browser**

Run: `pnpm dev`. Open `http://localhost:3000/dashboard/reminders`. Confirm:
- A test sequence shows up as one card with 7 sub-rows, not 7 separate cards.
- Clicking "Cancel sequence" calls the PATCH route and the card moves to a "Cancelled" state.
- One-off reminders still render in the existing layout (where `sequence_id IS NULL`).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/dashboard/reminders/"
git commit -m "feat(dashboard): group reminder sequence touchpoints into a single card"
```

---

### Task 16: End-to-end manual verification

No code change. Use the dev server + Supabase MCP to walk through the spec's scenarios. Capture screenshots/logs as you go.

- [ ] **Scenario A — Sequence seeded from inbound**

1. From a test PSID, send: `"follow up Wednesday 2pm about pricing for the 3BR"`.
2. Via Supabase MCP `execute_sql`:
   ```sql
   select id, anchor_at, topic, status from lead_reminder_sequences
   where lead_id = '<test-lead-id>' order by created_at desc limit 1;
   ```
   Expected: one row, `status='active'`, `anchor_at` near next Wed 2pm Manila.
3. Verify 7 touchpoint rows:
   ```sql
   select sequence_position, scheduled_at, status, auto_send,
          length(pre_generated_text) as pregen_len, length(fallback_text) as fb_len
   from lead_reminders where sequence_id = '<seq-id>' order by sequence_position;
   ```
   Expected: positions 0..6, scheduled_at monotonic, `auto_send=true`, `status='pending'`, `fb_len>0`. `pregen_len` may be NULL for some on LLM failures.
4. Verify the default auto-followup was suppressed:
   ```sql
   select status, count(*) from lead_followup_schedules
   where thread_id='<thread-id>' group by status;
   ```
   Expected: no `pending` or `running` rows for this thread.

- [ ] **Scenario B — Soft resolution mid-sequence**

1. With the sequence from A still `active`, send: `"ok send pricing now"`.
2. Wait ~5 seconds (LLM call).
3. Query:
   ```sql
   select status, resolved_reason from lead_reminder_sequences where id='<seq-id>';
   ```
   Expected: `status='resolved'`, `resolved_reason='topic_addressed'`.
4. Advance the system clock past T1 (manually shift `scheduled_at` of position 0 to a past time, or wait). Trigger `/api/cron/reminders-tick`. Verify the touchpoint becomes `cancelled` (not `sent`).

- [ ] **Scenario C — Small-talk reply does NOT resolve**

1. New sequence from inbound `"follow up Friday morning about the proposal"`.
2. Send a small-talk reply: `"haha thanks"`.
3. Verify the sequence stays `active`.

- [ ] **Scenario D — Reschedule replaces the sequence**

1. With Scenario C's sequence `active`, send: `"actually make it next Monday instead"`.
2. Verify the old sequence row → `status='cancelled', resolved_reason='rescheduled'`, and a new active sequence exists with the Monday anchor.

- [ ] **Scenario E — Time awareness in the chatbot reply**

1. Send `"what's the date today?"`.
2. Verify the bot's reply contains today's actual Manila date — not an inferred or invented date.
3. Check the worker log: the chatbot system prompt should start with `Current time: ...`.

- [ ] **Scenario F — One-off reminder still works**

1. From the dashboard, manually create or use an existing one-off `lead_reminders` row (where `sequence_id IS NULL`).
2. Verify it fires through the existing single-shot path without touching the sequence-aware branch.

- [ ] **If any scenario fails:** open an issue describing the divergence, link to the spec/plan, and back out the failing task until corrected.

- [ ] **Final commit (if any docs/changelog updates needed):**

```bash
git add docs/
git commit -m "docs: verification log for reminder sequence rollout"
```

---

## Self-review

**Spec coverage check:**

| Spec section | Implemented in |
|--------------|----------------|
| Data model — sequences table | Task 6 |
| Data model — lead_reminders extensions | Task 6 |
| Schedule constants | Task 3 |
| Pre-generation + late refresh | Tasks 5, 7, 12 |
| Fallback pool | Task 4 |
| Time awareness — chatbot reply | Task 10 |
| Time awareness — agent draft | Task 11 |
| Time awareness — followup messages | Task 11 |
| Time awareness — reminder fire | Task 11 |
| Time awareness — extraction | Task 9 |
| hasTimeMarker pre-filter | Tasks 2, 9 |
| Synchronous extractReminder pre-reply | Task 13 |
| Auto-followup suppression | Task 13 |
| Active-sequence gate on subsequent inbounds | Task 13 |
| seedReminderSequence called on detection | Task 13 |
| Soft resolution via resolveActiveSequence | Tasks 8, 13 |
| Reschedule = replace on new request | Tasks 7, 13 |
| Sequence parent-status gate at fire time | Task 12 |
| Mark sequence exhausted after position 6 | Task 12 |
| Operator cancel route | Task 14 |
| Dashboard sequence grouping | Task 15 |
| End-to-end verification | Task 16 |

No spec section is unmapped.

**Placeholder scan:** none — every step contains the actual code or shell command.

**Type consistency check:** `SeedArgs.now` is optional in `sequence-seed.ts` and the caller in Task 13 does not pass it (defaults to `new Date()`). `generateSequenceMessage` returns `string | null`; `seedReminderSequence` and `fireReminder` both branch on null. `ReminderRow` in `fire.ts` includes all four new columns. `lead_reminder_sequences.status` enum values (`active|resolved|cancelled|exhausted`) match between the SQL, the `SequenceRow` interface, and the API route. `resolved_reason` enum (`topic_addressed|manual|rescheduled`) matches across SQL, seeder, resolver, and API route. The sequence-position type is `smallint` in SQL and `number` (constrained 0..6) in TS.
