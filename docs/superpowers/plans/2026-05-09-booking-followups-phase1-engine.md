# Booking Follow-ups Phase 1: Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the workflow-engine pieces needed for booking follow-ups: free-form offset parsing, a `utility_template` send-node payload with fire-time approval guard, an `action_page_id` filter on `booking_offset` triggers, and a `cancelBookingFollowups` helper. After this phase the engine can run booking-follow-up workflows built by hand in the workflow editor — Phase 2 builds the generator + UI on top.

**Architecture:** Pure helpers (`parseOffset`, `loadFollowupContext`) + small surgical edits to existing modules (`types.ts`, `executor.ts`, `dispatcher.ts`, `render.ts`). No new migration in this phase — `managed_kind` columns are added in Phase 2 with the generator. `cancelBookingFollowups` works off the existing `dedup_key` pattern.

**Tech Stack:** TypeScript, Next.js App Router, Vitest, Supabase (Postgres). Spec: `docs/superpowers/specs/2026-05-09-booking-followup-touchpoints-design.md`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/workflow/offsets.ts` (new) | Pure `parseOffset(s)` and `formatOffset(ms)` helpers for booking-offset strings |
| `src/lib/workflow/offsets.test.ts` (new) | Unit tests for the parser/formatter |
| `src/lib/workflow/types.ts` | Add `utility_template` variant to `SendNodeConfig.payload` |
| `src/lib/messenger-templates/render.ts` | Extend `VariableRule` with `booking_field` / `property_field`; extend `LeadForRender` with optional `booking` + `property` |
| `src/lib/messenger-templates/render.test.ts` (new) | Unit tests for the new field tokens |
| `src/lib/workflow/followup-context.ts` (new) | `loadFollowupContext(admin, runState)` — single-batch load of booking_events row + optional property action_page row |
| `src/lib/workflow/followup-context.test.ts` (new) | Unit tests with mocked admin client |
| `src/lib/workflow/executor.ts` | Extend `handleSend` to handle `utility_template` payload with approval guard |
| `src/lib/workflow/executor.test.ts` (extend or create) | Tests for the new send branch |
| `src/lib/workflow/dispatcher.ts` | Replace hardcoded `OFFSET_MS` loop in `dispatchBookingOffsets` with offset-set read from triggers; extend `matchFn` with `action_page_id` filter; add `cancelBookingFollowups` |
| `src/lib/workflow/dispatcher.test.ts` (new) | Tests for offset iteration, action_page_id filter, and `cancelBookingFollowups` |

---

## Task 1: `parseOffset` / `formatOffset` (TDD)

**Files:**
- Create: `src/lib/workflow/offsets.ts`
- Create: `src/lib/workflow/offsets.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/workflow/offsets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseOffset, formatOffset } from './offsets'

describe('parseOffset', () => {
  it('parses negative day offsets', () => {
    expect(parseOffset('-3d')).toBe(-3 * 24 * 60 * 60 * 1000)
    expect(parseOffset('-1d')).toBe(-1 * 24 * 60 * 60 * 1000)
  })
  it('parses negative hour and minute offsets', () => {
    expect(parseOffset('-2h')).toBe(-2 * 60 * 60 * 1000)
    expect(parseOffset('-10m')).toBe(-10 * 60 * 1000)
    expect(parseOffset('-5m')).toBe(-5 * 60 * 1000)
  })
  it('parses positive offsets', () => {
    expect(parseOffset('+1h')).toBe(60 * 60 * 1000)
    expect(parseOffset('+1d')).toBe(24 * 60 * 60 * 1000)
  })
  it('parses zero', () => {
    expect(parseOffset('0')).toBe(0)
    expect(parseOffset('+0')).toBe(0)
    expect(parseOffset('-0')).toBe(0)
  })
  it('treats unsigned values as positive', () => {
    expect(parseOffset('30m')).toBe(30 * 60 * 1000)
  })
  it('clamps to ±30d', () => {
    expect(parseOffset('-31d')).toBeNull()
    expect(parseOffset('+999d')).toBeNull()
  })
  it('rejects invalid input', () => {
    expect(parseOffset('')).toBeNull()
    expect(parseOffset('abc')).toBeNull()
    expect(parseOffset('-3y')).toBeNull()
    expect(parseOffset('1.5h')).toBeNull()
    expect(parseOffset('--5m')).toBeNull()
  })
})

