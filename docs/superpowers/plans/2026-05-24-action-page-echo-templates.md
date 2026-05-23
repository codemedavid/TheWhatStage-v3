# Action Page Echo Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plain-text Messenger echoes on action-page submissions with a templated renderer (namespaced `{{var}}` placeholders + `||` fallbacks), shared editor with picker/preview, and an opt-in payment-screenshot follow-up image for catalog and sales.

**Architecture:** One small pure renderer (`src/lib/action-pages/echo/render.ts`), one shared context builder, one variable registry. Submit route swaps `buildOrderEcho()` for the renderer; editor surfaces share a new `EchoTemplateField` component. Existing catalog rows are backfilled to templated equivalents. No new tables, no RLS changes.

**Tech Stack:** TypeScript, Next.js App Router, Supabase, Vitest, Zod, React 18.

**Spec:** `docs/superpowers/specs/2026-05-24-action-page-echo-templates-design.md`

---

## File map

**New files:**
- `src/lib/action-pages/echo/render.ts` — pure template renderer
- `src/lib/action-pages/echo/render.test.ts`
- `src/lib/action-pages/echo/format.ts` — date/time/currency helpers
- `src/lib/action-pages/echo/format.test.ts`
- `src/lib/action-pages/echo/variables.ts` — `VARIABLES_BY_KIND` registry
- `src/lib/action-pages/echo/variables.test.ts`
- `src/lib/action-pages/echo/context.ts` — `buildEchoContext()`
- `src/lib/action-pages/echo/context.test.ts`
- `src/lib/action-pages/echo/index.ts` — re-exports
- `supabase/migrations/20260525000000_action_pages_echo_templates_backfill.sql`
- `src/app/(app)/dashboard/action-pages/_components/EchoTemplateField.tsx`
- `src/app/(app)/dashboard/action-pages/_components/EchoTemplateField.test.tsx`
- `src/app/(app)/dashboard/action-pages/actions/preview-echo.ts` — server action

**Modified files:**
- `src/app/api/action-pages/submit/route.ts` — swap echo block; add proof-image follow-up; delete `buildOrderEcho`
- `src/app/api/action-pages/submit/route.test.ts` — add templated catalog + payment-proof cases
- `src/lib/action-pages/kinds.ts` — replace `defaultNotificationText` for each kind
- `src/app/(app)/dashboard/action-pages/_lib/schemas.ts` — extend `notification_template` schema with `echo_payment_proof`
- `src/app/(app)/dashboard/action-pages/actions/crud.ts` — persist `echo_payment_proof`
- `src/app/(app)/dashboard/action-pages/_components/EditActionPageShell.tsx` — use `EchoTemplateField`
- `src/app/(app)/dashboard/action-pages/_kinds/catalog/CatalogShell.tsx` — use `EchoTemplateField` + proof toggle
- `src/app/(app)/dashboard/action-pages/_kinds/realestate/RealestateShell.tsx` — use `EchoTemplateField`
- `src/app/(app)/dashboard/action-pages/_components/PipelineRulesEditor.tsx` — use compact `EchoTemplateField`
- `src/app/(app)/dashboard/action-pages/_kinds/qualification/OutcomeCard.tsx` — use compact `EchoTemplateField`
- `src/app/(app)/dashboard/action-pages/_kinds/sales/Editor.tsx` — proof toggle (if sales has its own echo surface; otherwise covered by EditActionPageShell)

---

## Conventions

- Run tests with `pnpm vitest <path>` (or `npx vitest <path>` if no pnpm).
- Commit messages follow conventional commits: `feat(echo): ...`, `test(echo): ...`, `refactor(submit): ...`, `chore(db): ...`.
- One commit per task unless a task explicitly says otherwise.
- Never use `git add -A` — stage files by name.

---

## Task 1: Renderer — tokenizer + value lookup

**Files:**
- Create: `src/lib/action-pages/echo/render.ts`
- Create: `src/lib/action-pages/echo/render.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/action-pages/echo/render.test.ts
import { describe, expect, it } from 'vitest'
import { renderEchoTemplate } from './render'

const KNOWN = new Set([
  'customer.name',
  'customer.email',
  'customer.phone',
  'fb.name',
  'booking.date',
  'booking.time',
])

describe('renderEchoTemplate', () => {
  it('returns the template unchanged when it has no placeholders', () => {
    const result = renderEchoTemplate('Hello world', {}, KNOWN)
    expect(result.text).toBe('Hello world')
    expect(result.warnings).toEqual([])
  })

  it('substitutes a known dotted path', () => {
    const result = renderEchoTemplate(
      'Hi {{customer.name}}!',
      { customer: { name: 'Maria' } },
      KNOWN,
    )
    expect(result.text).toBe('Hi Maria!')
    expect(result.warnings).toEqual([])
  })

  it('renders empty string for a known path with no value', () => {
    const result = renderEchoTemplate(
      'Hi {{customer.name}}!',
      { customer: {} },
      KNOWN,
    )
    expect(result.text).toBe('Hi !')
    expect(result.warnings).toEqual([])
  })

  it('renders empty string for a missing nested object', () => {
    const result = renderEchoTemplate('{{customer.name}}', {}, KNOWN)
    expect(result.text).toBe('')
  })

  it('tolerates whitespace inside braces', () => {
    const result = renderEchoTemplate(
      '{{  customer.name  }}',
      { customer: { name: 'Ana' } },
      KNOWN,
    )
    expect(result.text).toBe('Ana')
  })

  it('falls back to the next operand in an || chain', () => {
    const result = renderEchoTemplate(
      '{{fb.name || customer.name}}',
      { fb: {}, customer: { name: 'Liza' } },
      KNOWN,
    )
    expect(result.text).toBe('Liza')
  })

  it('falls back to a quoted literal when all paths are empty', () => {
    const result = renderEchoTemplate(
      '{{fb.name || customer.name || "there"}}',
      { fb: {}, customer: {} },
      KNOWN,
    )
    expect(result.text).toBe('there')
  })

  it('accepts whitespace around || operators and quoted literals', () => {
    const result = renderEchoTemplate(
      '{{ fb.name   ||  "Hello there" }}',
      { fb: {} },
      KNOWN,
    )
    expect(result.text).toBe('Hello there')
  })

  it('emits an "unknown" warning for paths not in the known set, rendering empty', () => {
    const result = renderEchoTemplate(
      '{{customer.adress}}',
      { customer: {} },
      KNOWN,
    )
    expect(result.text).toBe('')
    expect(result.warnings).toEqual([{ token: 'customer.adress', reason: 'unknown' }])
  })

  it('emits a "malformed" warning for unsupported syntax and leaves literal text', () => {
    const result = renderEchoTemplate(
      'pre {{#if customer.name}}x{{/if}} post',
      { customer: {} },
      KNOWN,
    )
    expect(result.text).toBe('pre {{#if customer.name}}x{{/if}} post')
    expect(result.warnings).toEqual([
      { token: '#if customer.name', reason: 'malformed' },
      { token: '/if', reason: 'malformed' },
    ])
  })

  it('renders multiple placeholders in one template', () => {
    const result = renderEchoTemplate(
      'Hi {{customer.name}}, you are booked at {{booking.time}} on {{booking.date}}.',
      {
        customer: { name: 'Maria' },
        booking: { time: '2:30 PM', date: 'May 28, 2026' },
      },
      KNOWN,
    )
    expect(result.text).toBe('Hi Maria, you are booked at 2:30 PM on May 28, 2026.')
  })

  it('stringifies numeric values', () => {
    const result = renderEchoTemplate(
      '{{customer.phone}}',
      { customer: { phone: 1234 } },
      new Set(['customer.phone']),
    )
    expect(result.text).toBe('1234')
  })

  it('hard-errors above the placeholder cap of 500', () => {
    const tpl = '{{customer.name}}'.repeat(501)
    expect(() =>
      renderEchoTemplate(tpl, { customer: { name: 'X' } }, KNOWN),
    ).toThrow(/too many placeholders/i)
  })

  it('rejects bare double-braces without a path as malformed', () => {
    const result = renderEchoTemplate('a {{}} b', {}, KNOWN)
    expect(result.text).toBe('a {{}} b')
    expect(result.warnings).toEqual([{ token: '', reason: 'malformed' }])
  })
})
```

- [ ] **Step 2: Run tests, expect fail**

Run: `npx vitest src/lib/action-pages/echo/render.test.ts --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement renderer**

```ts
// src/lib/action-pages/echo/render.ts
export interface RenderWarning {
  token: string
  reason: 'unknown' | 'malformed'
}

export interface RenderResult {
  text: string
  warnings: RenderWarning[]
}

const PLACEHOLDER_RE = /\{\{([\s\S]*?)\}\}/g
const PATH_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/
const MAX_PLACEHOLDERS = 500

export function renderEchoTemplate(
  template: string,
  ctx: Record<string, unknown>,
  known: Set<string>,
): RenderResult {
  const warnings: RenderWarning[] = []
  let count = 0

  const out = template.replace(PLACEHOLDER_RE, (_match, inner: string) => {
    count += 1
    if (count > MAX_PLACEHOLDERS) {
      throw new Error('echo template has too many placeholders')
    }
    const expr = inner.trim()
    const operands = expr.split('||').map((op) => op.trim())
    if (operands.length === 0 || operands.some((op) => op.length === 0) === false && operands.every((op) => op.length === 0)) {
      warnings.push({ token: expr, reason: 'malformed' })
      return `{{${inner}}}`
    }
    if (operands.length === 1 && operands[0] === '') {
      warnings.push({ token: '', reason: 'malformed' })
      return '{{}}'
    }
    let chainHasError = false
    for (const op of operands) {
      if (isQuotedLiteral(op)) continue
      if (PATH_RE.test(op)) continue
      chainHasError = true
      break
    }
    if (chainHasError) {
      warnings.push({ token: expr, reason: 'malformed' })
      return `{{${inner}}}`
    }
    for (const op of operands) {
      if (isQuotedLiteral(op)) return stripQuotes(op)
      if (!known.has(op)) {
        warnings.push({ token: op, reason: 'unknown' })
        continue
      }
      const value = lookup(ctx, op)
      if (value !== undefined && value !== null && String(value).length > 0) {
        return String(value)
      }
    }
    return ''
  })

  return { text: out, warnings }
}

function isQuotedLiteral(operand: string): boolean {
  return operand.length >= 2 && operand.startsWith('"') && operand.endsWith('"')
}

function stripQuotes(operand: string): string {
  return operand.slice(1, -1)
}

function lookup(ctx: Record<string, unknown>, path: string): unknown {
  let cur: unknown = ctx
  for (const segment of path.split('.')) {
    if (cur === null || cur === undefined) return undefined
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[segment]
  }
  return cur
}
```

- [ ] **Step 4: Run tests, fix until green**

Run: `npx vitest src/lib/action-pages/echo/render.test.ts --run`
Expected: PASS for all cases. If `chainHasError` logic mishandles the empty-operand case, the bare `{{}}` test will fail — fix by short-circuiting on `expr === ''` first.

- [ ] **Step 5: Commit**

```bash
git add src/lib/action-pages/echo/render.ts src/lib/action-pages/echo/render.test.ts
git commit -m "feat(echo): pure template renderer with || fallbacks"
```

---

## Task 2: Format helpers

**Files:**
- Create: `src/lib/action-pages/echo/format.ts`
- Create: `src/lib/action-pages/echo/format.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/action-pages/echo/format.test.ts
import { describe, expect, it } from 'vitest'
import {
  formatCurrency,
  formatDateInTz,
  formatTimeInTz,
  formatDateTimeInTz,
  formatDurationMinutes,
} from './format'

describe('formatCurrency', () => {
  it('formats PHP amounts with peso sign', () => {
    expect(formatCurrency(2500, 'PHP')).toMatch(/₱2,500/)
  })

  it('formats USD amounts', () => {
    expect(formatCurrency(99.5, 'USD')).toMatch(/\$99\.50/)
  })

  it('falls back to "<amount> <currency>" on an unknown currency code', () => {
    expect(formatCurrency(10, 'XYZ')).toBe('10.00 XYZ')
  })

  it('returns empty string on null/undefined/NaN', () => {
    expect(formatCurrency(null, 'PHP')).toBe('')
    expect(formatCurrency(undefined, 'PHP')).toBe('')
    expect(formatCurrency(Number.NaN, 'PHP')).toBe('')
  })
})

describe('formatDateInTz', () => {
  it('formats an ISO timestamp in Asia/Manila as a medium date', () => {
    const out = formatDateInTz('2026-05-28T06:30:00Z', 'Asia/Manila')
    expect(out).toMatch(/May 28, 2026/)
  })

  it('returns empty string on invalid input', () => {
    expect(formatDateInTz('not-a-date', 'Asia/Manila')).toBe('')
    expect(formatDateInTz(null, 'Asia/Manila')).toBe('')
  })
})

describe('formatTimeInTz', () => {
  it('formats an ISO timestamp in Asia/Manila as a short time', () => {
    const out = formatTimeInTz('2026-05-28T06:30:00Z', 'Asia/Manila')
    expect(out).toMatch(/2:30/)
  })
})

describe('formatDateTimeInTz', () => {
  it('combines date and time in the same timezone', () => {
    const out = formatDateTimeInTz('2026-05-28T06:30:00Z', 'Asia/Manila')
    expect(out).toMatch(/May 28, 2026/)
    expect(out).toMatch(/2:30/)
  })
})

describe('formatDurationMinutes', () => {
  it('formats minutes as "30 min"', () => {
    expect(formatDurationMinutes(30)).toBe('30 min')
  })

  it('returns empty string on null/undefined', () => {
    expect(formatDurationMinutes(null)).toBe('')
    expect(formatDurationMinutes(undefined)).toBe('')
  })
})
```

- [ ] **Step 2: Run tests, expect fail**

Run: `npx vitest src/lib/action-pages/echo/format.test.ts --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/action-pages/echo/format.ts
export function formatCurrency(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return ''
  try {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

export function formatDateInTz(iso: string | null | undefined, tz: string): string {
  const d = parseIso(iso)
  if (!d) return ''
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'medium' }).format(d)
  } catch {
    return ''
  }
}

export function formatTimeInTz(iso: string | null | undefined, tz: string): string {
  const d = parseIso(iso)
  if (!d) return ''
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeStyle: 'short' }).format(d)
  } catch {
    return ''
  }
}

export function formatDateTimeInTz(iso: string | null | undefined, tz: string): string {
  const date = formatDateInTz(iso, tz)
  const time = formatTimeInTz(iso, tz)
  if (!date && !time) return ''
  if (!date) return time
  if (!time) return date
  return `${date} at ${time}`
}

export function formatDurationMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return ''
  return `${minutes} min`
}

function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest src/lib/action-pages/echo/format.test.ts --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/action-pages/echo/format.ts src/lib/action-pages/echo/format.test.ts
git commit -m "feat(echo): currency/date/time/duration formatters"
```

---

## Task 3: Variable registry

**Files:**
- Create: `src/lib/action-pages/echo/variables.ts`
- Create: `src/lib/action-pages/echo/variables.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/action-pages/echo/variables.test.ts
import { describe, expect, it } from 'vitest'
import { ACTION_PAGE_KINDS } from '@/lib/action-pages/kinds'
import { VARIABLES_BY_KIND, knownPathsForKind, sampleContextForKind } from './variables'
import { renderEchoTemplate } from './render'

describe('VARIABLES_BY_KIND', () => {
  for (const kind of ACTION_PAGE_KINDS) {
    it(`has at least one variable for kind ${kind}`, () => {
      expect(VARIABLES_BY_KIND[kind].length).toBeGreaterThan(0)
    })

    it(`has unique paths for kind ${kind}`, () => {
      const paths = VARIABLES_BY_KIND[kind].map((v) => v.path)
      expect(new Set(paths).size).toBe(paths.length)
    })

    it(`has label, sample, and group for every variable in ${kind}`, () => {
      for (const v of VARIABLES_BY_KIND[kind]) {
        expect(v.label.length).toBeGreaterThan(0)
        expect(v.sample.length).toBeGreaterThan(0)
        expect(v.group.length).toBeGreaterThan(0)
      }
    })

    it(`renders every variable for ${kind} against its sample without warnings`, () => {
      const known = knownPathsForKind(kind, [])
      const ctx = sampleContextForKind(kind, [])
      for (const v of VARIABLES_BY_KIND[kind]) {
        const result = renderEchoTemplate(`{{${v.path}}}`, ctx, known)
        expect(result.warnings).toEqual([])
        expect(result.text).toBe(v.sample)
      }
    })
  }
})

describe('knownPathsForKind', () => {
  it('extends with custom.<key> paths for kinds that accept custom fields', () => {
    const known = knownPathsForKind('catalog', ['notes', 'address'])
    expect(known.has('custom.notes')).toBe(true)
    expect(known.has('custom.address')).toBe(true)
  })

  it('ignores custom keys for kinds that do not declare a Custom group', () => {
    const before = knownPathsForKind('qualification', [])
    const after = knownPathsForKind('qualification', ['foo'])
    expect(after.has('custom.foo')).toBe(false)
    expect(after.size).toBe(before.size)
  })
})
```

- [ ] **Step 2: Run tests, expect fail**

Run: `npx vitest src/lib/action-pages/echo/variables.test.ts --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/action-pages/echo/variables.ts
import type { ActionPageKind } from '@/lib/action-pages/kinds'

export interface VariableDef {
  path: string
  label: string
  sample: string
  group: string
}

const SHARED_BASE: VariableDef[] = [
  { path: 'fb.name', label: 'Facebook profile name', sample: 'Maria Santos', group: 'Facebook' },
  { path: 'lead.name', label: 'Lead name', sample: 'Maria Santos', group: 'Lead' },
  { path: 'lead.phone', label: 'Lead phone', sample: '+639171234567', group: 'Lead' },
  { path: 'lead.email', label: 'Lead email', sample: 'maria@example.com', group: 'Lead' },
  { path: 'page.title', label: 'Action page title', sample: 'Book a call', group: 'Page' },
  { path: 'page.url', label: 'Action page URL', sample: 'https://app.example.com/a/book-a-call', group: 'Page' },
]