describe('formatOffset', () => {
  it('formats negative day, hour, minute', () => {
    expect(formatOffset(-3 * 24 * 60 * 60 * 1000)).toBe('-3d')
    expect(formatOffset(-2 * 60 * 60 * 1000)).toBe('-2h')
    expect(formatOffset(-10 * 60 * 1000)).toBe('-10m')
  })
  it('formats positive', () => {
    expect(formatOffset(60 * 60 * 1000)).toBe('+1h')
    expect(formatOffset(0)).toBe('0')
  })
  it('round-trips parseOffset for canonical inputs', () => {
    for (const s of ['-3d', '-2h', '-10m', '+1h', '+1d', '0']) {
      const ms = parseOffset(s)
      expect(ms).not.toBeNull()
      expect(formatOffset(ms!)).toBe(s)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/workflow/offsets.test.ts`
Expected: FAIL — module `./offsets` not found.

- [ ] **Step 3: Implement `offsets.ts`**

Create `src/lib/workflow/offsets.ts`:

```ts
const MS_PER_MIN = 60 * 1000
const MS_PER_HOUR = 60 * MS_PER_MIN
const MS_PER_DAY = 24 * MS_PER_HOUR
const MAX_ABS_MS = 30 * MS_PER_DAY

const PATTERN = /^([+-]?)(\d+)([mhd])?$/

/**
 * Parse a booking-offset string like '-3d', '+1h', '-10m', '0'.
 * Returns milliseconds delta (negative=before event, positive=after).
 * Returns null for invalid input or values beyond ±30 days.
 */
export function parseOffset(s: string): number | null {
  if (typeof s !== 'string' || s.length === 0) return null
  const m = PATTERN.exec(s)
  if (!m) return null
  const [, sign, num, unit] = m
  const n = Number(num)
  if (!Number.isFinite(n)) return null

  // '0' / '+0' / '-0' with or without unit
  if (n === 0) return 0

  // Unitless non-zero is invalid except for '0'
  if (!unit) return null

  let ms: number
  if (unit === 'm') ms = n * MS_PER_MIN
  else if (unit === 'h') ms = n * MS_PER_HOUR
  else if (unit === 'd') ms = n * MS_PER_DAY
  else return null

  if (sign === '-') ms = -ms
  if (Math.abs(ms) > MAX_ABS_MS) return null
  return ms
}

/**
 * Inverse of parseOffset for canonical values. Picks the largest unit
 * that divides evenly. 0 is rendered as '0'.
 */
export function formatOffset(ms: number): string {
  if (ms === 0) return '0'
  const sign = ms < 0 ? '-' : '+'
  const abs = Math.abs(ms)
  if (abs % MS_PER_DAY === 0) return `${sign}${abs / MS_PER_DAY}d`
  if (abs % MS_PER_HOUR === 0) return `${sign}${abs / MS_PER_HOUR}h`
  return `${sign}${Math.round(abs / MS_PER_MIN)}m`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/workflow/offsets.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflow/offsets.ts src/lib/workflow/offsets.test.ts
git commit -m "feat(workflow): parseOffset/formatOffset helpers for booking offsets"
```

---

## Task 2: Extend `SendNodeConfig.payload` with `utility_template` variant

**Files:**
- Modify: `src/lib/workflow/types.ts`

This is a type-only change. No tests yet — Task 5 exercises the new branch through the executor.

- [ ] **Step 1: Replace the `payload` union in `SendNodeConfig`**

Current (`src/lib/workflow/types.ts:36-48`):

```ts
export interface SendNodeConfig {
  payload:
    | { kind: 'text'; text: string }
    | { kind: 'button'; text: string; url: string; ctaLabel: string }
  /**
   * ...existing JSDoc...
   */
  kind?: 'bot' | 'workflow_human_agent' | 'submission_echo'
}
```

Replace the `payload` union with three variants. The full block becomes:

```ts
export interface SendNodeConfig {
  payload:
    | { kind: 'text'; text: string }
    | { kind: 'button'; text: string; url: string; ctaLabel: string }
    | {
        kind: 'utility_template'
        /** messenger_message_templates.id */
        template_id: string
        /**
         * 1-based variable map keyed by '1', '2', ... matching the
         * {{1}}, {{2}}, ... placeholders in the template body.
         */
        variables: Record<
          string,
          | { kind: 'static'; text: string }
          | { kind: 'lead_field'; field: string }
          | { kind: 'booking_field'; field: 'event_at' | 'event_at_relative' | 'title' }
          | { kind: 'property_field'; field: 'title' | 'address' | 'price' | 'deeplink_url' }
        >
        /** Optional override for the template's URL button. Defaults to action page deeplink. */
        button_url_override?: string | null
        /** Index of the button to override; null = first URL button. */
        button_index?: number | null
      }
  /**
   * Channel hint forwarded to sendOutbound.
   * - 'bot'                  — only sends inside the 24h window; pauses otherwise.
   * - 'workflow_human_agent' — uses Messenger HUMAN_AGENT tag (7-day window).
   *   Default for new workflow send nodes; keep messages human-reviewable.
   * - 'submission_echo'      — confirmation echo after a form submission.
   */
  kind?: 'bot' | 'workflow_human_agent' | 'submission_echo'
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS, no new errors. (The executor's existing `sendOutbound(payload)` call type-checks because `outbound.ts` already accepts `kind: 'utility_template'`.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/workflow/types.ts
git commit -m "feat(workflow): add utility_template variant to SendNodeConfig.payload"
```

---

## Task 3: Extend `renderTemplateVariables` with booking + property field tokens (TDD)

**Files:**
- Modify: `src/lib/messenger-templates/render.ts`
- Create: `src/lib/messenger-templates/render.test.ts`

The current `VariableRule` supports `static` and `lead_field`. We add `booking_field` and `property_field`, and extend `LeadForRender` so callers can pass booking + property context. **Existing callers (Agent Campaigns) only pass lead — that path remains unchanged.**

- [ ] **Step 1: Write the failing tests**

Create `src/lib/messenger-templates/render.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { renderTemplateVariables, type LeadForRender } from './render'

const baseLead: LeadForRender = {
  name: 'Sarah Cruz',
  custom_fields: { city: 'Manila' },
}

describe('renderTemplateVariables — existing rules (regression)', () => {
  it('renders static and lead_field variables', () => {
    const out = renderTemplateVariables(
      {
        '1': { kind: 'lead_field', field: 'name' },
        '2': { kind: 'static', text: 'Welcome' },
        '3': { kind: 'lead_field', field: 'city' },
      },
      3,
      baseLead,
    )
    expect(out).toEqual(['Sarah Cruz', 'Welcome', 'Manila'])
  })
})

describe('renderTemplateVariables — booking_field', () => {
  const lead: LeadForRender = {
    ...baseLead,
    booking: {
      event_at: '2026-06-01T01:00:00Z',
      event_at_relative: 'in 24 hours',
      title: 'Sunset Villa viewing',
    },
  }

  it('resolves event_at_relative', () => {
    const out = renderTemplateVariables(
      { '1': { kind: 'booking_field', field: 'event_at_relative' } },
      1,
      lead,
    )
    expect(out).toEqual(['in 24 hours'])
  })

  it('resolves title', () => {
    const out = renderTemplateVariables(
      { '1': { kind: 'booking_field', field: 'title' } },
      1,
      lead,
    )
    expect(out).toEqual(['Sunset Villa viewing'])
  })

  it('returns empty string when booking context is missing', () => {
    const out = renderTemplateVariables(
      { '1': { kind: 'booking_field', field: 'title' } },
      1,
      baseLead, // no booking
    )
    expect(out).toEqual([''])
  })
})

describe('renderTemplateVariables — property_field', () => {
  const lead: LeadForRender = {
    ...baseLead,
    property: {
      title: 'Sunset Villa',
      address: '123 Coastal Rd',
      price: 'PHP 25M',
      deeplink_url: 'https://example.com/p/sunset-villa',
    },
  }

  it('resolves title and price', () => {
    const out = renderTemplateVariables(
      {
        '1': { kind: 'property_field', field: 'title' },
        '2': { kind: 'property_field', field: 'price' },
      },
      2,
      lead,
    )
    expect(out).toEqual(['Sunset Villa', 'PHP 25M'])
  })

  it('returns empty string when property context is missing', () => {
    const out = renderTemplateVariables(
      { '1': { kind: 'property_field', field: 'title' } },
      1,
      baseLead,
    )
    expect(out).toEqual([''])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/messenger-templates/render.test.ts`
Expected: FAIL — `booking` / `property` not on `LeadForRender`; new rule kinds unknown.

- [ ] **Step 3: Update `render.ts`**

Replace the entire current contents of `src/lib/messenger-templates/render.ts` with:

```ts
// Resolves an `agent_campaigns.template_variables` map into the array of
// body parameters expected by the Messenger Send API for a single lead.
//
// Supported rule kinds:
//   { kind: 'static', text }           — same literal value for every recipient
//   { kind: 'lead_field', field }      — pulls from the lead row
//   { kind: 'booking_field', field }   — pulls from booking context (Phase 1+)
//   { kind: 'property_field', field }  — pulls from property context (Phase 4)

import type { TemplateButton } from './types'

export type VariableRule =
  | { kind: 'static'; text: string }
  | { kind: 'lead_field'; field: string }
  | { kind: 'booking_field'; field: 'event_at' | 'event_at_relative' | 'title' }
  | { kind: 'property_field'; field: 'title' | 'address' | 'price' | 'deeplink_url' }

export type VariableMap = Record<string, VariableRule>

export interface BookingForRender {
  event_at: string
  event_at_relative: string
  title: string
}

export interface PropertyForRender {
  title: string
  address: string
  price: string
  deeplink_url: string
}

export interface LeadForRender {
  name: string | null
  custom_fields: Record<string, unknown> | null
  booking?: BookingForRender
  property?: PropertyForRender
}

export function renderTemplateVariables(
  variables: VariableMap,
  variableCount: number,
  lead: LeadForRender,
): string[] {
  const out: string[] = []
  for (let i = 1; i <= variableCount; i++) {
    const rule = variables[String(i)]
    out.push(resolveRule(rule, lead))
  }
  return out
}

function resolveRule(rule: VariableRule | undefined, lead: LeadForRender): string {
  if (!rule) return ''
  if (rule.kind === 'static') return rule.text ?? ''
  if (rule.kind === 'lead_field') {
    if (rule.field === 'name') return (lead.name ?? '').trim()
    const v = lead.custom_fields?.[rule.field]
    return typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v)
  }
  if (rule.kind === 'booking_field') {
    const b = lead.booking
    if (!b) return ''
    return b[rule.field] ?? ''
  }
  if (rule.kind === 'property_field') {
    const p = lead.property
    if (!p) return ''
    return p[rule.field] ?? ''
  }
  return ''
}

// Find the first URL-type button on a template, returning its index (or -1).
export function findFirstUrlButtonIndex(buttons: TemplateButton[]): number {
  return buttons.findIndex((b) => b.type === 'url')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/messenger-templates/render.test.ts`
Expected: PASS — all new + regression tests green.

- [ ] **Step 5: Run any other tests that import from `render.ts` and typecheck**

Run: `pnpm vitest run --grep render`
Then: `pnpm tsc --noEmit`
Expected: existing Agent Campaign code still typechecks. The `text` property on `static` is unchanged; `lead_field` is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/messenger-templates/render.ts src/lib/messenger-templates/render.test.ts
git commit -m "feat(templates): booking_field + property_field variable rules"
```

---

## Task 4: `loadFollowupContext` helper (TDD)

**Files:**
- Create: `src/lib/workflow/followup-context.ts`
- Create: `src/lib/workflow/followup-context.test.ts`

This helper takes the run state (which carries `booking_event_id` and optional `source_property_action_page_id` in `state.variables`), loads the booking row + property row, and produces a `LeadForRender` extension (`{ booking?, property? }`) the executor can spread onto the lead before calling `renderTemplateVariables`.

`event_at_relative` formatting is **deterministic**: relative to "now" at fire time. Granularity: days > hours > minutes; ±30s = "now".

- [ ] **Step 1: Write the failing tests**

Create `src/lib/workflow/followup-context.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { loadFollowupContext, formatRelative } from './followup-context'

describe('formatRelative', () => {
  const now = new Date('2026-05-31T01:00:00Z').getTime()

  it('returns "in 24 hours" 24h before', () => {
    expect(formatRelative('2026-06-01T01:00:00Z', now)).toBe('in 24 hours')
  })
  it('returns "in 10 minutes"', () => {
    expect(formatRelative('2026-05-31T01:10:00Z', now)).toBe('in 10 minutes')
  })
  it('returns "now" within plus or minus 30s', () => {
    expect(formatRelative('2026-05-31T01:00:15Z', now)).toBe('now')
    expect(formatRelative('2026-05-31T00:59:45Z', now)).toBe('now')
  })
  it('returns past phrasing', () => {
    expect(formatRelative('2026-05-30T01:00:00Z', now)).toBe('1 day ago')
    expect(formatRelative('2026-05-31T00:50:00Z', now)).toBe('10 minutes ago')
  })
})

describe('loadFollowupContext', () => {
  function makeAdmin(rows: { booking?: unknown; property?: unknown }) {
    const from = vi.fn((table: string) => {
      if (table === 'booking_events') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: rows.booking ?? null, error: null })),
            })),
          })),
        }
      }
      if (table === 'action_pages') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: rows.property ?? null, error: null })),
            })),
          })),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })
    return { from } as unknown as Parameters<typeof loadFollowupContext>[0]
  }

  it('returns booking only when no property id present', async () => {
    const admin = makeAdmin({
      booking: {
        event_at: '2026-06-01T01:00:00Z',
        timezone: 'Asia/Manila',
        title: null,
      },
    })
    const ctx = await loadFollowupContext(admin, {
      booking_event_id: 'be_1',
      now: new Date('2026-05-31T01:00:00Z').getTime(),
    })
    expect(ctx.booking).toEqual({
      event_at: '2026-06-01T01:00:00Z',
      event_at_relative: 'in 24 hours',
      title: '',
    })
    expect(ctx.property).toBeUndefined()
  })

  it('returns property when property id present and page is realestate', async () => {
    const admin = makeAdmin({
      booking: {
        event_at: '2026-06-01T01:00:00Z',
        timezone: 'UTC',
        title: 'Sunset Villa viewing',
      },
      property: {
        id: 'prop_1',
        kind: 'realestate',
        title: 'Sunset Villa',
        slug: 'sunset-villa',
        config: { address: '123 Coastal Rd', price: 'PHP 25M' },
      },
    })
    const ctx = await loadFollowupContext(admin, {
      booking_event_id: 'be_1',
      source_property_action_page_id: 'prop_1',
      now: new Date('2026-05-31T01:00:00Z').getTime(),
    })
    expect(ctx.booking?.title).toBe('Sunset Villa viewing')
    expect(ctx.property?.title).toBe('Sunset Villa')
    expect(ctx.property?.address).toBe('123 Coastal Rd')
    expect(ctx.property?.price).toBe('PHP 25M')
    expect(ctx.property?.deeplink_url).toContain('/a/sunset-villa')
  })

  it('returns no booking when booking_event_id missing', async () => {
    const admin = makeAdmin({})
    const ctx = await loadFollowupContext(admin, {
      now: Date.now(),
    })
    expect(ctx.booking).toBeUndefined()
    expect(ctx.property).toBeUndefined()
  })

  it('skips property when row is not realestate', async () => {
    const admin = makeAdmin({
      booking: { event_at: '2026-06-01T01:00:00Z', timezone: 'UTC', title: 't' },
      property: { id: 'p1', kind: 'form', title: 'x', slug: 's', config: {} },
    })
    const ctx = await loadFollowupContext(admin, {
      booking_event_id: 'be_1',
      source_property_action_page_id: 'p1',
      now: new Date('2026-05-31T01:00:00Z').getTime(),
    })
    expect(ctx.property).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/workflow/followup-context.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `followup-context.ts`**

Create `src/lib/workflow/followup-context.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BookingForRender, PropertyForRender } from '@/lib/messenger-templates/render'

export interface FollowupContextInput {
  booking_event_id?: string
  source_property_action_page_id?: string
  /** Override "now" — required for deterministic tests; defaults to Date.now(). */
  now?: number
}

export interface FollowupContext {
  booking?: BookingForRender
  property?: PropertyForRender
}

interface BookingRow {
  event_at: string
  timezone: string | null
  title: string | null
}

interface ActionPageRow {
  id: string
  kind: string
  title: string | null
  slug: string
  config: Record<string, unknown> | null
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''

export async function loadFollowupContext(
  admin: SupabaseClient,
  input: FollowupContextInput,
): Promise<FollowupContext> {
  const now = input.now ?? Date.now()
  const out: FollowupContext = {}

  if (input.booking_event_id) {
    const { data: bk } = await admin
      .from('booking_events')
      .select('event_at, timezone, title')
      .eq('id', input.booking_event_id)
      .maybeSingle<BookingRow>()
    if (bk) {
      out.booking = {
        event_at: bk.event_at,
        event_at_relative: formatRelative(bk.event_at, now),
        title: bk.title ?? '',
      }
    }
  }

  if (input.source_property_action_page_id) {
    const { data: prop } = await admin
      .from('action_pages')
      .select('id, kind, title, slug, config')
      .eq('id', input.source_property_action_page_id)
      .maybeSingle<ActionPageRow>()
    if (prop && prop.kind === 'realestate') {
      const cfg = (prop.config ?? {}) as { address?: string; price?: string | number }
      out.property = {
        title: prop.title ?? '',
        address: typeof cfg.address === 'string' ? cfg.address : '',
        price:
          typeof cfg.price === 'number'
            ? String(cfg.price)
            : typeof cfg.price === 'string'
              ? cfg.price
              : '',
        deeplink_url: APP_URL ? `${APP_URL}/a/${prop.slug}` : `/a/${prop.slug}`,
      }
    }
  }

  return out
}

/**
 * Humanize a delta between event time and `now`.
 * Granularity: days > hours > minutes. plus or minus 30s window = "now".
 */
export function formatRelative(eventAtIso: string, now: number): string {
  const eventMs = new Date(eventAtIso).getTime()
  if (Number.isNaN(eventMs)) return ''
  const deltaMs = eventMs - now
  const absMs = Math.abs(deltaMs)
  if (absMs <= 30_000) return 'now'

  const MS_PER_MIN = 60 * 1000
  const MS_PER_HOUR = 60 * MS_PER_MIN
  const MS_PER_DAY = 24 * MS_PER_HOUR

  let unit: string
  let n: number
  if (absMs >= MS_PER_DAY) {
    n = Math.round(absMs / MS_PER_DAY)
    unit = n === 1 ? 'day' : 'days'
  } else if (absMs >= MS_PER_HOUR) {
    n = Math.round(absMs / MS_PER_HOUR)
    unit = n === 1 ? 'hour' : 'hours'
  } else {
    n = Math.max(1, Math.round(absMs / MS_PER_MIN))
    unit = n === 1 ? 'minute' : 'minutes'
  }

  return deltaMs > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/workflow/followup-context.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflow/followup-context.ts src/lib/workflow/followup-context.test.ts
git commit -m "feat(workflow): loadFollowupContext + formatRelative helpers"
```

---

## Task 5: Executor — handle `utility_template` send payload (TDD)

**Files:**
- Modify: `src/lib/workflow/executor.ts`
- Create or extend: `src/lib/workflow/executor.test.ts`

The current `handleSend` (lines ~189-234) hands `config.payload` straight to `sendOutbound`. We add a pre-step: when `payload.kind === 'utility_template'`, load the template, enforce the approval guard, render variables (via the lead row + `loadFollowupContext`), and **rewrite the payload** before calling `sendOutbound`. Outside of that branch, behavior is unchanged.

- [ ] **Step 1: Write the failing tests**

Create or extend `src/lib/workflow/executor.test.ts`. If the file does not yet exist (likely), create it with this content. If it exists, append the new `describe` block:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock sendOutbound so we can capture the payload it receives.
const sendOutboundMock = vi.hoisted(() => vi.fn(async () => ({ sent: true, messageId: 'mid_1' })))
vi.mock('@/lib/messenger/outbound', () => ({
  sendOutbound: sendOutboundMock,
}))

import { handleSendForTest } from './executor'
import type { SendNodeConfig } from './types'

const makeAdmin = (templateRow: unknown) => {
  const from = vi.fn((table: string) => {
    if (table === 'messenger_message_templates') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: templateRow, error: null })),
          })),
        })),
      }
    }
    if (table === 'booking_events') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { event_at: '2026-06-01T01:00:00Z', timezone: 'UTC', title: 'My Booking' },
              error: null,
            })),
          })),
        })),
      }
    }
    if (table === 'action_pages') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })),
        })),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  return { from } as never
}

const baseCtx = {
  thread: { id: 't1', psid: 'ps1', last_inbound_at: null },
  pageToken: 'tok',
  lead: { name: 'Sarah', custom_fields: { city: 'Manila' } },
  run: {
    id: 'run_1',
    state: {
      variables: {
        booking_event_id: 'be_1',
      },
    },
  },
}

describe('executor handleSend — utility_template', () => {
  beforeEach(() => sendOutboundMock.mockClear())

  it('skips with policy_blocked when template is not approved', async () => {
    const admin = makeAdmin({
      id: 'tpl_1',
      meta_status: 'pending',
      template_name: 'booking_24h',
      language: 'en_US',
      variable_count: 1,
      buttons: [],
    })

    const config: SendNodeConfig = {
      payload: {
        kind: 'utility_template',
        template_id: 'tpl_1',
        variables: { '1': { kind: 'lead_field', field: 'name' } },
      },
    }

    const result = await handleSendForTest(admin, baseCtx, {
      id: 'n1',
      type: 'send',
      config: config as unknown as Record<string, unknown>,
    })

    expect(result.edge).toBe('policy_blocked')
    expect(result.payload.reason).toBe('template_not_approved')
    expect(sendOutboundMock).not.toHaveBeenCalled()
  })

  it('sends rendered utility_template payload when approved', async () => {
    const admin = makeAdmin({
      id: 'tpl_1',
      meta_status: 'approved',
      template_name: 'booking_24h',
      language: 'en_US',
      variable_count: 2,
      buttons: [],
    })

    const config: SendNodeConfig = {
      payload: {
        kind: 'utility_template',
        template_id: 'tpl_1',
        variables: {
          '1': { kind: 'lead_field', field: 'name' },
          '2': { kind: 'booking_field', field: 'event_at_relative' },
        },
      },
    }

    const result = await handleSendForTest(admin, baseCtx, {
      id: 'n1',
      type: 'send',
      config: config as unknown as Record<string, unknown>,
    })

    expect(result.edge).toBe('success')
    expect(sendOutboundMock).toHaveBeenCalledTimes(1)
    const sentPayload = sendOutboundMock.mock.calls[0][0].payload
    expect(sentPayload.kind).toBe('utility_template')
    expect(sentPayload.templateName).toBe('booking_24h')
    expect(sentPayload.language).toBe('en_US')
    expect(sentPayload.bodyParameters[0]).toBe('Sarah')
    expect(sentPayload.bodyParameters[1]).toMatch(/in \d+/)
  })

  it('skips with policy_blocked when template_id has no row', async () => {
    const admin = makeAdmin(null)
    const config: SendNodeConfig = {
      payload: {
        kind: 'utility_template',
        template_id: 'tpl_missing',
        variables: {},
      },
    }
    const result = await handleSendForTest(admin, baseCtx, {
      id: 'n1',
      type: 'send',
      config: config as unknown as Record<string, unknown>,
    })
    expect(result.edge).toBe('policy_blocked')
    expect(result.payload.reason).toBe('template_not_found')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/workflow/executor.test.ts`
Expected: FAIL — `handleSendForTest` is not exported, and the new branch doesn't exist.

- [ ] **Step 3: Modify `executor.ts` — add the new branch and a thin test export**

Open `src/lib/workflow/executor.ts`. Add these imports near the top with the other imports:

```ts
import { renderTemplateVariables, type LeadForRender } from '@/lib/messenger-templates/render'
import { loadFollowupContext } from './followup-context'
```

Replace the body of `handleSend` (currently at lines ~189-234) with this version. **It preserves the existing `text` / `button` path and adds a pre-rewrite for `utility_template`.**

```ts
async function handleSend(
  admin: AdminClient,
  ctx: RunContext,
  node: WorkflowNode,
): Promise<{ edge: string | null; payload: Record<string, unknown>; error: string | null }> {
  const config = node.config as unknown as SendNodeConfig

  if (!ctx.thread || !ctx.pageToken) {
    return {
      edge: 'error',
      payload: { reason: 'missing_thread_or_token' },
      error: 'thread or page token not available',
    }
  }

  let outboundPayload: SendNodeConfig['payload'] = config.payload
  let outboundKind: SendNodeConfig['kind'] = config.kind ?? 'workflow_human_agent'

  if (config.payload.kind === 'utility_template') {
    const rewritten = await rewriteUtilityTemplatePayload(admin, ctx, config.payload)
    if (rewritten.skip) {
      return { edge: 'policy_blocked', payload: { reason: rewritten.reason }, error: null }
    }
    outboundPayload = rewritten.payload as unknown as SendNodeConfig['payload']
    // utility_template carries its own permission outside the 24h window;
    // sendOutbound short-circuits on payload.kind === 'utility_template'.
    outboundKind = 'workflow_human_agent'
  }

  try {
    const result = await sendOutbound({
      admin,
      thread: {
        id: ctx.thread.id,
        psid: ctx.thread.psid,
        last_inbound_at: ctx.thread.last_inbound_at,
      },
      pageToken: ctx.pageToken,
      payload: outboundPayload,
      kind: outboundKind,
    })

    if (!result.sent) {
      return { edge: 'policy_blocked', payload: { reason: result.reason }, error: null }
    }
    return { edge: 'success', payload: { messageId: result.messageId }, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { edge: 'error', payload: {}, error: msg }
  }
}

interface TemplateRow {
  id: string
  meta_status: 'draft' | 'pending' | 'approved' | 'rejected' | 'disabled'
  template_name: string
  language: string
  variable_count: number
  buttons: Array<{ type: string; index?: number; url?: string }> | null
}

type UtilityTemplatePayload = Extract<SendNodeConfig['payload'], { kind: 'utility_template' }>

interface OutboundUtilityTemplate {
  kind: 'utility_template'
  templateName: string
  language: string
  bodyParameters: string[]
  buttonUrlOverrides?: Array<{ index: number; url: string }>
}

async function rewriteUtilityTemplatePayload(
  admin: AdminClient,
  ctx: RunContext,
  payload: UtilityTemplatePayload,
): Promise<{ skip: true; reason: string } | { skip: false; payload: OutboundUtilityTemplate }> {
  const { data: tpl } = await admin
    .from('messenger_message_templates')
    .select('id, meta_status, template_name, language, variable_count, buttons')
    .eq('id', payload.template_id)
    .maybeSingle<TemplateRow>()

  if (!tpl) return { skip: true, reason: 'template_not_found' }
  if (tpl.meta_status !== 'approved') return { skip: true, reason: 'template_not_approved' }

  const variables = (ctx.run.state as { variables?: Record<string, unknown> }).variables ?? {}
  const followup = await loadFollowupContext(admin, {
    booking_event_id:
      typeof variables.booking_event_id === 'string' ? variables.booking_event_id : undefined,
    source_property_action_page_id:
      typeof variables.source_property_action_page_id === 'string'
        ? variables.source_property_action_page_id
        : undefined,
  })

  const lead: LeadForRender = {
    name: ctx.lead?.name ?? null,
    custom_fields:
      (ctx.lead as { custom_fields?: Record<string, unknown> | null } | null)?.custom_fields ??
      null,
    booking: followup.booking,
    property: followup.property,
  }

  const bodyParameters = renderTemplateVariables(payload.variables, tpl.variable_count, lead)

  let buttonUrlOverrides: Array<{ index: number; url: string }> | undefined
  if (payload.button_url_override) {
    const buttons = tpl.buttons ?? []
    let idx = payload.button_index ?? -1
    if (idx < 0) idx = buttons.findIndex((b) => b.type === 'url')
    if (idx >= 0) buttonUrlOverrides = [{ index: idx, url: payload.button_url_override }]
  }

  return {
    skip: false,
    payload: {
      kind: 'utility_template',
      templateName: tpl.template_name,
      language: tpl.language,
      bodyParameters,
      ...(buttonUrlOverrides ? { buttonUrlOverrides } : {}),
    },
  }
}

// Test-only export. Marked with a clearly internal name to discourage
// production callers. Phase 2 generator and Phase 4 property fallback both
// rely on the production handleSend path; this is purely for unit tests.
export const handleSendForTest = handleSend as unknown as (
  admin: AdminClient,
  ctx: {
    thread: { id: string; psid: string; last_inbound_at: string | null } | null
    pageToken: string | null
    lead: { name: string | null; custom_fields?: Record<string, unknown> | null } | null
    run: { id: string; state: WorkflowRunState }
  },
  node: WorkflowNode,
) => ReturnType<typeof handleSend>
```

If the existing `LeadRow` type near the top of `executor.ts` does not include `custom_fields`, add it now:

```ts
interface LeadRow {
  id: string
  stage_id: string | null
  version: number
  custom_fields: Record<string, unknown> | null
}
```

And extend the lead-loading select inside `loadRunContext` (the function that builds `RunContext`) to include `custom_fields`. Search for `from('leads')` in `executor.ts` and add `custom_fields` to the `select(...)` column list.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/workflow/executor.test.ts`
Expected: PASS — all three tests green.

- [ ] **Step 5: Run full test suite to catch regressions**

Run: `pnpm vitest run && pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflow/executor.ts src/lib/workflow/executor.test.ts
git commit -m "feat(workflow): handle utility_template send payload with approval guard"
```

---

## Task 6: Dispatcher — read offsets from triggers, action_page_id filter, cancelBookingFollowups (TDD)

**Files:**
- Modify: `src/lib/workflow/dispatcher.ts`
- Create: `src/lib/workflow/dispatcher.test.ts`

Two changes in `dispatchBookingOffsets`:

1. The current loop iterates the hardcoded `OFFSET_MS` table. Replace with: look up active workflows that have at least one `booking_offset` trigger; for each `(workflow, trigger)` pair where `trigger.config.offset` parses, schedule one waiting run at `eventAt + parseOffset(offset)`.
2. Extend matching to honor `trigger.config.action_page_id` when set (otherwise match all bookings, preserving back-compat).

Also add `cancelBookingFollowups`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/workflow/dispatcher.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('./trigger', () => ({ triggerWorkflowWorker: vi.fn(async () => undefined) }))

import { dispatchBookingOffsets, cancelBookingFollowups } from './dispatcher'

interface Workflow {
  id: string
  version: number
  trigger?: { kind: string; config: Record<string, unknown> }
  triggers?: Array<{ kind: string; config: Record<string, unknown> }>
}

function makeAdmin(opts: { workflows: Workflow[] }) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const updates: Array<{
    table: string
    values: Record<string, unknown>
    where: Record<string, unknown>
  }> = []

  const from = vi.fn((table: string) => {
    if (table === 'workflows') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: opts.workflows, error: null })),
          })),
        })),
      }
    }
    if (table === 'workflow_runs') {
      return {
        insert: vi.fn((row: Record<string, unknown>) => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(async () => {
              inserts.push({ table, row })
              return { data: { id: `run_${inserts.length}` }, error: null }
            }),
          })),
        })),
        update: vi.fn((values: Record<string, unknown>) => {
          const where: Record<string, unknown> = {}
          const builder = {
            eq: vi.fn((col: string, val: unknown) => {
              where[col] = val
              return builder
            }),
            like: vi.fn((col: string, val: unknown) => {
              where[col] = val
              updates.push({ table, values, where })
              return Promise.resolve({ error: null })
            }),
          }
          return builder
        }),
      }
    }
    if (table === 'workflow_jobs') {
      return {
        insert: vi.fn(async (row: Record<string, unknown>) => {
          inserts.push({ table, row })
          return { error: null }
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })

  return { admin: { from } as never, inserts, updates }
}

const futureEventAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

describe('dispatchBookingOffsets', () => {
  it('schedules one run per offset present in the workflow triggers', async () => {
    const { admin, inserts } = makeAdmin({
      workflows: [
        {
          id: 'wf_1',
          version: 1,
          triggers: [
            { kind: 'booking_offset', config: { offset: '-1d' } },
            { kind: 'booking_offset', config: { offset: '-10m' } },
          ],
        },
      ],
    })

    await dispatchBookingOffsets(admin, {
      userId: 'u1',
      bookingEventId: 'be_1',
      leadId: 'l1',
      threadId: 't1',
      eventAt: futureEventAt,
    })

    const runInserts = inserts.filter((i) => i.table === 'workflow_runs')
    expect(runInserts).toHaveLength(2)
    const offsets = runInserts.map((i) => (i.row.dedup_key as string).split(':').pop())
    expect(offsets.sort()).toEqual(['-10m', '-1d'])
  })

  it('respects action_page_id filter on the trigger', async () => {
    const { admin, inserts } = makeAdmin({
      workflows: [
        {
          id: 'wf_a',
          version: 1,
          triggers: [
            { kind: 'booking_offset', config: { offset: '-1d', action_page_id: 'ap_match' } },
          ],
        },
        {
          id: 'wf_b',
          version: 1,
          triggers: [
            { kind: 'booking_offset', config: { offset: '-1d', action_page_id: 'ap_other' } },
          ],
        },
      ],
    })

    await dispatchBookingOffsets(admin, {
      userId: 'u1',
      bookingEventId: 'be_1',
      leadId: 'l1',
      threadId: 't1',
      eventAt: futureEventAt,
      actionPageId: 'ap_match',
    })

    const runInserts = inserts.filter((i) => i.table === 'workflow_runs')
    expect(runInserts).toHaveLength(1)
    expect(runInserts[0].row.dedup_key as string).toContain('wf_a')
  })

  it('matches workflows with no action_page_id (back-compat)', async () => {
    const { admin, inserts } = makeAdmin({
      workflows: [
        {
          id: 'wf_unfiltered',
          version: 1,
          triggers: [{ kind: 'booking_offset', config: { offset: '-1d' } }],
        },
      ],
    })

    await dispatchBookingOffsets(admin, {
      userId: 'u1',
      bookingEventId: 'be_1',
      leadId: 'l1',
      threadId: 't1',
      eventAt: futureEventAt,
      actionPageId: 'ap_anything',
    })

    expect(inserts.filter((i) => i.table === 'workflow_runs')).toHaveLength(1)
  })

  it('skips offsets that resolve into the past', async () => {
    const justAhead = new Date(Date.now() + 60_000).toISOString()
    const { admin, inserts } = makeAdmin({
      workflows: [
        {
          id: 'wf_1',
          version: 1,
          triggers: [
            { kind: 'booking_offset', config: { offset: '-1d' } }, // past
            { kind: 'booking_offset', config: { offset: '+1h' } }, // future
          ],
        },
      ],
    })

    await dispatchBookingOffsets(admin, {
      userId: 'u1',
      bookingEventId: 'be_1',
      leadId: 'l1',
      threadId: 't1',
      eventAt: justAhead,
    })

    const runInserts = inserts.filter((i) => i.table === 'workflow_runs')
    expect(runInserts).toHaveLength(1)
    expect(runInserts[0].row.dedup_key as string).toContain(':+1h')
  })

  it('ignores triggers with unparseable offsets', async () => {
    const { admin, inserts } = makeAdmin({
      workflows: [
        {
          id: 'wf_1',
          version: 1,
          triggers: [
            { kind: 'booking_offset', config: { offset: 'garbage' } },
            { kind: 'booking_offset', config: { offset: '-1d' } },
          ],
        },
      ],
    })

    await dispatchBookingOffsets(admin, {
      userId: 'u1',
      bookingEventId: 'be_1',
      leadId: 'l1',
      threadId: 't1',
      eventAt: futureEventAt,
    })

    const runInserts = inserts.filter((i) => i.table === 'workflow_runs')
    expect(runInserts).toHaveLength(1)
  })
})

describe('cancelBookingFollowups', () => {
  it('updates waiting runs matching the dedup_key pattern', async () => {
    const { admin, updates } = makeAdmin({ workflows: [] })
    await cancelBookingFollowups(admin, 'be_1')

    const cancelUpdates = updates.filter((u) => u.table === 'workflow_runs')
    expect(cancelUpdates).toHaveLength(1)
    expect(cancelUpdates[0].values.status).toBe('cancelled')
    expect(cancelUpdates[0].values.cancel_reason).toBe('booking_cancelled')
    expect(cancelUpdates[0].where.status).toBe('waiting')
    expect(cancelUpdates[0].where.dedup_key).toContain('be_1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/workflow/dispatcher.test.ts`
Expected: FAIL — `cancelBookingFollowups` doesn't exist; new offset behavior not yet implemented.

- [ ] **Step 3: Update `dispatcher.ts`**

Add the import near the top:

```ts
import { parseOffset } from './offsets'
```

Update `BookingBasePayload` to include the optional `actionPageId`:

```ts
export interface BookingBasePayload {
  userId: string
  bookingEventId: string
  leadId: string | null
  threadId: string | null
  eventAt: string  // ISO UTC
  /** When set, only fires triggers whose action_page_id matches (or is unset). */
  actionPageId?: string
}
```

Delete the existing `OFFSET_MS` constant.

Replace the entire body of `dispatchBookingOffsets` (currently lines ~281-323) with:

```ts
export async function dispatchBookingOffsets(
  admin: AdminClient,
  payload: BookingBasePayload,
): Promise<void> {
  const eventMs = new Date(payload.eventAt).getTime()
  if (Number.isNaN(eventMs)) {
    console.error('[workflow.dispatcher] dispatchBookingOffsets: invalid eventAt', payload.eventAt)
    return
  }

  const { data: workflows, error: wfErr } = await admin
    .from('workflows')
    .select('id, version, trigger, triggers')
    .eq('user_id', payload.userId)
    .eq('status', 'active')
  if (wfErr || !workflows?.length) return

  // Collect distinct (workflow, offset) pairs from booking_offset triggers.
  // Filter by action_page_id when the trigger declares one.
  type Pair = { wfId: string; offset: string; deltaMs: number }
  const pairs: Pair[] = []
  for (const wf of workflows) {
    const arr: Array<{ kind: string; config: Record<string, unknown> }> =
      Array.isArray(wf.triggers) && wf.triggers.length > 0
        ? (wf.triggers as Array<{ kind: string; config: Record<string, unknown> }>)
        : [wf.trigger as { kind: string; config: Record<string, unknown> }]
    const seen = new Set<string>()
    for (const t of arr) {
      if (t?.kind !== 'booking_offset') continue
      const cfg = t.config as { offset?: string; action_page_id?: string }
      if (!cfg.offset) continue
      // Trigger declares an action_page_id -> require caller to pass a matching one.
      if (cfg.action_page_id) {
        if (!payload.actionPageId || cfg.action_page_id !== payload.actionPageId) continue
      }
      const deltaMs = parseOffset(cfg.offset)
      if (deltaMs === null) continue
      if (seen.has(cfg.offset)) continue
      seen.add(cfg.offset)
      pairs.push({ wfId: wf.id, offset: cfg.offset, deltaMs })
    }
  }

  for (const { wfId, offset, deltaMs } of pairs) {
    const fireAtMs = eventMs + deltaMs
    if (Date.now() >= fireAtMs) continue
    const nextRunAt = new Date(fireAtMs).toISOString()

    try {
      await createRunsForMatchingWorkflows(admin, {
        userId: payload.userId,
        triggerKind: 'booking_offset',
        matchFn: (trigger) => {
          // Trust the pair pre-filter: only re-match by offset to keep the
          // existing helper's signature. createRunsForMatchingWorkflows
          // re-fetches workflows; cheap and keeps the diff minimal.
          const cfg = trigger.config as { offset?: string; action_page_id?: string }
          if (cfg.offset !== offset) return false
          if (cfg.action_page_id) {
            if (!payload.actionPageId || cfg.action_page_id !== payload.actionPageId) return false
          }
          return true
        },
        buildDedupKey: (id) => `wf:${id}:bk:${payload.bookingEventId}:${offset}`,
        buildRunSeed: () => ({
          lead_id: payload.leadId,
          thread_id: payload.threadId,
          state: {
            variables: {
              booking_event_id: payload.bookingEventId,
              event_at: payload.eventAt,
              offset,
            },
          },
          next_run_at: nextRunAt,
        }),
      })
    } catch (e) {
      console.error('[workflow.dispatcher] dispatchBookingOffsets pair threw', { wfId, offset, e })
    }
  }
}
```

Append `cancelBookingFollowups` at the bottom of the file:

```ts
/**
 * Cancels all *waiting* workflow runs scheduled for the given booking event.
 * Matches by dedup_key pattern `wf:%:bk:{bookingEventId}:%`. Idempotent.
 */
export async function cancelBookingFollowups(
  admin: AdminClient,
  bookingEventId: string,
): Promise<void> {
  try {
    const pattern = `wf:%:bk:${bookingEventId}:%`
    const { error } = await admin
      .from('workflow_runs')
      .update({
        status: 'cancelled',
        next_run_at: null,
        cancel_reason: 'booking_cancelled',
      })
      .eq('status', 'waiting')
      .like('dedup_key', pattern)
    if (error) {
      console.error('[workflow.dispatcher] cancelBookingFollowups failed', error.message)
    }
  } catch (e) {
    console.error('[workflow.dispatcher] cancelBookingFollowups threw', e)
  }
}
```

- [ ] **Step 4: Verify the `workflow_runs` table has a `cancel_reason` column**

Run via Grep: search `supabase/migrations/` for `cancel_reason`.

If `cancel_reason` is not present in any migration, create `supabase/migrations/20260523000000_workflow_runs_cancel_reason.sql`:

```sql
alter table public.workflow_runs
  add column if not exists cancel_reason text;
```

Otherwise skip the migration step.

- [ ] **Step 5: Run the dispatcher tests**

Run: `pnpm vitest run src/lib/workflow/dispatcher.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 6: Run full test suite + typecheck**

Run: `pnpm vitest run && pnpm tsc --noEmit`
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/lib/workflow/dispatcher.ts src/lib/workflow/dispatcher.test.ts
git commit -m "feat(workflow): trigger-driven booking offsets + action_page_id filter + cancelBookingFollowups"
```

If a migration was added in step 4, commit it separately:

```bash
git add supabase/migrations/20260523000000_workflow_runs_cancel_reason.sql
git commit -m "feat(workflow): add cancel_reason to workflow_runs"
```

---

## Task 7: Pass `actionPageId` from existing call sites

**Files:**
- Modify: any caller of `dispatchBookingOffsets`

- [ ] **Step 1: Find existing call sites**

Run via Grep: search `src/` for `dispatchBookingOffsets`.

The expected hit is `src/app/api/action-pages/submit/route.ts`.

- [ ] **Step 2: Add `actionPageId` to each call**

For each call site, append `actionPageId: page.id` (or `effectivePage.id` if the 2026-05-09 effective-trigger plan has already merged into this branch — check whether `effectivePage` is in scope at that point in the file).

Before:

```ts
await dispatchBookingOffsets(admin, {
  userId: page.user_id,
  bookingEventId: bookingEvent.id,
  leadId,
  threadId: messengerThreadId ?? null,
  eventAt: bookingEvent.event_at,
})
```

After:

```ts
await dispatchBookingOffsets(admin, {
  userId: page.user_id,
  bookingEventId: bookingEvent.id,
  leadId,
  threadId: messengerThreadId ?? null,
  eventAt: bookingEvent.event_at,
  actionPageId: page.id, // or effectivePage.id once that lands
})
```

Back-compat: hand-built workflows whose triggers don't declare `action_page_id` continue to match all bookings (the `if (cfg.action_page_id)` guard inside the dispatcher).

- [ ] **Step 3: Typecheck and run tests**

Run: `pnpm tsc --noEmit && pnpm vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -am "fix(action-pages): pass actionPageId to dispatchBookingOffsets"
```

If no call sites needed updating, skip this commit.

---

## Self-Review Notes

- **Spec coverage (Phase 1 slice):**
  - Free-form offsets → Task 1.
  - `utility_template` payload → Task 2 + Task 5.
  - `booking.*` / `property.*` field tokens → Task 3 + Task 4.
  - Approval guard at fire time → Task 5.
  - `action_page_id` trigger filter → Task 6.
  - `cancelBookingFollowups` helper → Task 6.
  - Phase 1 explicitly defers: `managed_kind` migration, `resolveFollowupPageId`, generator, UI, manual-edit guard, cancel hook wire-up, realestate editor mount. Those are Phases 2–4.
- **Phase 1 testability:** A user can hand-build a one-node workflow in the editor with a `utility_template` send node + a `booking_offset` trigger (with `action_page_id` set to a booking page id) and exercise the full flow on a real booking submission. No UI changes are required to validate Phase 1.
- **No placeholders.** Each step has the exact code or shell command. Tests use real values.
- **Type consistency:**
  - `VariableRule` keys (`text`) match across `render.ts` and the new `SendNodeConfig.payload.variables` map.
  - `BookingForRender` / `PropertyForRender` shape used by `loadFollowupContext` matches the `LeadForRender` extension consumed by `renderTemplateVariables`.
  - `cancelBookingFollowups` dedup_key pattern (`wf:%:bk:{id}:%`) matches the build pattern in `dispatchBookingOffsets`.
- **Risk: `workflow_runs.cancel_reason` column.** Task 6 step 4 explicitly checks and adds it conditionally.
- **Risk: `RunContext.lead` may not include `custom_fields`.** Task 5 step 3 calls this out and adds the field if missing.