const CUSTOMER: VariableDef[] = [
  { path: 'customer.name', label: 'Customer name', sample: 'Maria Santos', group: 'Customer' },
  { path: 'customer.phone', label: 'Customer phone', sample: '+639171234567', group: 'Customer' },
  { path: 'customer.email', label: 'Customer email', sample: 'maria@example.com', group: 'Customer' },
  { path: 'customer.notes', label: 'Customer notes', sample: 'Please call before delivery', group: 'Customer' },
]

const BOOKING: VariableDef[] = [
  { path: 'booking.date', label: 'Booking date', sample: 'May 28, 2026', group: 'Booking' },
  { path: 'booking.time', label: 'Booking time', sample: '2:30 PM', group: 'Booking' },
  { path: 'booking.datetime', label: 'Booking date + time', sample: 'May 28, 2026 at 2:30 PM', group: 'Booking' },
  { path: 'booking.duration', label: 'Booking duration', sample: '30 min', group: 'Booking' },
]

const ORDER: VariableDef[] = [
  { path: 'order.items_lines', label: 'Order items (multi-line)', sample: '• 1x Heavy Duty Helmet — ₱2,500.00\n• 4x Flashlight — ₱1,200.00', group: 'Order' },
  { path: 'order.items', label: 'Order items (inline)', sample: '1x Heavy Duty Helmet, 4x Flashlight', group: 'Order' },
  { path: 'order.subtotal', label: 'Order subtotal', sample: '₱3,700.00', group: 'Order' },
  { path: 'order.total', label: 'Order total', sample: '₱3,700.00', group: 'Order' },
  { path: 'order.currency', label: 'Order currency', sample: 'PHP', group: 'Order' },
  { path: 'order.count', label: 'Number of items', sample: '5', group: 'Order' },
]

const PAYMENT: VariableDef[] = [
  { path: 'payment.method', label: 'Payment method', sample: 'GCash', group: 'Payment' },
  { path: 'payment.amount', label: 'Payment amount', sample: '₱3,700.00', group: 'Payment' },
  { path: 'payment.note', label: 'Payment note', sample: 'Ref: GC-12345', group: 'Payment' },
]

const PROPERTY: VariableDef[] = [
  { path: 'property.title', label: 'Property title', sample: 'Skyline Residences', group: 'Property' },
  { path: 'property.price', label: 'Property price', sample: '₱8,500,000', group: 'Property' },
  { path: 'property.address', label: 'Property address', sample: 'Bonifacio Global City, Taguig', group: 'Property' },
  { path: 'property.unit_title', label: 'Property unit', sample: 'Unit 12B', group: 'Property' },
]

const SALES: VariableDef[] = [
  { path: 'sales.product', label: 'Sales product name', sample: 'Pro Plan', group: 'Sales' },
  { path: 'sales.price', label: 'Sales price', sample: '₱999.00', group: 'Sales' },
]

export const VARIABLES_BY_KIND: Record<ActionPageKind, VariableDef[]> = {
  form: [...SHARED_BASE, ...CUSTOMER],
  booking: [...SHARED_BASE, ...CUSTOMER, ...BOOKING],
  qualification: [...SHARED_BASE],
  sales: [...SHARED_BASE, ...CUSTOMER, ...SALES, ...PAYMENT],
  catalog: [...SHARED_BASE, ...CUSTOMER, ...ORDER, ...PAYMENT],
  realestate: [...SHARED_BASE, ...CUSTOMER, ...PROPERTY],
}

const KINDS_WITH_CUSTOM: ReadonlySet<ActionPageKind> = new Set(['catalog', 'booking', 'realestate'])

export function knownPathsForKind(kind: ActionPageKind, customKeys: readonly string[]): Set<string> {
  const out = new Set(VARIABLES_BY_KIND[kind].map((v) => v.path))
  if (KINDS_WITH_CUSTOM.has(kind)) {
    for (const key of customKeys) out.add(`custom.${key}`)
  }
  return out
}

export function sampleContextForKind(
  kind: ActionPageKind,
  customKeys: readonly string[],
): Record<string, unknown> {
  const ctx: Record<string, unknown> = {}
  for (const v of VARIABLES_BY_KIND[kind]) {
    setPath(ctx, v.path, v.sample)
  }
  if (KINDS_WITH_CUSTOM.has(kind)) {
    const custom = (ctx.custom as Record<string, unknown>) ?? {}
    for (const key of customKeys) custom[key] = `[${key} sample]`
    if (customKeys.length > 0) ctx.custom = custom
  }
  return ctx
}

function setPath(ctx: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.')
  let cur: Record<string, unknown> = ctx
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i]
    const existing = cur[seg]
    if (!existing || typeof existing !== 'object') {
      cur[seg] = {}
    }
    cur = cur[seg] as Record<string, unknown>
  }
  cur[segments[segments.length - 1]] = value
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest src/lib/action-pages/echo/variables.test.ts --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/action-pages/echo/variables.ts src/lib/action-pages/echo/variables.test.ts
git commit -m "feat(echo): variable registry per action-page kind"
```

---

## Task 4: Context builder

**Files:**
- Create: `src/lib/action-pages/echo/context.ts`
- Create: `src/lib/action-pages/echo/context.test.ts`
- Create: `src/lib/action-pages/echo/index.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/action-pages/echo/context.test.ts
import { describe, expect, it, vi } from 'vitest'
import { buildEchoContext } from './context'

interface MockTable {
  leads?: { id: string; name: string | null; email: string | null; phone: string | null } | null
  threads?: { id: string; full_name: string | null } | null
  payment_methods?: { id: string; label: string } | null
}

function makeAdmin(rows: MockTable) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: rows.leads ?? null, error: null }) }),
          }),
        }
      }
      if (table === 'messenger_threads') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: rows.threads ?? null, error: null }) }),
          }),
        }
      }
      if (table === 'payment_methods') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: rows.payment_methods ?? null, error: null }) }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    }),
  } as never
}

const PAGE_FORM = {
  id: 'ap_1',
  user_id: 'u_1',
  kind: 'form' as const,
  slug: 'welcome',
  config: {},
  pipeline_rules: [],
  notification_template: null,
  signing_secret: 's',
}

describe('buildEchoContext', () => {
  it('resolves fb.name from messenger_threads.full_name', async () => {
    const admin = makeAdmin({ threads: { id: 't_1', full_name: 'Maria Santos' } })
    const { ctx, known } = await buildEchoContext({
      admin,
      page: PAGE_FORM,
      parsed: { outcome: 'submitted', data: {} },
      leadId: null,
      threadId: 't_1',
      psid: 'PSID_1',
      fbPageId: 'fbp_1',
    })
    expect((ctx as { fb: { name: string } }).fb.name).toBe('Maria Santos')
    expect(known.has('fb.name')).toBe(true)
  })

  it('resolves lead.* from the leads row', async () => {
    const admin = makeAdmin({
      leads: { id: 'l_1', name: 'Maria', email: 'm@x.com', phone: '+639' },
    })
    const { ctx } = await buildEchoContext({
      admin,
      page: PAGE_FORM,
      parsed: { outcome: 'submitted', data: {} },
      leadId: 'l_1',
      threadId: null,
      psid: null,
      fbPageId: null,
    })
    expect((ctx as { lead: { name: string; email: string; phone: string } }).lead).toEqual({
      name: 'Maria',
      email: 'm@x.com',
      phone: '+639',
    })
  })

  it('builds customer.* from parsed.data.customer for catalog', async () => {
    const admin = makeAdmin({})
    const { ctx } = await buildEchoContext({
      admin,
      page: { ...PAGE_FORM, kind: 'catalog' },
      parsed: {
        outcome: 'checked_out',
        data: {
          customer: { name: 'Ana', phone: '+1', email: '', notes: 'asap' },
        },
      },
      catalogOrder: null,
      leadId: null,
      threadId: null,
      psid: null,
      fbPageId: null,
    })
    expect((ctx as { customer: Record<string, string> }).customer).toEqual({
      name: 'Ana',
      phone: '+1',
      email: '',
      notes: 'asap',
    })
  })

  it('builds order.* from catalogOrder', async () => {
    const admin = makeAdmin({})
    const { ctx } = await buildEchoContext({
      admin,
      page: { ...PAGE_FORM, kind: 'catalog' },
      parsed: { outcome: 'checked_out', data: {} },
      catalogOrder: {
        orderId: 'o1',
        currency: 'PHP',
        subtotal: 3700,
        customer: { name: null, phone: null, email: null, notes: null },
        customFields: {},
        paymentStatus: 'unpaid',
        lines: [
          { business_item_id: 'b1', title_snapshot: 'Heavy Duty Helmet', quantity: 1, unit_amount: 2500, line_total_amount: 2500, currency: 'PHP' },
          { business_item_id: 'b2', title_snapshot: 'Flashlight', quantity: 4, unit_amount: 300, line_total_amount: 1200, currency: 'PHP' },
        ],
      },
      leadId: null,
      threadId: null,
      psid: null,
      fbPageId: null,
    })
    const order = (ctx as { order: Record<string, unknown> }).order
    expect(order.items).toBe('1x Heavy Duty Helmet, 4x Flashlight')
    expect(order.items_lines).toContain('• 1x Heavy Duty Helmet')
    expect(order.items_lines).toContain('• 4x Flashlight')
    expect(order.subtotal).toMatch(/₱3,700/)
    expect(order.total).toMatch(/₱3,700/)
    expect(order.currency).toBe('PHP')
    expect(order.count).toBe('5')
  })

  it('builds booking.* using the page timezone', async () => {
    const admin = makeAdmin({})
    const { ctx } = await buildEchoContext({
      admin,
      page: {
        ...PAGE_FORM,
        kind: 'booking',
        config: { appointment: { timezone: 'Asia/Manila', duration_min: 30 } },
      },
      parsed: {
        outcome: 'booked',
        data: { slot_iso: '2026-05-28T06:30:00Z', fields: {} },
      },
      leadId: null,
      threadId: null,
      psid: null,
      fbPageId: null,
    })
    const booking = (ctx as { booking: Record<string, string> }).booking
    expect(booking.date).toMatch(/May 28, 2026/)
    expect(booking.time).toMatch(/2:30/)
    expect(booking.datetime).toContain('at')
    expect(booking.duration).toBe('30 min')
  })

  it('exposes custom.* keys from page config', async () => {
    const admin = makeAdmin({})
    const { ctx, known, customKeys } = await buildEchoContext({
      admin,
      page: {
        ...PAGE_FORM,
        kind: 'catalog',
        config: {
          checkout_fields: [
            { key: 'address', label: 'Address', type: 'long_text' },
            { key: 'gift_note', label: 'Gift', type: 'short_text' },
          ],
        },
      },
      parsed: {
        outcome: 'checked_out',
        data: { customer: { custom: { address: '123 Main', gift_note: 'Happy bday' } } },
      },
      catalogOrder: null,
      leadId: null,
      threadId: null,
      psid: null,
      fbPageId: null,
    })
    expect(customKeys).toEqual(['address', 'gift_note'])
    expect(known.has('custom.address')).toBe(true)
    expect((ctx as { custom: Record<string, string> }).custom.address).toBe('123 Main')
  })

  it('produces empty strings for unresolvable lookups but does not throw', async () => {
    const admin = makeAdmin({})
    const { ctx } = await buildEchoContext({
      admin,
      page: PAGE_FORM,
      parsed: { outcome: 'submitted', data: {} },
      leadId: null,
      threadId: null,
      psid: null,
      fbPageId: null,
    })
    expect((ctx as { fb: { name: string } }).fb.name).toBe('')
    expect((ctx as { lead: { name: string } }).lead.name).toBe('')
  })
})
```

- [ ] **Step 2: Run tests, expect fail**

Run: `npx vitest src/lib/action-pages/echo/context.test.ts --run`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/action-pages/echo/context.ts
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ActionPageKind } from '@/lib/action-pages/kinds'
import type { ParsedSubmission } from '@/lib/action-pages/dispatch'
import {
  formatCurrency,
  formatDateInTz,
  formatDateTimeInTz,
  formatDurationMinutes,
  formatTimeInTz,
} from './format'
import { knownPathsForKind } from './variables'

type AdminClient = ReturnType<typeof createAdminClient>

export interface CatalogOrderLine {
  business_item_id: string
  title_snapshot: string
  quantity: number
  unit_amount: number
  line_total_amount: number
  currency: string
}

export interface CatalogOrderForContext {
  orderId: string
  lines: CatalogOrderLine[]
  subtotal: number
  currency: string
  customer: { name: string | null; phone: string | null; email: string | null; notes: string | null }
  customFields: Record<string, string>
  paymentStatus: 'unpaid' | 'pending' | 'paid'
}

export interface EchoPageRecord {
  id: string
  user_id: string
  kind: ActionPageKind
  slug: string
  config: Record<string, unknown>
  title?: string
  notification_template: { text?: string; echo_payment_proof?: boolean } | null
}

export interface BuildEchoContextArgs {
  admin: AdminClient
  page: EchoPageRecord
  parsed: ParsedSubmission
  catalogOrder?: CatalogOrderForContext | null
  leadId: string | null
  threadId: string | null
  psid: string | null
  fbPageId: string | null
}

export interface EchoContextResult {
  ctx: Record<string, unknown>
  known: Set<string>
  customKeys: string[]
}

const KINDS_WITH_CUSTOM: ReadonlySet<ActionPageKind> = new Set(['catalog', 'booking', 'realestate'])
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')

export async function buildEchoContext(args: BuildEchoContextArgs): Promise<EchoContextResult> {
  const { admin, page, parsed, catalogOrder, leadId, threadId } = args

  const [lead, thread, paymentMethod] = await Promise.all([
    leadId ? loadLead(admin, leadId) : Promise.resolve(null),
    threadId ? loadThread(admin, threadId) : Promise.resolve(null),
    loadPaymentMethodFromParsed(admin, parsed),
  ])

  const customKeys = extractCustomKeys(page)
  const known = knownPathsForKind(page.kind, customKeys)

  const data = parsed.data as Record<string, unknown>
  const customerRaw = (data.customer as Record<string, unknown> | undefined) ?? {}
  const customer = {
    name: stringOrEmpty(customerRaw.name),
    phone: stringOrEmpty(customerRaw.phone),
    email: stringOrEmpty(customerRaw.email),
    notes: stringOrEmpty(customerRaw.notes),
  }

  const customMap: Record<string, string> = {}
  if (KINDS_WITH_CUSTOM.has(page.kind)) {
    const rawCustom = (customerRaw.custom as Record<string, unknown> | undefined) ?? {}
    const topLevel = (data.custom as Record<string, unknown> | undefined) ?? {}
    for (const key of customKeys) {
      const value = rawCustom[key] ?? topLevel[key]
      customMap[key] = stringOrEmpty(value)
    }
  }

  const ctx: Record<string, unknown> = {
    fb: { name: thread?.full_name ?? '' },
    lead: {
      name: lead?.name ?? '',
      phone: lead?.phone ?? '',
      email: lead?.email ?? '',
    },
    customer,
    page: {
      title: page.title ?? '',
      url: APP_URL ? `${APP_URL}/a/${page.slug}` : '',
    },
  }
  if (KINDS_WITH_CUSTOM.has(page.kind)) ctx.custom = customMap

  if (page.kind === 'booking') {
    const tz = pickBookingTimezone(page)
    const slotIso = stringOrEmpty(data.slot_iso)
    ctx.booking = {
      date: formatDateInTz(slotIso, tz),
      time: formatTimeInTz(slotIso, tz),
      datetime: formatDateTimeInTz(slotIso, tz),
      duration: formatDurationMinutes(pickBookingDuration(page)),
    }
  }

  if (page.kind === 'catalog' && catalogOrder) {
    const currency = catalogOrder.currency
    ctx.order = {
      items: catalogOrder.lines.map((l) => `${l.quantity}x ${l.title_snapshot}`).join(', '),
      items_lines: catalogOrder.lines
        .map((l) => `• ${l.quantity}x ${l.title_snapshot} — ${formatCurrency(l.line_total_amount, l.currency)}`)
        .join('\n'),
      subtotal: formatCurrency(catalogOrder.subtotal, currency),
      total: formatCurrency(catalogOrder.subtotal, currency),
      currency,
      count: String(catalogOrder.lines.reduce((s, l) => s + l.quantity, 0)),
    }
  }

  if (page.kind === 'sales') {
    const product = ((page.config.product as Record<string, unknown> | undefined) ?? {}).name
    const priceRaw = ((page.config.price as Record<string, unknown> | undefined) ?? {}).amount
    const currencyRaw = ((page.config.price as Record<string, unknown> | undefined) ?? {}).currency ?? 'PHP'
    ctx.sales = {
      product: stringOrEmpty(product),
      price: formatCurrency(toNumber(priceRaw), String(currencyRaw)),
    }
  }

  if (page.kind === 'realestate') {
    const addressRaw = (page.config.address as Record<string, unknown> | undefined) ?? {}
    const priceRaw = ((page.config.price as Record<string, unknown> | undefined) ?? {}).amount
    const currencyRaw = ((page.config.price as Record<string, unknown> | undefined) ?? {}).currency ?? 'PHP'
    ctx.property = {
      title: stringOrEmpty(page.title),
      price: formatCurrency(toNumber(priceRaw), String(currencyRaw)),
      address: composeAddress(addressRaw),
      unit_title: stringOrEmpty(data.source_property_unit_title),
    }
  }

  if (page.kind === 'catalog' || page.kind === 'sales') {
    const amount = toNumber(data.payment_amount)
    const currency = catalogOrder?.currency ?? 'PHP'
    ctx.payment = {
      method: paymentMethod?.label ?? '',
      amount: formatCurrency(amount, currency),
      note: stringOrEmpty(data.payment_note),
    }
  }

  return { ctx, known, customKeys }
}

async function loadLead(admin: AdminClient, leadId: string) {
  const { data } = await admin
    .from('leads')
    .select('id, name, email, phone')
    .eq('id', leadId)
    .maybeSingle<{ id: string; name: string | null; email: string | null; phone: string | null }>()
  return data
}

async function loadThread(admin: AdminClient, threadId: string) {
  const { data } = await admin
    .from('messenger_threads')
    .select('id, full_name')
    .eq('id', threadId)
    .maybeSingle<{ id: string; full_name: string | null }>()
  return data
}

async function loadPaymentMethodFromParsed(admin: AdminClient, parsed: ParsedSubmission) {
  const id = (parsed.data as Record<string, unknown>).payment_method_id
  if (typeof id !== 'string' || !id) return null
  const { data } = await admin
    .from('payment_methods')
    .select('id, label')
    .eq('id', id)
    .maybeSingle<{ id: string; label: string }>()
  return data
}

function extractCustomKeys(page: EchoPageRecord): string[] {
  if (page.kind === 'catalog') {
    const fields = (page.config.checkout_fields as Array<Record<string, unknown>> | undefined) ?? []
    return fields
      .map((f) => (typeof f.key === 'string' ? f.key : ''))
      .filter((k) => k.length > 0)
  }
  if (page.kind === 'booking') {
    const form = (page.config.form as Record<string, unknown> | undefined) ?? {}
    const fields = (form.fields as Array<Record<string, unknown>> | undefined) ?? []
    return fields
      .map((f) => (typeof f.key === 'string' ? f.key : ''))
      .filter((k) => k.length > 0)
  }
  return []
}

function pickBookingTimezone(page: EchoPageRecord): string {
  const appt = page.config.appointment as Record<string, unknown> | undefined
  const tz = appt && typeof appt.timezone === 'string' ? appt.timezone : 'Asia/Manila'
  return tz
}

function pickBookingDuration(page: EchoPageRecord): number | null {
  const appt = page.config.appointment as Record<string, unknown> | undefined
  if (!appt) return null
  const d = appt.duration_min
  return typeof d === 'number' ? d : null
}

function composeAddress(raw: Record<string, unknown>): string {
  const parts = ['line1', 'line2', 'city', 'region', 'postal', 'country']
    .map((k) => raw[k])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  return parts.join(', ')
}

function stringOrEmpty(v: unknown): string {
  if (v === undefined || v === null) return ''
  return String(v)
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
```

```ts
// src/lib/action-pages/echo/index.ts
export { renderEchoTemplate, type RenderResult, type RenderWarning } from './render'
export { VARIABLES_BY_KIND, knownPathsForKind, sampleContextForKind, type VariableDef } from './variables'
export { buildEchoContext, type EchoPageRecord, type CatalogOrderForContext } from './context'
export {
  formatCurrency,
  formatDateInTz,
  formatTimeInTz,
  formatDateTimeInTz,
  formatDurationMinutes,
} from './format'
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest src/lib/action-pages/echo/context.test.ts --run`
Expected: PASS.

- [ ] **Step 5: Run all echo module tests together**

Run: `npx vitest src/lib/action-pages/echo --run`
Expected: PASS for render, format, variables, context.

- [ ] **Step 6: Commit**

```bash
git add src/lib/action-pages/echo/context.ts src/lib/action-pages/echo/context.test.ts src/lib/action-pages/echo/index.ts
git commit -m "feat(echo): context builder + barrel exports"
```

---

## Task 5: Backfill migration for existing catalog pages

**Files:**
- Create: `supabase/migrations/20260525000000_action_pages_echo_templates_backfill.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260525000000_action_pages_echo_templates_backfill.sql
-- Templated echo migration: convert existing catalog notification_template.text
-- to the templated equivalent of the legacy buildOrderEcho() output, and set
-- a default echo_payment_proof flag where a payment method is configured.
--
-- Idempotent: skips catalog rows whose text already references {{order.

begin;

with catalog_rows as (
  select id, notification_template
  from public.action_pages
  where kind = 'catalog'
    and (notification_template is null
         or coalesce(notification_template->>'text', '') not like '%{{order.%')
)
update public.action_pages ap
set notification_template = jsonb_build_object(
  'text',
    'Order received!' || E'\n' ||
    '{{order.items_lines}}' || E'\n\n' ||
    'Total: {{order.total}}' ||
    case
      when length(coalesce(ap.notification_template->>'text', '')) > 0
        then E'\n\n' || (ap.notification_template->>'text')
      else ''
    end,
  'echo_payment_proof', coalesce((ap.notification_template->>'echo_payment_proof')::boolean, true)
)
from catalog_rows c
where ap.id = c.id;

-- Ensure echo_payment_proof defaults to true for any catalog/sales row that
-- doesn't have it set explicitly. (No text rewrite for sales — its template
-- doesn't change in this migration.)
update public.action_pages
set notification_template = jsonb_set(
  coalesce(notification_template, '{}'::jsonb),
  '{echo_payment_proof}',
  'true',
  true
)
where kind in ('catalog', 'sales')
  and (notification_template is null or notification_template->'echo_payment_proof' is null);

commit;
```

- [ ] **Step 2: Verify the migration parses**

Run: `npx supabase db reset` (or your project's migration verification command — confirm in `package.json` first if uncertain).
Expected: migration applies without error against a freshly-reset local DB.

If the project doesn't have a local DB convenience: read the migration aloud, run `pg_lint` / `sqlfluff` if available, or at minimum verify the `psql` parser accepts it.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525000000_action_pages_echo_templates_backfill.sql
git commit -m "chore(db): backfill catalog echo templates + echo_payment_proof default"
```

---

## Task 6: Submit-route swap — render template, delete buildOrderEcho

**Files:**
- Modify: `src/app/api/action-pages/submit/route.ts`
- Modify: `src/app/api/action-pages/submit/route.test.ts`

- [ ] **Step 1: Add a failing test for the templated catalog echo**

Open `src/app/api/action-pages/submit/route.test.ts` and add a new test alongside the existing catalog tests. Use the existing `makeAdminMock()` and `makeJsonRequest()` factories (mirror the patterns in nearby tests). The test should:

```ts
it('renders the templated catalog echo with order + customer placeholders', async () => {
  // Configure an action page row with kind=catalog and a templated notification_template.text:
  //   'Order received!\n{{order.items_lines}}\n\nTotal: {{order.total}}\nThanks {{customer.name}}!'
  // Configure parsed submission to include 2 items.
  // Mock the messenger send and assert sendOutbound was called with payload.text matching:
  //   /Order received!\n• 2x Widget — ₱.+\n• 1x Sprocket — ₱.+\n\nTotal: ₱.+\nThanks Ana!/

  // POST the submission, await response, then:
  expect(mocks.sendOutbound).toHaveBeenCalledWith(
    expect.objectContaining({
      payload: expect.objectContaining({
        kind: 'text',
        text: expect.stringMatching(/^Order received!/),
      }),
    }),
  )
})
```

If the existing test file does not yet stub `payment_methods` table lookups, extend `makeAdminMock()` to return `{ data: null, error: null }` for `payment_methods`. Same pattern as the existing `messenger_threads` stub.

- [ ] **Step 2: Run the test, expect fail**

Run: `npx vitest src/app/api/action-pages/submit/route.test.ts --run`
Expected: FAIL — current `buildOrderEcho` output starts with `Order received!\n• ...` but doesn't honor the templated `Thanks {{customer.name}}!` line because it appends the *raw* text. The new test will fail on that assertion.

- [ ] **Step 3: Refactor the submit-route echo block**

Open `src/app/api/action-pages/submit/route.ts`. Locate the block that begins at the comment `// Echo back to Messenger. For catalog orders, prepend an order summary.` (around line 675). Replace the resolution of `echo` and keep the existing send block.

Find and replace these lines:

```ts
const echo = catalogOrderResult
  ? buildOrderEcho(catalogOrderResult, notifyText)
  : notifyText
```

with:

```ts
const echoTemplate =
  (outcomeAction?.messenger_text && outcomeAction.messenger_text.trim()) ||
  (matchedRule?.notify_text && matchedRule.notify_text.trim()) ||
  page.notification_template?.text ||
  ''

const echoContext = echoTemplate
  ? await buildEchoContext({
      admin,
      page: {
        id: page.id,
        user_id: page.user_id,
        kind: page.kind as ActionPageKind,
        slug: page.slug,
        config: page.config,
        notification_template: page.notification_template,
      },
      parsed: parsed,
      catalogOrder: catalogOrderResult,
      leadId,
      threadId: messengerThreadId,
      psid,
      fbPageId,
    })
  : null

const echo = echoTemplate && echoContext
  ? renderEchoTemplate(echoTemplate, echoContext.ctx, echoContext.known).text.slice(0, 1900)
  : ''
```

Also add these imports at the top of the file:

```ts
import { renderEchoTemplate } from '@/lib/action-pages/echo/render'
import { buildEchoContext } from '@/lib/action-pages/echo/context'
```

Delete the `buildOrderEcho` function (lines ~843–862) — the renderer + context now handle it.

- [ ] **Step 4: Re-run tests, fix until green**

Run: `npx vitest src/app/api/action-pages/submit/route.test.ts --run`
Expected: PASS — existing tests and the new templated case both pass. If an existing catalog test relied on the legacy customer block (`Name: ... Phone: ...`), update it to use a templated equivalent in the page setup. The legacy block is intentionally dropped.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/action-pages/submit/route.ts src/app/api/action-pages/submit/route.test.ts
git commit -m "refactor(submit): render echoes via templated engine, drop buildOrderEcho"
```

---

## Task 7: Payment-proof image follow-up

**Files:**
- Modify: `src/app/api/action-pages/submit/route.ts`
- Modify: `src/app/api/action-pages/submit/route.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `route.test.ts`:

```ts
it('sends the payment proof image after the text echo when echo_payment_proof is true', async () => {
  // Page kind = 'catalog', notification_template = { text: 'Got it', echo_payment_proof: true }.
  // Parsed submission includes payment_proof_url = 'https://cdn.test/proof.jpg'.
  // POST and assert sendOutbound was called twice — once with kind 'text', once with kind 'image' for the proof URL.

  const imageCalls = mocks.sendOutbound.mock.calls.filter(
    ([arg]) => (arg as { payload: { kind: string } }).payload.kind === 'image',
  )
  expect(imageCalls).toHaveLength(1)
  expect((imageCalls[0][0] as { payload: { imageUrl: string } }).payload.imageUrl).toBe(
    'https://cdn.test/proof.jpg',
  )
})

it('does not send the payment proof when echo_payment_proof is false', async () => {
  // Same as above but notification_template = { text: 'Got it', echo_payment_proof: false }.
  const imageCalls = mocks.sendOutbound.mock.calls.filter(
    ([arg]) => (arg as { payload: { kind: string } }).payload.kind === 'image',
  )
  expect(imageCalls).toHaveLength(0)
})

it('does not send the payment proof for non-catalog/sales kinds', async () => {
  // Page kind = 'booking', notification_template = { text: 'Booked', echo_payment_proof: true }.
  // Parsed submission with payment_proof_url should NOT trigger an image send.
  const imageCalls = mocks.sendOutbound.mock.calls.filter(
    ([arg]) => (arg as { payload: { kind: string } }).payload.kind === 'image',
  )
  expect(imageCalls).toHaveLength(0)
})
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest src/app/api/action-pages/submit/route.test.ts --run`
Expected: FAIL — no image send wired yet.

- [ ] **Step 3: Add the follow-up send**

After the existing text-echo send block in `route.ts` (right after the `if (echo && psid && fbPageId && messengerThreadId)` block ends, before the `outcomeAction?.attach_action_page_id` block), insert:

```ts
const proofUrl =
  (page.kind === 'catalog' || page.kind === 'sales')
    ? pickProofUrl(parsed.data)
    : null
const proofEnabled = page.notification_template?.echo_payment_proof !== false
if (
  proofUrl &&
  proofEnabled &&
  echo &&
  psid &&
  fbPageId &&
  messengerThreadId &&
  messengerPageData?.page_access_token
) {
  try {
    const token = decryptToken(messengerPageData.page_access_token)
    const result = await sendOutbound({
      admin,
      thread: {
        id: messengerThreadId,
        psid,
        last_inbound_at: messengerThreadData?.last_inbound_at ?? null,
      },
      pageToken: token,
      payload: { kind: 'image', imageUrl: proofUrl },
      kind: 'submission_echo',
    })
    if (result.sent) {
      await admin.from('messenger_messages').insert({
        thread_id: messengerThreadId,
        user_id: page.user_id,
        direction: 'outbound',
        sender: 'bot',
        fb_message_id: result.messageId,
        body: '[image] payment proof',
      })
    }
  } catch (e) {
    console.warn('[action-pages.submit] payment proof echo failed', {
      psid,
      err: e instanceof Error ? e.message : String(e),
    })
  }
}
```

Add the helper at the bottom of the file (next to the deleted `buildOrderEcho` slot):

```ts
function pickProofUrl(data: Record<string, unknown>): string | null {
  const url = data.payment_proof_url
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null
  return url
}
```

Update the local `notification_template` type in `ActionPageRecord`:

```ts
notification_template: { text?: string; echo_payment_proof?: boolean } | null
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest src/app/api/action-pages/submit/route.test.ts --run`
Expected: PASS — all three new cases plus existing ones.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/action-pages/submit/route.ts src/app/api/action-pages/submit/route.test.ts
git commit -m "feat(submit): re-echo payment proof image for catalog/sales (opt-out)"
```

---

## Task 8: Schema + crud — persist `echo_payment_proof`

**Files:**
- Modify: `src/app/(app)/dashboard/action-pages/_lib/schemas.ts`
- Modify: `src/app/(app)/dashboard/action-pages/_lib/queries.ts`
- Modify: `src/app/(app)/dashboard/action-pages/actions/crud.ts`

- [ ] **Step 1: Extend the zod schema**

Open `src/app/(app)/dashboard/action-pages/_lib/schemas.ts`. Replace the `notification_template` definition (lines ~44–49) with:

```ts
notification_template: z
  .object({
    text: z.string().max(640).optional(),
    echo_payment_proof: z.boolean().optional(),
  })
  .nullable()
  .optional(),
```

- [ ] **Step 2: Extend the row type**

Open `src/app/(app)/dashboard/action-pages/_lib/queries.ts`. Update the row interface where `notification_template` is declared (around line 16):

```ts
notification_template: { text?: string; echo_payment_proof?: boolean } | null
```

- [ ] **Step 3: Persist the flag in crud**

Open `src/app/(app)/dashboard/action-pages/actions/crud.ts`. Right after the existing line:

```ts
const notificationText = String(formData.get('notification_text') ?? '').trim()
```

(around line 106), add:

```ts
const echoPaymentProofRaw = formData.get('echo_payment_proof')
const echoPaymentProof =
  echoPaymentProofRaw === null
    ? undefined
    : echoPaymentProofRaw === 'on' || echoPaymentProofRaw === 'true'
```

Then replace line 130:

```ts
notification_template: notificationText ? { text: notificationText } : null,
```

with:

```ts
notification_template:
  notificationText || echoPaymentProof !== undefined
    ? {
        ...(notificationText ? { text: notificationText } : {}),
        ...(echoPaymentProof !== undefined ? { echo_payment_proof: echoPaymentProof } : {}),
      }
    : null,
```

Line 164 (`notification_template: parsed.data.notification_template ?? null,`) needs no change — the zod schema already accepts the new shape after Task 8 Step 1.

- [ ] **Step 4: Sanity check**

Run: `npx vitest src/app/\(app\)/dashboard/action-pages --run` (escape parens if your shell needs it).
Expected: any existing crud tests still pass. If none exist, run `npx tsc --noEmit` for the workspace.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/_lib/schemas.ts src/app/\(app\)/dashboard/action-pages/_lib/queries.ts src/app/\(app\)/dashboard/action-pages/actions/crud.ts
git commit -m "feat(action-pages): persist echo_payment_proof toggle"
```

---

## Task 9: Preview server action

**Files:**
- Create: `src/app/(app)/dashboard/action-pages/actions/preview-echo.ts`

- [ ] **Step 1: Implement**

```ts
// src/app/(app)/dashboard/action-pages/actions/preview-echo.ts
'use server'

import { z } from 'zod'
import { isActionPageKind } from '@/lib/action-pages/kinds'
import { renderEchoTemplate } from '@/lib/action-pages/echo/render'
import { knownPathsForKind, sampleContextForKind } from '@/lib/action-pages/echo/variables'

const Input = z.object({
  kind: z.string(),
  template: z.string().max(640),
  customKeys: z.array(z.string()).max(40).default([]),
})

export interface PreviewEchoResult {
  text: string
  warnings: { token: string; reason: 'unknown' | 'malformed' }[]
}

export async function previewEcho(input: unknown): Promise<PreviewEchoResult> {
  const parsed = Input.parse(input)
  if (!isActionPageKind(parsed.kind)) {
    return { text: '', warnings: [{ token: parsed.kind, reason: 'unknown' }] }
  }
  const known = knownPathsForKind(parsed.kind, parsed.customKeys)
  const ctx = sampleContextForKind(parsed.kind, parsed.customKeys)
  const { text, warnings } = renderEchoTemplate(parsed.template, ctx, known)
  return { text, warnings }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/actions/preview-echo.ts
git commit -m "feat(action-pages): server action for echo template preview"
```

---

## Task 10: `EchoTemplateField` shared component

**Files:**
- Create: `src/app/(app)/dashboard/action-pages/_components/EchoTemplateField.tsx`
- Create: `src/app/(app)/dashboard/action-pages/_components/EchoTemplateField.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// src/app/(app)/dashboard/action-pages/_components/EchoTemplateField.test.tsx
import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EchoTemplateField } from './EchoTemplateField'

describe('EchoTemplateField', () => {
  it('renders the textarea with the default value', () => {
    render(
      <EchoTemplateField
        name="notification_text"
        kind="booking"
        customKeys={[]}
        defaultValue="Hi {{fb.name}}!"
        rows={3}
      />,
    )
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(ta.value).toBe('Hi {{fb.name}}!')
    expect(ta.name).toBe('notification_text')
  })

  it('inserts the picked variable at the cursor position', () => {
    render(
      <EchoTemplateField
        name="notification_text"
        kind="booking"
        customKeys={[]}
        defaultValue="Hi !"
        rows={3}
      />,
    )
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    ta.focus()
    ta.setSelectionRange(3, 3)
    fireEvent.click(screen.getByRole('button', { name: /Facebook profile name/i }))
    expect(ta.value).toBe('Hi {{fb.name}}!')
  })

  it('renders the live preview using sample data', () => {
    render(
      <EchoTemplateField
        name="notification_text"
        kind="booking"
        customKeys={[]}
        defaultValue="Hi {{fb.name || customer.name}}!"
        rows={3}
      />,
    )
    expect(screen.getByTestId('echo-preview').textContent).toContain('Hi Maria Santos!')
  })

  it('flags unknown tokens with a warning', () => {
    render(
      <EchoTemplateField
        name="notification_text"
        kind="booking"
        customKeys={[]}
        defaultValue="Hi {{customer.adress}}!"
        rows={3}
      />,
    )
    expect(screen.getByTestId('echo-warnings').textContent).toMatch(/customer\.adress/)
  })

  it('collapses picker behind a button in compact mode', () => {
    render(
      <EchoTemplateField
        name="notify_text"
        kind="booking"
        customKeys={[]}
        defaultValue=""
        rows={2}
        compact
      />,
    )
    expect(screen.queryByRole('button', { name: /Facebook profile name/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /insert variable/i }))
    expect(screen.getByRole('button', { name: /Facebook profile name/i })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests, expect fail**

Run: `npx vitest src/app/\(app\)/dashboard/action-pages/_components/EchoTemplateField.test.tsx --run`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the component**

```tsx
// src/app/(app)/dashboard/action-pages/_components/EchoTemplateField.tsx
'use client'

import { useMemo, useRef, useState } from 'react'
import { renderEchoTemplate } from '@/lib/action-pages/echo/render'
import { knownPathsForKind, sampleContextForKind, VARIABLES_BY_KIND } from '@/lib/action-pages/echo/variables'
import type { ActionPageKind } from '@/lib/action-pages/kinds'

export interface EchoTemplateFieldProps {
  name: string
  kind: ActionPageKind
  customKeys: readonly string[]
  defaultValue: string
  rows?: number
  compact?: boolean
  maxLength?: number
  placeholder?: string
}

export function EchoTemplateField(props: EchoTemplateFieldProps) {
  const {
    name,
    kind,
    customKeys,
    defaultValue,
    rows = 3,
    compact = false,
    maxLength = 640,
    placeholder,
  } = props
  const [text, setText] = useState(defaultValue)
  const [pickerOpen, setPickerOpen] = useState(!compact)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const variables = VARIABLES_BY_KIND[kind]
  const groups = useMemo(() => {
    const map = new Map<string, typeof variables>()
    for (const v of variables) {
      const list = map.get(v.group) ?? []
      list.push(v)
      map.set(v.group, list)
    }
    if (customKeys.length > 0) {
      map.set(
        'Custom',
        customKeys.map((k) => ({
          path: `custom.${k}`,
          label: `Custom: ${k}`,
          sample: `[${k} sample]`,
          group: 'Custom',
        })),
      )
    }
    return Array.from(map.entries())
  }, [variables, customKeys])

  const preview = useMemo(() => {
    const known = knownPathsForKind(kind, customKeys)
    const ctx = sampleContextForKind(kind, customKeys)
    return renderEchoTemplate(text, ctx, known)
  }, [text, kind, customKeys])

  function insertAtCursor(token: string) {
    const ta = taRef.current
    if (!ta) return
    const start = ta.selectionStart ?? text.length
    const end = ta.selectionEnd ?? text.length
    const insertion = `{{${token}}}`
    const next = text.slice(0, start) + insertion + text.slice(end)
    setText(next)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + insertion.length
      ta.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className={compact ? 'space-y-2' : 'grid gap-4 md:grid-cols-[1fr_220px]'}>
      <div>
        <textarea
          ref={taRef}
          name={name}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          className="ap-textarea"
        />
        <div data-testid="echo-preview" className="mt-3 text-[13px]">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
            Preview (sample data)
          </div>
          <div className="inline-block max-w-full rounded-2xl bg-[#F0F2F5] px-3 py-2 text-[#050505] whitespace-pre-wrap">
            {preview.text || <span className="text-[#9CA3AF]">Empty</span>}
          </div>
        </div>
        {preview.warnings.length > 0 && (
          <div
            data-testid="echo-warnings"
            className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900"
          >
            <div className="font-semibold">Unknown or malformed tokens:</div>
            <ul className="mt-1 list-disc pl-5">
              {preview.warnings.map((w, i) => (
                <li key={i}>
                  <code>{w.token || '(empty)'}</code> — {w.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {compact && !pickerOpen && (
        <div>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="rounded border border-[#E5E7EB] bg-white px-2 py-1 text-[12px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
          >
            Insert variable
          </button>
        </div>
      )}
      {(!compact || pickerOpen) && (
        <div className={compact ? 'rounded border border-[#E5E7EB] bg-[#FAFAFA] p-2 text-[12px]' : 'rounded border border-[#E5E7EB] bg-[#FAFAFA] p-3 text-[12px]'}>
          <div className="mb-2 font-semibold text-[#111827]">Variables</div>
          {groups.map(([group, items]) => (
            <div key={group} className="mb-2">
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
                {group}
              </div>
              {items.map((v) => (
                <button
                  key={v.path}
                  type="button"
                  aria-label={v.label}
                  onClick={() => insertAtCursor(v.path)}
                  className="block w-full rounded px-1 py-0.5 text-left hover:bg-white"
                >
                  <code>{`{{${v.path}}}`}</code>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests, fix until green**

Run: `npx vitest src/app/\(app\)/dashboard/action-pages/_components/EchoTemplateField.test.tsx --run`
Expected: PASS for all five cases.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/_components/EchoTemplateField.tsx src/app/\(app\)/dashboard/action-pages/_components/EchoTemplateField.test.tsx
git commit -m "feat(action-pages): EchoTemplateField with picker + live preview"
```

---

## Task 11: Wire `EchoTemplateField` into the global page editor

**Files:**
- Modify: `src/app/(app)/dashboard/action-pages/_components/EditActionPageShell.tsx`

- [ ] **Step 1: Replace the existing textarea**

Open the file. Locate the section at lines ~320–338 (the `Messenger echo` section). Replace the contents of `<div className="ap-section-body">...</div>` with:

```tsx
<EchoTemplateField
  name="notification_text"
  kind={page.kind}
  customKeys={extractCustomKeysFromConfig(page.kind, page.config)}
  defaultValue={page.notification_template?.text ?? ''}
  rows={3}
  placeholder="Thanks! We got your details and will be in touch shortly."
/>
{(page.kind === 'catalog' || page.kind === 'sales') && (
  <label className="mt-3 flex items-center gap-2 text-[13px] text-[#374151]">
    <input
      type="checkbox"
      name="echo_payment_proof"
      defaultChecked={page.notification_template?.echo_payment_proof !== false}
    />
    Also re-echo the uploaded payment screenshot in Messenger
  </label>
)}
```

Add the import at the top:

```tsx
import { EchoTemplateField } from './EchoTemplateField'
import { extractCustomKeysFromConfig } from '../_lib/custom-keys'
```

- [ ] **Step 2: Create the custom-keys helper**

```ts
// src/app/(app)/dashboard/action-pages/_lib/custom-keys.ts
import type { ActionPageKind } from '@/lib/action-pages/kinds'

export function extractCustomKeysFromConfig(
  kind: ActionPageKind,
  config: Record<string, unknown>,
): string[] {
  if (kind === 'catalog') {
    const fields = (config.checkout_fields as Array<Record<string, unknown>> | undefined) ?? []
    return fields.map((f) => (typeof f.key === 'string' ? f.key : '')).filter(Boolean)
  }
  if (kind === 'booking') {
    const form = (config.form as Record<string, unknown> | undefined) ?? {}
    const fields = (form.fields as Array<Record<string, unknown>> | undefined) ?? []
    return fields.map((f) => (typeof f.key === 'string' ? f.key : '')).filter(Boolean)
  }
  return []
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/_components/EditActionPageShell.tsx src/app/\(app\)/dashboard/action-pages/_lib/custom-keys.ts
git commit -m "feat(action-pages): use EchoTemplateField in the shared editor"
```

---

## Task 12: Wire `EchoTemplateField` into kind-specific shells

**Files:**
- Modify: `src/app/(app)/dashboard/action-pages/_kinds/catalog/CatalogShell.tsx`
- Modify: `src/app/(app)/dashboard/action-pages/_kinds/realestate/RealestateShell.tsx`

- [ ] **Step 1: Catalog — replace the inline textarea**

In `CatalogShell.tsx`, find the `notification_template` textarea around line 505 and replace it with:

```tsx
<EchoTemplateField
  name="notification_text"
  kind="catalog"
  customKeys={extractCustomKeysFromConfig('catalog', page.config)}
  defaultValue={page.notification_template?.text ?? ''}
  rows={6}
/>
<label className="mt-3 flex items-center gap-2 text-[13px] text-[#374151]">
  <input
    type="checkbox"
    name="echo_payment_proof"
    defaultChecked={page.notification_template?.echo_payment_proof !== false}
  />
  Also re-echo the uploaded payment screenshot in Messenger
</label>
```

Add imports at the top:

```tsx
import { EchoTemplateField } from '../../_components/EchoTemplateField'
import { extractCustomKeysFromConfig } from '../../_lib/custom-keys'
```

- [ ] **Step 2: Realestate — replace the inline textarea**

In `RealestateShell.tsx`, find the `notification_template` textarea around line 482 and replace it with:

```tsx
<EchoTemplateField
  name="notification_text"
  kind="realestate"
  customKeys={[]}
  defaultValue={page.notification_template?.text ?? ''}
  rows={4}
/>
```

Same imports as above.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/_kinds/catalog/CatalogShell.tsx src/app/\(app\)/dashboard/action-pages/_kinds/realestate/RealestateShell.tsx
git commit -m "feat(action-pages): use EchoTemplateField in catalog + realestate shells"
```

---

## Task 13: Wire compact `EchoTemplateField` into per-outcome editors

**Files:**
- Modify: `src/app/(app)/dashboard/action-pages/_components/PipelineRulesEditor.tsx`
- Modify: `src/app/(app)/dashboard/action-pages/_kinds/qualification/OutcomeCard.tsx`

- [ ] **Step 1: PipelineRulesEditor — swap the per-rule notify_text textarea**

Find the textarea around line 181–188:

```tsx
<textarea
  value={rule.notify_text ?? ''}
  onChange={(e) => update(i, { notify_text: e.target.value })}
  rows={2}
  maxLength={640}
  placeholder="Overrides the global Messenger echo when this outcome fires."
  className="w-full rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
/>
```

Replace with:

```tsx
<EchoTemplateField
  name={`pipeline_rule_notify_text__${i}`}
  kind={kind}
  customKeys={customKeys}
  defaultValue={rule.notify_text ?? ''}
  rows={2}
  compact
  placeholder="Overrides the global Messenger echo when this outcome fires."
/>
```

This component is currently uncontrolled — the parent reads values from form data on submit. The compact field is also uncontrolled (writes to `name`). We need `PipelineRulesEditor`'s parent to read those new form fields by name on submit. Check the surrounding form-data parsing in `actions/crud.ts` (around line 90–98 where it reads pipeline rules). The current parser reads from `parsed.pipeline_rules` which comes from the JSON-encoded array. Switching to a per-field form input changes the shape — instead, keep `EchoTemplateField` controlled-by-prop and surface its current value back via an `onChange` callback:

Add `onChange?: (v: string) => void` to `EchoTemplateFieldProps`, and call it inside `setText`. Then in `PipelineRulesEditor`:

```tsx
<EchoTemplateField
  name={`pipeline_rule_notify_text__${i}`}
  kind={kind}
  customKeys={customKeys}
  defaultValue={rule.notify_text ?? ''}
  rows={2}
  compact
  onChange={(v) => update(i, { notify_text: v })}
  placeholder="Overrides the global Messenger echo when this outcome fires."
/>
```

Update `EchoTemplateField` `setText` calls:

```tsx
const setTextAndNotify = (v: string) => {
  setText(v)
  props.onChange?.(v)
}
// replace setText(e.target.value) with setTextAndNotify(e.target.value)
// replace setText(next) (inside insertAtCursor) with setTextAndNotify(next)
```

Add `kind: ActionPageKind` and `customKeys: readonly string[]` to `PipelineRulesEditorProps` if not already there. Pull from the parent (`EditActionPageShell`) by passing `kind={page.kind}` and `customKeys={extractCustomKeysFromConfig(page.kind, page.config)}` into `<PipelineRulesEditor>`.

- [ ] **Step 2: Qualification OutcomeCard — same treatment**

In `OutcomeCard.tsx`, find the `messenger_text` textarea (line ~134):

```tsx
value={outcome.messenger_text}
onChange={(e) => onChange({ messenger_text: e.target.value })}
```

Replace the surrounding textarea with:

```tsx
<EchoTemplateField
  name={`qual_outcome_messenger_text__${outcome.id}`}
  kind="qualification"
  customKeys={[]}
  defaultValue={outcome.messenger_text ?? ''}
  rows={2}
  compact
  onChange={(v) => onChange({ messenger_text: v })}
/>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no type errors. If `EchoTemplateField` needs to be a re-rendering-on-defaultValue-change component, add a `key` prop on the parent side (`key={rule.id ?? i}`).

Run: `npx vitest src/app/\(app\)/dashboard/action-pages --run`
Expected: existing tests pass; component test still passes.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/_components/PipelineRulesEditor.tsx src/app/\(app\)/dashboard/action-pages/_kinds/qualification/OutcomeCard.tsx src/app/\(app\)/dashboard/action-pages/_components/EchoTemplateField.tsx
git commit -m "feat(action-pages): compact EchoTemplateField in per-outcome editors"
```

---

## Task 14: Update `KIND_REGISTRY` default templates

**Files:**
- Modify: `src/lib/action-pages/kinds.ts`

- [ ] **Step 1: Add a guard test**

Append to a new file `src/lib/action-pages/kinds.echo-defaults.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ACTION_PAGE_KINDS, KIND_REGISTRY } from './kinds'
import { knownPathsForKind, sampleContextForKind } from './echo/variables'
import { renderEchoTemplate } from './echo/render'

describe('KIND_REGISTRY default echo templates', () => {
  for (const kind of ACTION_PAGE_KINDS) {
    it(`renders ${kind}.defaultNotificationText without unknown-token warnings`, () => {
      const tpl = KIND_REGISTRY[kind].defaultNotificationText
      const known = knownPathsForKind(kind, [])
      const ctx = sampleContextForKind(kind, [])
      const result = renderEchoTemplate(tpl, ctx, known)
      expect(result.warnings).toEqual([])
      expect(result.text.length).toBeGreaterThan(0)
    })
  }
})
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest src/lib/action-pages/kinds.echo-defaults.test.ts --run`
Expected: FAIL — current defaults are static strings; some include nothing templated, which is fine. The test will probably PASS for non-templated defaults too — re-read the assertion. If it passes already, skip step 3 — the test is still a regression guard for future edits.

If FAIL, proceed to step 3.

- [ ] **Step 3: Replace `defaultNotificationText` in each kind entry**

In `src/lib/action-pages/kinds.ts`:

```ts
// form.defaultNotificationText
defaultNotificationText:
  'Thanks {{fb.name || customer.name || "there"}}! We got your details and will be in touch shortly.',

// booking.defaultNotificationText
defaultNotificationText:
  "Hi {{fb.name || customer.name || \"there\"}}, you're booked for {{booking.date}} at {{booking.time}}. We'll follow up shortly.",

// qualification.defaultNotificationText
defaultNotificationText:
  'Thanks {{fb.name || "there"}}! We\'ll review your answers and follow up shortly.',

// sales.defaultNotificationText
defaultNotificationText:
  'Thanks {{fb.name || customer.name || "there"}}! We got your details for {{sales.product}}. We\'ll be in touch shortly.',

// catalog.defaultNotificationText
defaultNotificationText:
  'Order received!\n{{order.items_lines}}\n\nTotal: {{order.total}}\nName: {{customer.name}}\nPhone: {{customer.phone}}\n\nThanks for your order — we\'ll confirm on Messenger shortly.',

// realestate.defaultNotificationText
defaultNotificationText:
  'Thanks for your interest in {{property.title}}! We\'ll reach out about this property shortly.',
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest src/lib/action-pages/kinds.echo-defaults.test.ts --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/action-pages/kinds.ts src/lib/action-pages/kinds.echo-defaults.test.ts
git commit -m "feat(action-pages): templated default echoes per kind"
```

---

## Task 15: End-to-end sanity + full suite

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest --run`
Expected: PASS, no skipped suites unexpectedly. Fix any regression with the smallest possible patch — most likely candidates: tests that asserted exact echo text including the legacy customer block (`Name: ... Phone: ...`) — update them to use templated equivalents.

- [ ] **Step 2: Type check the whole repo**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual UX smoke test (record what you ran)**

Start the dev server: `npm run dev` (or `pnpm dev`).

In the dashboard, open one of each kind (booking, catalog, sales, property) and confirm:
- The Messenger echo textarea shows the variable picker to its right.
- Clicking a variable inserts `{{path}}` at the cursor.
- The preview block below the textarea renders sample-substituted text.
- Editing `{{customer.adress}}` shows a yellow warning banner.
- Saving the page persists `notification_template.text` and (catalog/sales) `notification_template.echo_payment_proof` — confirm by reloading.

If a UI surface is broken, fix and re-run.

- [ ] **Step 4: Final commit (only if smoke-test fixes were needed)**

```bash
git add -p
git commit -m "fix(action-pages): smoke-test follow-ups for echo template editor"
```

---

## Self-review checklist (the implementer should run this at the end)

- [ ] Spec section "Decisions" Q1–Q7c — each maps to a task above.
- [ ] No `TODO`/`TBD`/`implement later` anywhere in the codebase touched by this plan.
- [ ] `renderEchoTemplate` is the only template renderer; preview action + editor + submit route all import from the same module.
- [ ] `VARIABLES_BY_KIND` is the only source of variable names; renderer's `known` set, editor's picker, and preview action's sample context all derive from it.
- [ ] Migration is idempotent — re-running on already-templated rows is a no-op.
- [ ] No new RLS policies, no schema changes beyond the JSONB extension and backfill.
- [ ] `buildOrderEcho` is fully removed from the codebase (`git grep buildOrderEcho` returns nothing).
