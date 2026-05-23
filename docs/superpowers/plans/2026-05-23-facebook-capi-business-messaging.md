# Facebook Conversions API (Business Messaging) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fire Meta Conversions API events from action-page submissions that originated through a Messenger thread, so Click-to-Messenger ad campaigns can optimize against real outcomes.

**Architecture:** A pure mapping module (`capi-mapping.ts`) and pure payload builders (`capi-payload.ts`) feed a thin dispatcher (`capi.ts`) that POSTs to `graph.facebook.com/v19.0/{dataset_id}/events`. The dispatcher is invoked fire-and-forget from `src/app/api/action-pages/submit/route.ts` after the existing stage-move and Messenger-echo blocks. Every attempt — success, skip, or error — writes a row to a new `capi_event_logs` table. Per-page configuration (dataset ID, encrypted access token, test event code, enable toggle) lives as new columns on `facebook_pages`; per-action-page event overrides live on `action_pages`.

**Tech Stack:** Next.js App Router (server actions), Supabase Postgres + RLS, Vitest, Node `crypto` (sha256 hashing + AES-256-GCM token encryption via existing `src/lib/facebook/crypto.ts`).

**Reference spec:** `docs/superpowers/specs/2026-05-22-facebook-capi-business-messaging-design.md`

**Test command (used throughout this plan):** `pnpm test -- <file-pattern>` (project uses `vitest run`; the package.json `test` script is `vitest run`).

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260606000000_facebook_capi.sql`

- [ ] **Step 1: Create the migration file**

Write the file with the full SQL below:

```sql
-- =========================================================================
-- Facebook Conversions API (Business Messaging) — per-page configuration,
-- per-action-page event override, and an append-only dispatch log.
--
-- All additions are nullable / defaulted so existing rows stay unchanged
-- until a user opts in from Settings → Facebook → Conversions API.
-- =========================================================================

alter table public.facebook_pages
  add column capi_enabled         boolean not null default false,
  add column capi_dataset_id      text,
  add column capi_access_token    text,
  add column capi_test_event_code text;

alter table public.facebook_pages
  add constraint facebook_pages_capi_complete_when_enabled
  check (
    capi_enabled = false
    or (capi_dataset_id is not null and capi_access_token is not null)
  );

alter table public.action_pages
  add column capi_event_name_override text
  check (capi_event_name_override is null or capi_event_name_override in (
    'Lead','Schedule','Purchase','InitiateCheckout',
    'CompleteRegistration','Contact','Subscribe',
    'SubmitApplication','AddToCart','ViewContent',
    'SKIP'
  ));

create table public.capi_event_logs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  page_id         uuid references public.facebook_pages(id) on delete set null,
  submission_id   uuid references public.action_page_submissions(id) on delete set null,
  action_page_id  uuid references public.action_pages(id) on delete set null,
  event_name      text,
  event_id        text not null,
  status          text not null check (status in ('sent','skipped','error')),
  skip_reason     text check (skip_reason is null or skip_reason in (
                    'no_messenger_context','disabled','not_configured','outcome_skip'
                  )),
  http_status     integer,
  fb_trace_id     text,
  request_payload jsonb,
  response_body   jsonb,
  error_message   text,
  created_at      timestamptz not null default now()
);

create index capi_event_logs_user_idx     on public.capi_event_logs (user_id, created_at desc);
create index capi_event_logs_page_idx     on public.capi_event_logs (page_id, created_at desc);
create index capi_event_logs_event_id_idx on public.capi_event_logs (event_id);

alter table public.capi_event_logs enable row level security;

create policy capi_event_logs_owner_read on public.capi_event_logs
  for select to authenticated using (user_id = auth.uid());

create policy capi_event_logs_admin_all on public.capi_event_logs
  for all to authenticated
  using (public.current_role() in ('admin','superadmin'))
  with check (public.current_role() in ('admin','superadmin'));
```

- [ ] **Step 2: Verify migration applies cleanly**

Run: `pnpm supabase db reset` (or whichever local migration command the project uses — check `README.md` if unsure).

Expected: migration applies without errors. If the project uses a different command (e.g. `supabase migration up`), use that.

- [ ] **Step 3: Spot-check the schema via psql**

Run: `psql "$DATABASE_URL" -c "\d public.facebook_pages" -c "\d public.action_pages" -c "\d public.capi_event_logs"`

Expected output includes:
- `capi_enabled`, `capi_dataset_id`, `capi_access_token`, `capi_test_event_code` columns on `facebook_pages`
- `capi_event_name_override` column on `action_pages`
- `capi_event_logs` table with the indexes and RLS enabled

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260606000000_facebook_capi.sql
git commit -m "feat(capi): migration for facebook_pages CAPI columns, action_pages override, capi_event_logs"
```

---

## Task 2: capi-mapping pure module (TDD)

**Files:**
- Create: `src/lib/facebook/capi-mapping.ts`
- Create: `src/lib/facebook/capi-mapping.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/lib/facebook/capi-mapping.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveEventName } from './capi-mapping'
import type { ActionPageKind } from '@/lib/action-pages/kinds'

function input(
  kind: ActionPageKind,
  outcome: string,
  hasPayment = false,
  override: string | null = null,
) {
  return { kind, outcome, hasPayment, override }
}

describe('resolveEventName — kind defaults', () => {
  it('form/submitted → Lead', () => {
    expect(resolveEventName(input('form', 'submitted'))).toEqual({ send: true, eventName: 'Lead' })
  })

  it('booking/booked → Schedule', () => {
    expect(resolveEventName(input('booking', 'booked'))).toEqual({ send: true, eventName: 'Schedule' })
  })

  it('qualification/qualified → Lead', () => {
    expect(resolveEventName(input('qualification', 'qualified'))).toEqual({ send: true, eventName: 'Lead' })
  })

  it('qualification/disqualified → skip', () => {
    expect(resolveEventName(input('qualification', 'disqualified'))).toEqual({ send: false, reason: 'outcome_skip' })
  })

  it('qualification/pending_review → skip', () => {
    expect(resolveEventName(input('qualification', 'pending_review'))).toEqual({ send: false, reason: 'outcome_skip' })
  })

  it('sales/submitted without payment → InitiateCheckout', () => {
    expect(resolveEventName(input('sales', 'submitted', false))).toEqual({ send: true, eventName: 'InitiateCheckout' })
  })

  it('sales/submitted with payment → Purchase', () => {
    expect(resolveEventName(input('sales', 'submitted', true))).toEqual({ send: true, eventName: 'Purchase' })
  })

  it('catalog/checked_out without payment → InitiateCheckout', () => {
    expect(resolveEventName(input('catalog', 'checked_out', false))).toEqual({ send: true, eventName: 'InitiateCheckout' })
  })

  it('catalog/checked_out with payment → Purchase', () => {
    expect(resolveEventName(input('catalog', 'checked_out', true))).toEqual({ send: true, eventName: 'Purchase' })
  })

  it('realestate/inquiry_submitted → Lead', () => {
    expect(resolveEventName(input('realestate', 'inquiry_submitted'))).toEqual({ send: true, eventName: 'Lead' })
  })

  it('realestate/viewing_booked → Schedule', () => {
    expect(resolveEventName(input('realestate', 'viewing_booked'))).toEqual({ send: true, eventName: 'Schedule' })
  })

  it('unknown outcome → skip', () => {
    expect(resolveEventName(input('form', 'bogus'))).toEqual({ send: false, reason: 'outcome_skip' })
  })
})

describe('resolveEventName — override precedence', () => {
  it('override "SKIP" → skip regardless of mapping', () => {
    expect(resolveEventName(input('form', 'submitted', false, 'SKIP'))).toEqual({ send: false, reason: 'outcome_skip' })
  })

  it('override "Purchase" → Purchase regardless of mapping', () => {
    expect(resolveEventName(input('form', 'submitted', false, 'Purchase'))).toEqual({ send: true, eventName: 'Purchase' })
  })

  it('override null → falls through to default mapping', () => {
    expect(resolveEventName(input('booking', 'booked', false, null))).toEqual({ send: true, eventName: 'Schedule' })
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `pnpm test -- src/lib/facebook/capi-mapping.test.ts`
Expected: FAIL with "Failed to resolve import './capi-mapping'".

- [ ] **Step 3: Implement the module**

Create `src/lib/facebook/capi-mapping.ts`:

```ts
import type { ActionPageKind } from '@/lib/action-pages/kinds'

export const CAPI_STANDARD_EVENTS = [
  'Lead',
  'Schedule',
  'Purchase',
  'InitiateCheckout',
  'CompleteRegistration',
  'Contact',
  'Subscribe',
  'SubmitApplication',
  'AddToCart',
  'ViewContent',
] as const

export type CapiStandardEvent = (typeof CAPI_STANDARD_EVENTS)[number]

export interface MappingInput {
  kind: ActionPageKind
  outcome: string
  hasPayment: boolean
  override: string | null
}

export type MappingResult =
  | { send: false; reason: 'outcome_skip' }
  | { send: true; eventName: CapiStandardEvent }

function defaultEventName(kind: ActionPageKind, outcome: string, hasPayment: boolean): CapiStandardEvent | null {
  switch (kind) {
    case 'form':
      return outcome === 'submitted' ? 'Lead' : null
    case 'booking':
      return outcome === 'booked' ? 'Schedule' : null
    case 'qualification':
      return outcome === 'qualified' ? 'Lead' : null
    case 'sales':
      return outcome === 'submitted' ? (hasPayment ? 'Purchase' : 'InitiateCheckout') : null
    case 'catalog':
      return outcome === 'checked_out' ? (hasPayment ? 'Purchase' : 'InitiateCheckout') : null
    case 'realestate':
      if (outcome === 'inquiry_submitted') return 'Lead'
      if (outcome === 'viewing_booked') return 'Schedule'
      return null
    default:
      return null
  }
}

export function resolveEventName(input: MappingInput): MappingResult {
  const { kind, outcome, hasPayment, override } = input
  if (override === 'SKIP') return { send: false, reason: 'outcome_skip' }
  if (override && (CAPI_STANDARD_EVENTS as readonly string[]).includes(override)) {
    return { send: true, eventName: override as CapiStandardEvent }
  }
  const def = defaultEventName(kind, outcome, hasPayment)
  if (!def) return { send: false, reason: 'outcome_skip' }
  return { send: true, eventName: def }
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `pnpm test -- src/lib/facebook/capi-mapping.test.ts`
Expected: PASS. 15 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/facebook/capi-mapping.ts src/lib/facebook/capi-mapping.test.ts
git commit -m "feat(capi): outcome→event_name mapping with per-page override"
```

---

## Task 3: capi-payload module — normalization + hashing (TDD)

**Files:**
- Create: `src/lib/facebook/capi-payload.ts`
- Create: `src/lib/facebook/capi-payload.test.ts`

- [ ] **Step 1: Write the failing test file (normalization + hashing only)**

Create `src/lib/facebook/capi-payload.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  normalizeEmail,
  normalizePhone,
  splitName,
  sha256,
  hashList,
} from './capi-payload'

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Bar.COM  ')).toBe('foo@bar.com')
  })
  it('returns null for empty string', () => {
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail('   ')).toBeNull()
  })
})

describe('normalizePhone', () => {
  it('strips non-digits', () => {
    expect(normalizePhone('+63 917 555 1234')).toBe('639175551234')
  })
  it('keeps leading zeros from local format', () => {
    expect(normalizePhone('09175551234')).toBe('09175551234')
  })
  it('returns null when no digits', () => {
    expect(normalizePhone('abc')).toBeNull()
    expect(normalizePhone('')).toBeNull()
  })
})

describe('splitName', () => {
  it('splits on first whitespace', () => {
    expect(splitName('John Angelo David')).toEqual({ first: 'john', last: 'angelo david' })
  })
  it('single token → first only', () => {
    expect(splitName('Madonna')).toEqual({ first: 'madonna', last: null })
  })
  it('empty → both null', () => {
    expect(splitName('')).toEqual({ first: null, last: null })
    expect(splitName('   ')).toEqual({ first: null, last: null })
  })
  it('trims surrounding whitespace', () => {
    expect(splitName('  Ada  Lovelace  ')).toEqual({ first: 'ada', last: 'lovelace' })
  })
})

describe('sha256 / hashList', () => {
  it('sha256 returns 64-char hex', () => {
    const h = sha256('foo@bar.com')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    // Known SHA-256 of "foo@bar.com"
    expect(h).toBe('b4a25357d7df2497712b71e7b07d4d6e34dac82cc8ad9d0c70b5d09f829fb95b')
  })

  it('hashList drops empties and hashes the rest', () => {
    expect(hashList(['a', '', null, 'b'])).toEqual([sha256('a'), sha256('b')])
  })

  it('hashList returns null when result is empty', () => {
    expect(hashList([])).toBeNull()
    expect(hashList(['', null, undefined])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `pnpm test -- src/lib/facebook/capi-payload.test.ts`
Expected: FAIL with "Failed to resolve import './capi-payload'".

- [ ] **Step 3: Implement normalization + hashing**

Create `src/lib/facebook/capi-payload.ts`:

```ts
import { createHash } from 'node:crypto'

export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

export function normalizeEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase()
  return v.length > 0 ? v : null
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D+/g, '')
  return digits.length > 0 ? digits : null
}

export function splitName(raw: string): { first: string | null; last: string | null } {
  const trimmed = raw.trim()
  if (!trimmed) return { first: null, last: null }
  const idx = trimmed.search(/\s+/)
  if (idx === -1) return { first: trimmed.toLowerCase(), last: null }
  const first = trimmed.slice(0, idx).toLowerCase()
  const last = trimmed.slice(idx).trim().toLowerCase()
  return { first: first || null, last: last || null }
}

export function hashList(values: Array<string | null | undefined>): string[] | null {
  const out: string[] = []
  for (const v of values) {
    if (!v) continue
    const trimmed = v.trim()
    if (!trimmed) continue
    out.push(sha256(trimmed))
  }
  return out.length > 0 ? out : null
}
```

Verify the known SHA-256 in the test will be correct: `printf 'foo@bar.com' | shasum -a 256` → `b4a25357d7df2497712b71e7b07d4d6e34dac82cc8ad9d0c70b5d09f829fb95b`.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `pnpm test -- src/lib/facebook/capi-payload.test.ts`
Expected: PASS. 13 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/facebook/capi-payload.ts src/lib/facebook/capi-payload.test.ts
git commit -m "feat(capi): PII normalization and sha256 hashing helpers"
```

---

## Task 4: capi-payload — user_data builder (TDD)

**Files:**
- Modify: `src/lib/facebook/capi-payload.ts`
- Modify: `src/lib/facebook/capi-payload.test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `src/lib/facebook/capi-payload.test.ts`:

```ts
import { buildUserData } from './capi-payload'

describe('buildUserData', () => {
  const base = {
    fbPageId: 'PAGE123',
    psid: 'PSID456',
    leadId: 'lead-uuid-1',
    leadName: 'John Angelo David',
    leadPhones: ['+63 917 555 1234', '09175551234'],
    leadEmails: ['Foo@Bar.COM'],
    clientIp: '203.0.113.10',
    clientUserAgent: 'vitest',
  }

  it('hashes all contact fields and splits name', () => {
    const ud = buildUserData(base)
    expect(ud.page_id).toBe('PAGE123')
    expect(ud.page_scoped_user_id).toBe('PSID456')
    expect(ud.em).toEqual([sha256('foo@bar.com')])
    expect(ud.ph).toEqual([sha256('639175551234'), sha256('09175551234')])
    expect(ud.fn).toEqual([sha256('john')])
    expect(ud.ln).toEqual([sha256('angelo david')])
    expect(ud.external_id).toEqual([sha256('lead-uuid-1')])
    expect(ud.client_ip_address).toBe('203.0.113.10')
    expect(ud.client_user_agent).toBe('vitest')
  })

  it('omits empty hashed arrays entirely', () => {
    const ud = buildUserData({ ...base, leadPhones: [], leadEmails: [], leadName: null, leadId: null })
    expect(ud).not.toHaveProperty('em')
    expect(ud).not.toHaveProperty('ph')
    expect(ud).not.toHaveProperty('fn')
    expect(ud).not.toHaveProperty('ln')
    expect(ud).not.toHaveProperty('external_id')
  })

  it('omits missing ip / user-agent', () => {
    const ud = buildUserData({ ...base, clientIp: null, clientUserAgent: null })
    expect(ud).not.toHaveProperty('client_ip_address')
    expect(ud).not.toHaveProperty('client_user_agent')
  })

  it('single-token name → fn only, ln omitted', () => {
    const ud = buildUserData({ ...base, leadName: 'Madonna' })
    expect(ud.fn).toEqual([sha256('madonna')])
    expect(ud).not.toHaveProperty('ln')
  })
})
```

- [ ] **Step 2: Run, confirm it fails**

Run: `pnpm test -- src/lib/facebook/capi-payload.test.ts`
Expected: FAIL — `buildUserData` not exported.

- [ ] **Step 3: Implement `buildUserData`**

Append to `src/lib/facebook/capi-payload.ts`:

```ts
export interface BuildUserDataInput {
  fbPageId: string
  psid: string
  leadId: string | null
  leadName: string | null
  leadPhones: string[]
  leadEmails: string[]
  clientIp: string | null
  clientUserAgent: string | null
}

export interface UserData {
  page_id: string
  page_scoped_user_id: string
  em?: string[]
  ph?: string[]
  fn?: string[]
  ln?: string[]
  external_id?: string[]
  client_ip_address?: string
  client_user_agent?: string
}

export function buildUserData(input: BuildUserDataInput): UserData {
  const out: UserData = {
    page_id: input.fbPageId,
    page_scoped_user_id: input.psid,
  }

  const normalizedEmails = input.leadEmails
    .map((e) => normalizeEmail(e))
    .filter((v): v is string => v !== null)
  const em = hashList(normalizedEmails)
  if (em) out.em = em

  const normalizedPhones = input.leadPhones
    .map((p) => normalizePhone(p))
    .filter((v): v is string => v !== null)
  const ph = hashList(normalizedPhones)
  if (ph) out.ph = ph

  if (input.leadName) {
    const { first, last } = splitName(input.leadName)
    const fn = hashList([first])
    const ln = hashList([last])
    if (fn) out.fn = fn
    if (ln) out.ln = ln
  }

  if (input.leadId) {
    const ext = hashList([input.leadId])
    if (ext) out.external_id = ext
  }

  if (input.clientIp) out.client_ip_address = input.clientIp
  if (input.clientUserAgent) out.client_user_agent = input.clientUserAgent

  return out
}
```

- [ ] **Step 4: Run, confirm it passes**

Run: `pnpm test -- src/lib/facebook/capi-payload.test.ts`
Expected: PASS. 4 new tests green; 13 prior still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/facebook/capi-payload.ts src/lib/facebook/capi-payload.test.ts
git commit -m "feat(capi): buildUserData with hashed em/ph/fn/ln/external_id"
```

---

## Task 5: capi-payload — custom_data builder (TDD)

**Files:**
- Modify: `src/lib/facebook/capi-payload.ts`
- Modify: `src/lib/facebook/capi-payload.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/lib/facebook/capi-payload.test.ts`:

```ts
import { buildCustomData } from './capi-payload'

describe('buildCustomData', () => {
  it('catalog with order → currency, value, content_ids, num_items, order_id, content_type', () => {
    const cd = buildCustomData({
      kind: 'catalog',
      actionPageId: 'ap-1',
      parsedData: {},
      pageConfig: {},
      businessOrderId: 'order-1',
      catalogOrder: {
        subtotal: 199.5,
        currency: 'PHP',
        lines: [
          { business_item_id: 'p1', quantity: 2 },
          { business_item_id: 'p2', quantity: 1 },
        ],
        paymentStatus: 'paid',
      },
    })
    expect(cd).toEqual({
      currency: 'PHP',
      value: 199.5,
      content_ids: ['p1', 'p2'],
      content_type: 'product',
      num_items: 3,
      order_id: 'order-1',
    })
  })

  it('sales with payment → currency + value + order_id + content_ids', () => {
    const cd = buildCustomData({
      kind: 'sales',
      actionPageId: 'ap-2',
      parsedData: { payment_amount: 500, payment_currency: 'PHP' },
      pageConfig: {},
      businessOrderId: null,
      catalogOrder: null,
      submissionId: 'sub-1',
      hasPayment: true,
    })
    expect(cd).toEqual({
      currency: 'PHP',
      value: 500,
      order_id: 'sub-1',
      content_ids: ['ap-2'],
      content_type: 'product',
    })
  })

  it('sales with payment but no payment_currency → falls back to pageConfig.price.currency', () => {
    const cd = buildCustomData({
      kind: 'sales',
      actionPageId: 'ap-2',
      parsedData: { payment_amount: 500 },
      pageConfig: { price: { currency: 'USD' } },
      businessOrderId: null,
      catalogOrder: null,
      submissionId: 'sub-1',
      hasPayment: true,
    })
    expect(cd?.currency).toBe('USD')
    expect(cd?.value).toBe(500)
  })

  it('sales with payment but no value/currency → returns content_ids only', () => {
    const cd = buildCustomData({
      kind: 'sales',
      actionPageId: 'ap-2',
      parsedData: {},
      pageConfig: {},
      businessOrderId: null,
      catalogOrder: null,
      submissionId: 'sub-1',
      hasPayment: true,
    })
    expect(cd).toEqual({ content_ids: ['ap-2'], content_type: 'product' })
  })

  it('non-monetary kinds → content_ids only', () => {
    const cd = buildCustomData({
      kind: 'form',
      actionPageId: 'ap-3',
      parsedData: {},
      pageConfig: {},
      businessOrderId: null,
      catalogOrder: null,
    })
    expect(cd).toEqual({ content_ids: ['ap-3'], content_type: 'product' })
  })
})
```

- [ ] **Step 2: Run, confirm it fails**

Run: `pnpm test -- src/lib/facebook/capi-payload.test.ts`
Expected: FAIL — `buildCustomData` not exported.

- [ ] **Step 3: Implement `buildCustomData`**

Append to `src/lib/facebook/capi-payload.ts`:

```ts
import type { ActionPageKind } from '@/lib/action-pages/kinds'

export interface CatalogOrderForCapi {
  subtotal: number
  currency: string
  lines: { business_item_id: string; quantity: number }[]
  paymentStatus: 'unpaid' | 'pending' | 'paid'
}

export interface BuildCustomDataInput {
  kind: ActionPageKind
  actionPageId: string
  parsedData: Record<string, unknown>
  pageConfig: Record<string, unknown>
  businessOrderId: string | null
  catalogOrder: CatalogOrderForCapi | null
  submissionId?: string
  hasPayment?: boolean
}

export interface CustomData {
  currency?: string
  value?: number
  content_ids?: string[]
  content_type?: 'product'
  num_items?: number
  order_id?: string
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}
function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function buildCustomData(input: BuildCustomDataInput): CustomData {
  if (input.kind === 'catalog' && input.catalogOrder && input.businessOrderId) {
    const lines = input.catalogOrder.lines
    return {
      currency: input.catalogOrder.currency,
      value: input.catalogOrder.subtotal,
      content_ids: lines.map((l) => l.business_item_id),
      content_type: 'product',
      num_items: lines.reduce((s, l) => s + l.quantity, 0),
      order_id: input.businessOrderId,
    }
  }

  if (input.kind === 'sales' && input.hasPayment) {
    const cd: CustomData = {
      content_ids: [input.actionPageId],
      content_type: 'product',
    }
    const currency =
      asString(input.parsedData.payment_currency) ??
      asString((input.pageConfig.price as Record<string, unknown> | undefined)?.currency)
    const value = asNumber(input.parsedData.payment_amount)
    if (currency && value !== null) {
      cd.currency = currency
      cd.value = value
      if (input.submissionId) cd.order_id = input.submissionId
    }
    return cd
  }

  return {
    content_ids: [input.actionPageId],
    content_type: 'product',
  }
}
```

- [ ] **Step 4: Run, confirm it passes**

Run: `pnpm test -- src/lib/facebook/capi-payload.test.ts`
Expected: PASS. All payload tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/facebook/capi-payload.ts src/lib/facebook/capi-payload.test.ts
git commit -m "feat(capi): buildCustomData per-kind (catalog/sales/default)"
```

---

## Task 6: capi-payload — envelope builder (TDD)

**Files:**
- Modify: `src/lib/facebook/capi-payload.ts`
- Modify: `src/lib/facebook/capi-payload.test.ts`

- [ ] **Step 1: Append failing test**

Append to `src/lib/facebook/capi-payload.test.ts`:

```ts
import { buildEventEnvelope } from './capi-payload'

describe('buildEventEnvelope', () => {
  it('assembles a complete event with all fields', () => {
    const userData = { page_id: 'P', page_scoped_user_id: 'X' }
    const customData = { content_ids: ['ap-1'], content_type: 'product' as const }
    const env = buildEventEnvelope({
      eventName: 'Lead',
      eventId: 'sub-1',
      eventTimeMs: 1716480000000, // 2024-05-23T16:00:00Z
      eventSourceUrl: 'https://app.test/a/welcome',
      userData,
      customData,
    })
    expect(env).toEqual({
      event_name: 'Lead',
      event_time: 1716480000,
      event_id: 'sub-1',
      action_source: 'business_messaging',
      messaging_channel: 'messenger',
      event_source_url: 'https://app.test/a/welcome',
      user_data: userData,
      custom_data: customData,
    })
  })

  it('omits event_source_url and custom_data when not provided', () => {
    const env = buildEventEnvelope({
      eventName: 'Lead',
      eventId: 'sub-1',
      eventTimeMs: 1716480000000,
      eventSourceUrl: null,
      userData: { page_id: 'P', page_scoped_user_id: 'X' },
      customData: null,
    })
    expect(env).not.toHaveProperty('event_source_url')
    expect(env).not.toHaveProperty('custom_data')
  })
})
```

- [ ] **Step 2: Run, confirm it fails**

Run: `pnpm test -- src/lib/facebook/capi-payload.test.ts`
Expected: FAIL — `buildEventEnvelope` not exported.

- [ ] **Step 3: Implement `buildEventEnvelope`**

Append to `src/lib/facebook/capi-payload.ts`:

```ts
import type { CapiStandardEvent } from './capi-mapping'

export interface CapiEvent {
  event_name: CapiStandardEvent
  event_time: number
  event_id: string
  action_source: 'business_messaging'
  messaging_channel: 'messenger'
  event_source_url?: string
  user_data: UserData
  custom_data?: CustomData
}

export interface BuildEnvelopeInput {
  eventName: CapiStandardEvent
  eventId: string
  eventTimeMs: number
  eventSourceUrl: string | null
  userData: UserData
  customData: CustomData | null
}

export function buildEventEnvelope(input: BuildEnvelopeInput): CapiEvent {
  const out: CapiEvent = {
    event_name: input.eventName,
    event_time: Math.floor(input.eventTimeMs / 1000),
    event_id: input.eventId,
    action_source: 'business_messaging',
    messaging_channel: 'messenger',
    user_data: input.userData,
  }
  if (input.eventSourceUrl) out.event_source_url = input.eventSourceUrl
  if (input.customData) out.custom_data = input.customData
  return out
}
```

- [ ] **Step 4: Run, confirm it passes**

Run: `pnpm test -- src/lib/facebook/capi-payload.test.ts`
Expected: PASS. Envelope tests green; everything else still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/facebook/capi-payload.ts src/lib/facebook/capi-payload.test.ts
git commit -m "feat(capi): buildEventEnvelope with business_messaging action_source"
```

---

## Task 7: Dispatcher — skip paths (TDD)

**Files:**
- Create: `src/lib/facebook/capi.ts`
- Create: `src/lib/facebook/capi.test.ts`

The dispatcher does enough work that we test it in two passes: skip paths first, then network paths.

- [ ] **Step 1: Write the failing test for "no messenger context"**

Create `src/lib/facebook/capi.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  admin: null as unknown,
  decryptToken: vi.fn((token: string) => `decrypted:${token}`),
  fetch: vi.fn(),
}))

vi.mock('@/lib/facebook/crypto', () => ({
  decryptToken: mocks.decryptToken,
}))

vi.stubGlobal('fetch', mocks.fetch)

import { dispatchCapiEvent } from './capi'

function makeAdmin(opts: {
  page?: Record<string, unknown> | null
  actionPage?: Record<string, unknown> | null
  lead?: Record<string, unknown> | null
  insertOk?: boolean
}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const from = vi.fn((table: string) => {
    if (table === 'facebook_pages') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: opts.page ?? null, error: null }),
          }),
        }),
      }
    }
    if (table === 'action_pages') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: opts.actionPage ?? null, error: null }),
          }),
        }),
      }
    }
    if (table === 'leads') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: opts.lead ?? null, error: null }),
          }),
        }),
      }
    }
    if (table === 'capi_event_logs') {
      return {
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row })
          return { error: opts.insertOk === false ? { message: 'insert failed' } : null }
        },
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  return { admin: { from }, inserts }
}

function baseInput(overrides: Partial<Parameters<typeof dispatchCapiEvent>[0]> = {}) {
  return {
    admin: undefined as unknown,
    userId: 'u1',
    submissionId: 'sub-1',
    actionPageId: 'ap-1',
    actionPageKind: 'form' as const,
    actionPageSlug: 'welcome',
    outcome: 'submitted',
    psid: 'PSID1',
    pageRowId: 'page-row-1',
    parsedData: {},
    pageConfig: {},
    leadId: null,
    clientIp: '203.0.113.10',
    clientUserAgent: 'vitest',
    submissionCreatedAt: new Date('2024-05-23T16:00:00Z'),
    businessOrderId: null,
    catalogOrder: null,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.fetch.mockReset()
})

describe('dispatchCapiEvent — skip paths', () => {
  it('skips with no_messenger_context when psid is null', async () => {
    const { admin, inserts } = makeAdmin({})
    await dispatchCapiEvent({ ...baseInput({ psid: null, admin }) })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(inserts).toHaveLength(1)
    expect(inserts[0].row).toMatchObject({ status: 'skipped', skip_reason: 'no_messenger_context' })
  })

  it('skips with no_messenger_context when pageRowId is null', async () => {
    const { admin, inserts } = makeAdmin({})
    await dispatchCapiEvent({ ...baseInput({ pageRowId: null, admin }) })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(inserts[0].row).toMatchObject({ status: 'skipped', skip_reason: 'no_messenger_context' })
  })

  it('skips with disabled when facebook_pages.capi_enabled is false', async () => {
    const { admin, inserts } = makeAdmin({
      page: { fb_page_id: 'P1', capi_enabled: false, capi_dataset_id: null, capi_access_token: null, capi_test_event_code: null },
      actionPage: { capi_event_name_override: null },
    })
    await dispatchCapiEvent({ ...baseInput({ admin }) })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(inserts[0].row).toMatchObject({ status: 'skipped', skip_reason: 'disabled' })
  })

  it('skips with not_configured when dataset_id missing', async () => {
    const { admin, inserts } = makeAdmin({
      page: { fb_page_id: 'P1', capi_enabled: true, capi_dataset_id: null, capi_access_token: 'tok', capi_test_event_code: null },
      actionPage: { capi_event_name_override: null },
    })
    await dispatchCapiEvent({ ...baseInput({ admin }) })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(inserts[0].row).toMatchObject({ status: 'skipped', skip_reason: 'not_configured' })
  })

  it('skips with outcome_skip for qualification/disqualified', async () => {
    const { admin, inserts } = makeAdmin({
      page: { fb_page_id: 'P1', capi_enabled: true, capi_dataset_id: 'DS', capi_access_token: 'tok', capi_test_event_code: null },
      actionPage: { capi_event_name_override: null },
    })
    await dispatchCapiEvent({ ...baseInput({ admin, actionPageKind: 'qualification', outcome: 'disqualified' }) })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(inserts[0].row).toMatchObject({ status: 'skipped', skip_reason: 'outcome_skip' })
  })

  it('skips with outcome_skip when override is "SKIP"', async () => {
    const { admin, inserts } = makeAdmin({
      page: { fb_page_id: 'P1', capi_enabled: true, capi_dataset_id: 'DS', capi_access_token: 'tok', capi_test_event_code: null },
      actionPage: { capi_event_name_override: 'SKIP' },
    })
    await dispatchCapiEvent({ ...baseInput({ admin }) })
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(inserts[0].row).toMatchObject({ status: 'skipped', skip_reason: 'outcome_skip' })
  })
})
```

- [ ] **Step 2: Run, confirm it fails**

Run: `pnpm test -- src/lib/facebook/capi.test.ts`
Expected: FAIL — `dispatchCapiEvent` not exported.

- [ ] **Step 3: Implement `dispatchCapiEvent` skip paths**

Create `src/lib/facebook/capi.ts`:

```ts
import { decryptToken } from '@/lib/facebook/crypto'
import type { ActionPageKind } from '@/lib/action-pages/kinds'
import { resolveEventName } from './capi-mapping'
import {
  buildCustomData,
  buildEventEnvelope,
  buildUserData,
  type CapiEvent,
  type CatalogOrderForCapi,
} from './capi-payload'

const GRAPH_API_VERSION = 'v19.0'
const NETWORK_TIMEOUT_MS = 10_000

type Admin = {
  from: (table: string) => any
}

export interface DispatchInput {
  admin: Admin
  userId: string
  submissionId: string
  actionPageId: string
  actionPageKind: ActionPageKind
  actionPageSlug: string
  outcome: string
  psid: string | null
  pageRowId: string | null
  parsedData: Record<string, unknown>
  pageConfig: Record<string, unknown>
  leadId: string | null
  clientIp: string | null
  clientUserAgent: string | null
  submissionCreatedAt: Date
  businessOrderId: string | null
  catalogOrder: CatalogOrderForCapi | null
}

type LogRow = {
  user_id: string
  page_id: string | null
  submission_id: string
  action_page_id: string
  event_name: string | null
  event_id: string
  status: 'sent' | 'skipped' | 'error'
  skip_reason: 'no_messenger_context' | 'disabled' | 'not_configured' | 'outcome_skip' | null
  http_status: number | null
  fb_trace_id: string | null
  request_payload: unknown | null
  response_body: unknown | null
  error_message: string | null
}

async function writeLog(admin: Admin, row: LogRow): Promise<void> {
  try {
    const { error } = await admin.from('capi_event_logs').insert(row)
    if (error) console.warn('[capi] log insert failed', error.message ?? error)
  } catch (e) {
    console.warn('[capi] log insert threw', e instanceof Error ? e.message : e)
  }
}

function baseLog(input: DispatchInput): LogRow {
  return {
    user_id: input.userId,
    page_id: input.pageRowId,
    submission_id: input.submissionId,
    action_page_id: input.actionPageId,
    event_name: null,
    event_id: input.submissionId,
    status: 'skipped',
    skip_reason: null,
    http_status: null,
    fb_trace_id: null,
    request_payload: null,
    response_body: null,
    error_message: null,
  }
}

export async function dispatchCapiEvent(input: DispatchInput): Promise<void> {
  // 1) Skip if no messenger context.
  if (!input.psid || !input.pageRowId) {
    await writeLog(input.admin, { ...baseLog(input), status: 'skipped', skip_reason: 'no_messenger_context' })
    return
  }

  // 2) Load page CAPI config.
  const { data: page } = await input.admin
    .from('facebook_pages')
    .select('fb_page_id, capi_enabled, capi_dataset_id, capi_access_token, capi_test_event_code')
    .eq('id', input.pageRowId)
    .maybeSingle()
  if (!page || page.capi_enabled !== true) {
    await writeLog(input.admin, { ...baseLog(input), status: 'skipped', skip_reason: 'disabled' })
    return
  }
  if (!page.capi_dataset_id || !page.capi_access_token) {
    await writeLog(input.admin, { ...baseLog(input), status: 'skipped', skip_reason: 'not_configured' })
    return
  }

  // 3) Load per-action-page override.
  const { data: ap } = await input.admin
    .from('action_pages')
    .select('capi_event_name_override')
    .eq('id', input.actionPageId)
    .maybeSingle()
  const override = (ap?.capi_event_name_override as string | null) ?? null

  // 4) Compute hasPayment.
  const hasPayment = computeHasPayment(input)

  // 5) Resolve event_name.
  const mapping = resolveEventName({
    kind: input.actionPageKind,
    outcome: input.outcome,
    hasPayment,
    override,
  })
  if (!mapping.send) {
    await writeLog(input.admin, { ...baseLog(input), status: 'skipped', skip_reason: 'outcome_skip' })
    return
  }

  // Step 6+ filled in by a later task; throw for now so it's obvious if reached.
  throw new Error('dispatchCapiEvent: network path not implemented yet')
}

function computeHasPayment(input: DispatchInput): boolean {
  if (input.actionPageKind === 'sales') {
    const pm = input.parsedData.payment_method_id
    const proof = input.parsedData.payment_proof_url
    return (typeof pm === 'string' && pm.length > 0) || (typeof proof === 'string' && proof.length > 0)
  }
  if (input.actionPageKind === 'catalog') {
    return input.catalogOrder !== null && input.catalogOrder.paymentStatus !== 'unpaid'
  }
  return false
}
```

- [ ] **Step 4: Run, confirm skip tests pass**

Run: `pnpm test -- src/lib/facebook/capi.test.ts`
Expected: 6 skip tests PASS. (The network paths aren't tested yet.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/facebook/capi.ts src/lib/facebook/capi.test.ts
git commit -m "feat(capi): dispatcher skip paths (no context, disabled, not configured, outcome skip)"
```

---

## Task 8: Dispatcher — network paths (TDD)

**Files:**
- Modify: `src/lib/facebook/capi.ts`
- Modify: `src/lib/facebook/capi.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/lib/facebook/capi.test.ts`:

```ts
describe('dispatchCapiEvent — network paths', () => {
  const enabledPage = {
    fb_page_id: 'P1',
    capi_enabled: true,
    capi_dataset_id: 'DS123',
    capi_access_token: 'enc:tok',
    capi_test_event_code: null,
  }
  const noOverride = { capi_event_name_override: null }

  it('logs sent on 2xx with http_status + fb_trace_id', async () => {
    const { admin, inserts } = makeAdmin({ page: enabledPage, actionPage: noOverride })
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'trace-XYZ' }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'x-fb-trace-id': 'trace-XYZ' },
      }),
    )
    await dispatchCapiEvent({ ...baseInput({ admin }) })
    expect(mocks.fetch).toHaveBeenCalledOnce()
    const [url, init] = mocks.fetch.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v19.0/DS123/events?access_token=decrypted%3Aenc%3Atok')
    expect((init as RequestInit).method).toBe('POST')
    expect(inserts[0].row).toMatchObject({
      status: 'sent',
      event_name: 'Lead',
      http_status: 200,
      fb_trace_id: 'trace-XYZ',
    })
  })

  it('logs error on 4xx with response_body', async () => {
    const { admin, inserts } = makeAdmin({ page: enabledPage, actionPage: noOverride })
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'bad event_id', fbtrace_id: 'trace-ERR' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await dispatchCapiEvent({ ...baseInput({ admin }) })
    expect(inserts[0].row).toMatchObject({
      status: 'error',
      http_status: 400,
      fb_trace_id: 'trace-ERR',
    })
    expect(inserts[0].row.response_body).toMatchObject({ error: { message: 'bad event_id' } })
  })

  it('logs error on network failure', async () => {
    const { admin, inserts } = makeAdmin({ page: enabledPage, actionPage: noOverride })
    mocks.fetch.mockRejectedValueOnce(new Error('ENOTFOUND'))
    await dispatchCapiEvent({ ...baseInput({ admin }) })
    expect(inserts[0].row).toMatchObject({ status: 'error' })
    expect(inserts[0].row.error_message).toMatch(/ENOTFOUND/)
  })

  it('propagates test_event_code when set', async () => {
    const { admin } = makeAdmin({
      page: { ...enabledPage, capi_test_event_code: 'TEST123' },
      actionPage: noOverride,
    })
    mocks.fetch.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    await dispatchCapiEvent({ ...baseInput({ admin }) })
    const [, init] = mocks.fetch.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.test_event_code).toBe('TEST123')
    expect(body.data).toHaveLength(1)
  })

  it('includes lead contact data when leadId is set', async () => {
    const { admin } = makeAdmin({
      page: enabledPage,
      actionPage: noOverride,
      lead: { phones: ['+63 917 555 1234'], emails: ['Foo@Bar.COM'], name: 'Ada Lovelace' },
    })
    mocks.fetch.mockResolvedValueOnce(new Response('{}', { status: 200 }))
    await dispatchCapiEvent({ ...baseInput({ admin, leadId: 'lead-1' }) })
    const [, init] = mocks.fetch.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.data[0].user_data.em).toBeDefined()
    expect(body.data[0].user_data.ph).toBeDefined()
    expect(body.data[0].user_data.fn).toBeDefined()
    expect(body.data[0].user_data.ln).toBeDefined()
    expect(body.data[0].user_data.external_id).toBeDefined()
  })
})
```

- [ ] **Step 2: Run, confirm new tests fail**

Run: `pnpm test -- src/lib/facebook/capi.test.ts`
Expected: 5 new tests FAIL with "network path not implemented yet". 6 skip tests still PASS.

- [ ] **Step 3: Implement the network path**

Replace the `throw new Error('dispatchCapiEvent: network path not implemented yet')` line in `src/lib/facebook/capi.ts` and append the helpers. The full revised body of `dispatchCapiEvent` becomes:

```ts
export async function dispatchCapiEvent(input: DispatchInput): Promise<void> {
  // 1) Skip if no messenger context.
  if (!input.psid || !input.pageRowId) {
    await writeLog(input.admin, { ...baseLog(input), status: 'skipped', skip_reason: 'no_messenger_context' })
    return
  }

  // 2) Load page CAPI config.
  const { data: page } = await input.admin
    .from('facebook_pages')
    .select('fb_page_id, capi_enabled, capi_dataset_id, capi_access_token, capi_test_event_code')
    .eq('id', input.pageRowId)
    .maybeSingle()
  if (!page || page.capi_enabled !== true) {
    await writeLog(input.admin, { ...baseLog(input), status: 'skipped', skip_reason: 'disabled' })
    return
  }
  if (!page.capi_dataset_id || !page.capi_access_token) {
    await writeLog(input.admin, { ...baseLog(input), status: 'skipped', skip_reason: 'not_configured' })
    return
  }

  // 3) Load per-action-page override.
  const { data: ap } = await input.admin
    .from('action_pages')
    .select('capi_event_name_override')
    .eq('id', input.actionPageId)
    .maybeSingle()
  const override = (ap?.capi_event_name_override as string | null) ?? null

  // 4) hasPayment.
  const hasPayment = computeHasPayment(input)

  // 5) event_name.
  const mapping = resolveEventName({
    kind: input.actionPageKind,
    outcome: input.outcome,
    hasPayment,
    override,
  })
  if (!mapping.send) {
    await writeLog(input.admin, { ...baseLog(input), status: 'skipped', skip_reason: 'outcome_skip' })
    return
  }

  // 6) Lead contacts.
  let leadName: string | null = null
  let leadPhones: string[] = []
  let leadEmails: string[] = []
  if (input.leadId) {
    const { data: lead } = await input.admin
      .from('leads')
      .select('phones, emails, name')
      .eq('id', input.leadId)
      .maybeSingle()
    if (lead) {
      leadName = typeof lead.name === 'string' ? lead.name : null
      leadPhones = Array.isArray(lead.phones) ? lead.phones.filter((v: unknown): v is string => typeof v === 'string') : []
      leadEmails = Array.isArray(lead.emails) ? lead.emails.filter((v: unknown): v is string => typeof v === 'string') : []
    }
  }

  // 7) Build envelope.
  const userData = buildUserData({
    fbPageId: page.fb_page_id,
    psid: input.psid,
    leadId: input.leadId,
    leadName,
    leadPhones,
    leadEmails,
    clientIp: input.clientIp,
    clientUserAgent: input.clientUserAgent,
  })
  const customData = buildCustomData({
    kind: input.actionPageKind,
    actionPageId: input.actionPageId,
    parsedData: input.parsedData,
    pageConfig: input.pageConfig,
    businessOrderId: input.businessOrderId,
    catalogOrder: input.catalogOrder,
    submissionId: input.submissionId,
    hasPayment,
  })
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  const eventSourceUrl = appUrl ? `${appUrl}/a/${input.actionPageSlug}` : null

  const event: CapiEvent = buildEventEnvelope({
    eventName: mapping.eventName,
    eventId: input.submissionId,
    eventTimeMs: input.submissionCreatedAt.getTime(),
    eventSourceUrl,
    userData,
    customData,
  })
  const body: Record<string, unknown> = { data: [event] }
  if (page.capi_test_event_code) body.test_event_code = page.capi_test_event_code

  // 8) POST.
  const token = decryptToken(page.capi_access_token)
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
    page.capi_dataset_id,
  )}/events?access_token=${encodeURIComponent(token)}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS)

  const log: LogRow = {
    ...baseLog(input),
    event_name: mapping.eventName,
    request_payload: body,
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const traceHeader = res.headers.get('x-fb-trace-id')
    let parsed: unknown = null
    try {
      parsed = await res.json()
    } catch {
      parsed = null
    }
    const traceFromBody =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>).fbtrace_id ??
          ((parsed as Record<string, unknown>).error as Record<string, unknown> | undefined)?.fbtrace_id
        : null
    log.http_status = res.status
    log.fb_trace_id = traceHeader ?? (typeof traceFromBody === 'string' ? traceFromBody : null)
    log.response_body = parsed
    log.status = res.ok ? 'sent' : 'error'
    if (!res.ok && (!log.error_message)) {
      const errMsg =
        parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).error
          ? ((parsed as Record<string, unknown>).error as Record<string, unknown>).message
          : `HTTP ${res.status}`
      log.error_message = typeof errMsg === 'string' ? errMsg : `HTTP ${res.status}`
    }
  } catch (e) {
    log.status = 'error'
    log.error_message = e instanceof Error ? e.message : String(e)
  } finally {
    clearTimeout(timeout)
  }

  await writeLog(input.admin, log)
}
```

- [ ] **Step 4: Run, confirm all tests pass**

Run: `pnpm test -- src/lib/facebook/capi.test.ts`
Expected: PASS — 11 tests green (6 skip + 5 network).

- [ ] **Step 5: Commit**

```bash
git add src/lib/facebook/capi.ts src/lib/facebook/capi.test.ts
git commit -m "feat(capi): dispatcher network path with POST, log row, and timeout"
```

---

## Task 9: Extend CatalogOrderResult shape in submit route

The submit route's internal `CatalogOrderResult` interface doesn't expose `business_item_id` per line or `paymentStatus`. The dispatcher needs both.

**Files:**
- Modify: `src/app/api/action-pages/submit/route.ts:795-808` (interface) and around `:879-889` (line construction) and `:957-996` (return statement)

- [ ] **Step 1: Read the current shape**

Open `src/app/api/action-pages/submit/route.ts` and confirm `CatalogOrderResult` looks like the spec describes (lines field with `title_snapshot`, `quantity`, `unit_amount`, `line_total_amount`, `currency`; subtotal; currency; customer; customFields). Note the missing fields.

- [ ] **Step 2: Modify the interface**

In `src/app/api/action-pages/submit/route.ts`, change the `CatalogOrderResult` interface to add the two fields. Replace:

```ts
interface CatalogOrderResult {
  orderId: string
  lines: Array<{
    title_snapshot: string
    quantity: number
    unit_amount: number
    line_total_amount: number
    currency: string
  }>
  subtotal: number
  currency: string
  customer: { name: string | null; phone: string | null; email: string | null; notes: string | null }
  customFields: Record<string, string>
}
```

with:

```ts
interface CatalogOrderResult {
  orderId: string
  lines: Array<{
    business_item_id: string
    title_snapshot: string
    quantity: number
    unit_amount: number
    line_total_amount: number
    currency: string
  }>
  subtotal: number
  currency: string
  customer: { name: string | null; phone: string | null; email: string | null; notes: string | null }
  customFields: Record<string, string>
  paymentStatus: 'unpaid' | 'pending' | 'paid'
}
```

- [ ] **Step 3: Populate `business_item_id` in line construction**

Inside `createBusinessOrderFromCatalog`, the line construction is around the `return {` near `:879`. Find the block that returns the row used both for `lines` and the RPC call. Add `business_item_id: item.id` to the line objects. The construction looks like:

```ts
return {
  user_id: args.page.user_id,
  business_item_id: item.id,
  title_snapshot: String(product.title),
  // ...
}
```

That object is already used for the RPC. We need to surface `business_item_id` on the returned `lines` array. Change the final return at the bottom of `createBusinessOrderFromCatalog` from:

```ts
return {
  orderId: String(orderId),
  lines,
  subtotal,
  currency,
  customer: { ... },
  customFields,
}
```

to:

```ts
return {
  orderId: String(orderId),
  lines: lines.map((l) => ({
    business_item_id: l.business_item_id as string,
    title_snapshot: l.title_snapshot,
    quantity: l.quantity,
    unit_amount: l.unit_amount,
    line_total_amount: l.line_total_amount,
    currency: l.currency,
  })),
  subtotal,
  currency,
  customer: {
    name: (customer.name as string | null) ?? null,
    phone: (customer.phone as string | null) ?? null,
    email: (customer.email as string | null) ?? null,
    notes: (customer.notes as string | null) ?? null,
  },
  customFields,
  paymentStatus: paymentStatus as 'unpaid' | 'pending' | 'paid',
}
```

(The existing `paymentStatus` variable is already in scope from `:957-958`.)

- [ ] **Step 4: Run the existing submit-route tests, confirm no regression**

Run: `pnpm test -- src/app/api/action-pages/submit/route.test.ts`
Expected: PASS — all existing cases stay green.

- [ ] **Step 5: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/action-pages/submit/route.ts
git commit -m "refactor(submit): surface business_item_id and paymentStatus on CatalogOrderResult"
```

---

## Task 10: Wire dispatcher into submit route

**Files:**
- Modify: `src/app/api/action-pages/submit/route.ts` (add import + one call block)
- Modify: `src/app/api/action-pages/submit/route.test.ts` (add one test case)

- [ ] **Step 1: Write the failing test case**

Append to `src/app/api/action-pages/submit/route.test.ts` a new test that asserts `dispatchCapiEvent` is called. Use the same `vi.hoisted` mock pattern as the rest of the file. Near the top, add:

```ts
vi.mock('@/lib/facebook/capi', () => ({
  dispatchCapiEvent: mocks.dispatchCapiEvent,
}))
```

…and extend the `mocks` object inside the existing `vi.hoisted(() => ({ ... }))` block by adding:

```ts
dispatchCapiEvent: vi.fn(async () => undefined),
```

Then add a new `it(...)` near other passing tests:

```ts
it('calls dispatchCapiEvent with the submission context when CAPI plumbing is reachable', async () => {
  mocks.admin = makeAdminMock()
  mocks.dispatchCapiEvent.mockClear()
  const deeplinkParams = buildDeeplinkParams('secret', 'welcome-form', {
    psid: 'PSID42',
    pageId: 'page-1',
    exp: Math.floor(Date.now() / 1000) + 60,
  })
  const req = makeJsonRequest({
    slug: 'welcome-form',
    data: { full_name: 'Ada Lovelace', email: 'ada@example.com' },
    ...deeplinkParams,
  })
  const res = await POST(req as any)
  expect(res.status).toBe(200)
  expect(mocks.dispatchCapiEvent).toHaveBeenCalledTimes(1)
  const call = mocks.dispatchCapiEvent.mock.calls[0][0]
  expect(call).toMatchObject({
    userId: 'user_1',
    actionPageKind: 'form',
    actionPageSlug: 'welcome-form',
    outcome: 'submitted',
    psid: 'PSID42',
    pageRowId: 'page-1',
  })
})
```

(The existing `makeAdminMock` already covers `facebook_pages`/`messenger_threads`/`action_pages` table reads. The new test relies on it returning `psid: 'PSID42'` + `page-1`, which the existing helper already does when the deeplink is verified — confirm by reading the helper at the top of the test file.)

- [ ] **Step 2: Run, confirm it fails**

Run: `pnpm test -- src/app/api/action-pages/submit/route.test.ts`
Expected: FAIL — `dispatchCapiEvent` never called (route doesn't import it yet).

- [ ] **Step 3: Wire the dispatcher into the route**

In `src/app/api/action-pages/submit/route.ts`, add the import near the top with the other lib imports:

```ts
import { dispatchCapiEvent } from '@/lib/facebook/capi'
```

Then, immediately after the existing `dispatchSubmissionReceived` block around `:543-553`, add:

```ts
// Fire Conversions API event for Meta. Best-effort — never blocks the response.
if (subInsert?.id) {
  dispatchCapiEvent({
    admin,
    userId: page.user_id,
    submissionId: subInsert.id,
    actionPageId: page.id,
    actionPageKind: page.kind as ActionPageKind,
    actionPageSlug: page.slug,
    outcome: parsed.outcome,
    psid,
    pageRowId: fbPageId,
    parsedData: parsed.data,
    pageConfig: page.config,
    leadId,
    clientIp: ip,
    clientUserAgent: ua,
    submissionCreatedAt: new Date(),
    businessOrderId,
    catalogOrder: catalogOrderResult
      ? {
          subtotal: catalogOrderResult.subtotal,
          currency: catalogOrderResult.currency,
          lines: catalogOrderResult.lines.map((l) => ({
            business_item_id: l.business_item_id,
            quantity: l.quantity,
          })),
          paymentStatus: catalogOrderResult.paymentStatus,
        }
      : null,
  }).catch((e) => console.error('[action-pages.submit] dispatchCapiEvent threw', e))
}
```

(`ActionPageKind` is already imported at line 7 of the route file.)

- [ ] **Step 4: Run, confirm it passes**

Run: `pnpm test -- src/app/api/action-pages/submit/route.test.ts`
Expected: PASS — new test + all existing tests green.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/action-pages/submit/route.ts src/app/api/action-pages/submit/route.test.ts
git commit -m "feat(capi): wire dispatchCapiEvent into action-page submit"
```

---

## Task 11: Settings → Facebook → Conversions API server actions

**Files:**
- Modify: `src/app/(app)/dashboard/settings/facebook/actions.ts`

- [ ] **Step 1: Add `saveCapiConfigForm` server action**

Append to `src/app/(app)/dashboard/settings/facebook/actions.ts`:

```ts
export async function saveCapiConfigForm(formData: FormData): Promise<void> {
  const session = await getSession()
  if (!session) redirect('/login')

  const pageId = String(formData.get('page_id') ?? '')
  if (!pageId) errRedirect('missing_page_id')

  const enabled = formData.get('capi_enabled') === 'on'
  const datasetId = String(formData.get('capi_dataset_id') ?? '').trim() || null
  const testCode = String(formData.get('capi_test_event_code') ?? '').trim() || null
  const tokenUnchanged = formData.get('token_unchanged') === '1'
  const newToken = String(formData.get('capi_access_token') ?? '').trim()

  if (enabled && !datasetId) errRedirect('capi_missing_dataset')

  const supabase = await createClient()

  // Ownership check + load current token.
  const { data: existing } = await supabase
    .from('facebook_pages')
    .select('id, capi_access_token, connection_id')
    .eq('id', pageId)
    .maybeSingle<{ id: string; capi_access_token: string | null; connection_id: string }>()
  if (!existing) errRedirect('page_not_found')
  const { data: conn } = await supabase
    .from('facebook_connections')
    .select('id, user_id')
    .eq('id', existing.connection_id)
    .maybeSingle<{ id: string; user_id: string }>()
  if (!conn || conn.user_id !== session.userId) errRedirect('forbidden')

  let tokenToStore: string | null = existing.capi_access_token
  if (!tokenUnchanged) {
    tokenToStore = newToken ? encryptToken(newToken) : null
  }
  if (enabled && !tokenToStore) errRedirect('capi_missing_token')

  const { error } = await supabase
    .from('facebook_pages')
    .update({
      capi_enabled: enabled,
      capi_dataset_id: datasetId,
      capi_access_token: tokenToStore,
      capi_test_event_code: testCode,
    })
    .eq('id', pageId)
  if (error) errRedirect('capi_save_failed', error.message)

  revalidatePath(SETTINGS_PATH)
  redirect(`${SETTINGS_PATH}?capi_saved=1`)
}
```

- [ ] **Step 2: Add `sendCapiTestEventForm` server action**

Append to the same file:

```ts
export async function sendCapiTestEventForm(formData: FormData): Promise<void> {
  const session = await getSession()
  if (!session) redirect('/login')

  const pageId = String(formData.get('page_id') ?? '')
  if (!pageId) errRedirect('missing_page_id')

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('facebook_pages')
    .select('id, connection_id, capi_enabled, capi_dataset_id, capi_access_token, capi_test_event_code')
    .eq('id', pageId)
    .maybeSingle<{
      id: string
      connection_id: string
      capi_enabled: boolean
      capi_dataset_id: string | null
      capi_access_token: string | null
      capi_test_event_code: string | null
    }>()
  if (!existing) errRedirect('page_not_found')

  const { data: conn } = await admin
    .from('facebook_connections')
    .select('user_id')
    .eq('id', existing.connection_id)
    .maybeSingle<{ user_id: string }>()
  if (!conn || conn.user_id !== session.userId) errRedirect('forbidden')

  if (!existing.capi_enabled || !existing.capi_dataset_id || !existing.capi_access_token) {
    errRedirect('capi_not_configured')
  }

  const fakeSubmissionId = `test-${crypto.randomUUID()}`
  await dispatchCapiEvent({
    admin,
    userId: session.userId,
    submissionId: fakeSubmissionId,
    actionPageId: 'test-action-page',
    actionPageKind: 'form',
    actionPageSlug: 'test',
    outcome: 'submitted',
    psid: 'TEST_PSID',
    pageRowId: existing.id,
    parsedData: {},
    pageConfig: {},
    leadId: null,
    clientIp: '127.0.0.1',
    clientUserAgent: 'capi-test',
    submissionCreatedAt: new Date(),
    businessOrderId: null,
    catalogOrder: null,
  })

  revalidatePath(SETTINGS_PATH)
  redirect(`${SETTINGS_PATH}?capi_test=1`)
}
```

- [ ] **Step 3: Add imports**

At the top of `src/app/(app)/dashboard/settings/facebook/actions.ts`, ensure these imports exist (add what's missing):

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchCapiEvent } from '@/lib/facebook/capi'
import crypto from 'node:crypto'
```

(`encryptToken` is already imported.)

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/dashboard/settings/facebook/actions.ts
git commit -m "feat(capi): server actions to save CAPI config and send test event"
```

---

## Task 12: Settings UI — CAPI section + per-page form

**Files:**
- Create: `src/app/(app)/dashboard/settings/facebook/_components/capi-section.tsx`
- Create: `src/app/(app)/dashboard/settings/facebook/_components/capi-page-form.tsx`
- Modify: `src/app/(app)/dashboard/settings/facebook/page.tsx`

- [ ] **Step 1: Create `capi-section.tsx` (server component)**

```tsx
import { CapiPageForm } from './capi-page-form'

type Page = {
  id: string
  name: string
  capi_enabled: boolean
  capi_dataset_id: string | null
  has_capi_token: boolean
  capi_test_event_code: string | null
}

export function CapiSection({ pages }: { pages: Page[] }) {
  if (pages.length === 0) return null
  return (
    <section className="space-y-4 border-t pt-6 mt-6">
      <header>
        <h2 className="text-lg font-semibold">Conversions API (Business Messaging)</h2>
        <p className="text-sm text-muted-foreground">
          Send conversion events to Meta when leads complete actions on your pages.
          Improves ad optimization for Click-to-Messenger campaigns.{' '}
          <a
            href="https://developers.facebook.com/documentation/ads-commerce/conversions-api/business-messaging"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Learn more
          </a>
          .
        </p>
      </header>
      <div className="space-y-3">
        {pages.map((p) => (
          <CapiPageForm key={p.id} page={p} />
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Create `capi-page-form.tsx` (client component)**

```tsx
'use client'

import { useState } from 'react'
import { saveCapiConfigForm, sendCapiTestEventForm } from '../actions'

type Page = {
  id: string
  name: string
  capi_enabled: boolean
  capi_dataset_id: string | null
  has_capi_token: boolean
  capi_test_event_code: string | null
}

export function CapiPageForm({ page }: { page: Page }) {
  const [editingToken, setEditingToken] = useState(!page.has_capi_token)

  return (
    <details
      className="rounded-md border p-4 open:bg-muted/30"
      open={page.capi_enabled || !page.has_capi_token === false}
    >
      <summary className="cursor-pointer text-sm font-medium">
        {page.name} {page.capi_enabled ? '· Enabled' : '· Disabled'}
      </summary>
      <form action={saveCapiConfigForm} className="mt-4 space-y-3">
        <input type="hidden" name="page_id" value={page.id} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="capi_enabled" defaultChecked={page.capi_enabled} />
          Enabled
        </label>
        <label className="block text-sm">
          <span className="block mb-1">Dataset ID (Pixel ID)</span>
          <input
            type="text"
            name="capi_dataset_id"
            defaultValue={page.capi_dataset_id ?? ''}
            placeholder="1234567890"
            className="w-full border rounded px-2 py-1"
          />
        </label>
        <label className="block text-sm">
          <span className="block mb-1">CAPI Access Token</span>
          {editingToken ? (
            <input
              type="password"
              name="capi_access_token"
              placeholder={page.has_capi_token ? 'Leave blank to keep current' : 'Paste token from Events Manager'}
              className="w-full border rounded px-2 py-1"
              autoComplete="off"
            />
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">••••••••••••</span>
              <button
                type="button"
                onClick={() => setEditingToken(true)}
                className="text-xs underline"
              >
                Edit
              </button>
              <input type="hidden" name="token_unchanged" value="1" />
            </div>
          )}
        </label>
        <label className="block text-sm">
          <span className="block mb-1">Test Event Code (optional)</span>
          <input
            type="text"
            name="capi_test_event_code"
            defaultValue={page.capi_test_event_code ?? ''}
            placeholder="TEST12345"
            className="w-full border rounded px-2 py-1"
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded bg-emerald-600 text-white text-sm px-3 py-1.5"
          >
            Save
          </button>
          <button
            type="submit"
            formAction={sendCapiTestEventForm}
            className="rounded border text-sm px-3 py-1.5"
            disabled={!page.capi_enabled}
            title={page.capi_enabled ? 'Send a synthetic Lead event' : 'Enable CAPI first'}
          >
            Send test event
          </button>
        </div>
      </form>
    </details>
  )
}
```

- [ ] **Step 3: Modify `page.tsx` to load CAPI fields and render the section**

In `src/app/(app)/dashboard/settings/facebook/page.tsx`:

Extend the page query to include the new columns. Find the existing `from('facebook_pages').select(...)` and change to:

```ts
const { data: pages } = await supabase
  .from('facebook_pages')
  .select(
    'id, fb_page_id, name, category, picture_url, capi_enabled, capi_dataset_id, capi_access_token, capi_test_event_code',
  )
  .eq('connection_id', conn.id)
  .order('created_at', { ascending: true })
```

Add the import at the top:

```ts
import { CapiSection } from './_components/capi-section'
```

And at the end of the `ConnectedView` branch (after `body = <ConnectedView pages={pages} />`), update it to render CAPI underneath. Replace:

```tsx
body = <ConnectedView pages={pages} />
```

with:

```tsx
const capiPages = pages.map((p) => ({
  id: p.id,
  name: p.name,
  capi_enabled: Boolean(p.capi_enabled),
  capi_dataset_id: p.capi_dataset_id,
  has_capi_token: Boolean(p.capi_access_token),
  capi_test_event_code: p.capi_test_event_code,
}))
body = (
  <>
    <ConnectedView pages={pages} />
    <CapiSection pages={capiPages} />
  </>
)
```

- [ ] **Step 4: Smoke-test by visiting the page**

Start the dev server: `pnpm dev`. Visit `/dashboard/settings/facebook`. Confirm:
- The new "Conversions API (Business Messaging)" section appears below the connected-pages list
- Each connected page has a collapsible form
- Toggling enabled + entering a dataset id + token + saving redirects back with `?capi_saved=1`
- Saving with enabled checked but no token shows the `capi_missing_token` error banner

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/dashboard/settings/facebook/_components/capi-section.tsx \
  src/app/(app)/dashboard/settings/facebook/_components/capi-page-form.tsx \
  src/app/(app)/dashboard/settings/facebook/page.tsx
git commit -m "feat(capi): settings UI section for per-page CAPI configuration"
```

---

## Task 13: Settings UI — recent events log

**Files:**
- Create: `src/app/(app)/dashboard/settings/facebook/_components/capi-recent-events.tsx`
- Modify: `src/app/(app)/dashboard/settings/facebook/_components/capi-section.tsx`
- Modify: `src/app/(app)/dashboard/settings/facebook/page.tsx`

- [ ] **Step 1: Create the recent-events component**

```tsx
type LogRow = {
  id: string
  created_at: string
  status: 'sent' | 'skipped' | 'error'
  skip_reason: string | null
  event_name: string | null
  http_status: number | null
  fb_trace_id: string | null
  page_name: string | null
  error_message: string | null
}

function statusIcon(status: LogRow['status']) {
  if (status === 'sent') return '✓'
  if (status === 'skipped') return '⊘'
  return '✗'
}

export function CapiRecentEvents({ rows }: { rows: LogRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No CAPI events yet. Submit through an action page or use "Send test event".
      </p>
    )
  }
  return (
    <ul className="space-y-1 text-sm font-mono">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-2">
          <span aria-hidden>{statusIcon(r.status)}</span>
          <time className="text-xs text-muted-foreground">
            {new Date(r.created_at).toLocaleTimeString()}
          </time>
          <span className="text-xs text-muted-foreground">{r.page_name ?? '—'}</span>
          <span>·</span>
          <span>{r.event_name ?? r.skip_reason ?? '—'}</span>
          <span>·</span>
          <span>
            {r.status === 'sent'
              ? `sent (HTTP ${r.http_status ?? '?'})`
              : r.status === 'error'
                ? `error ${r.http_status ?? ''} ${r.error_message ?? ''}`.trim()
                : `skipped (${r.skip_reason ?? '?'})`}
          </span>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: Load recent rows in `page.tsx`**

In `src/app/(app)/dashboard/settings/facebook/page.tsx`, after loading `pages`, add a query that joins logs to page names. Because RLS already restricts to the owner, we use the user-scoped supabase client:

```ts
const { data: capiLogs } = await supabase
  .from('capi_event_logs')
  .select('id, created_at, status, skip_reason, event_name, http_status, fb_trace_id, error_message, page_id')
  .eq('user_id', session.userId)
  .order('created_at', { ascending: false })
  .limit(20)

const pageNameById = new Map((pages ?? []).map((p) => [p.id, p.name]))
const recentRows = (capiLogs ?? []).map((row) => ({
  id: row.id,
  created_at: row.created_at,
  status: row.status as 'sent' | 'skipped' | 'error',
  skip_reason: row.skip_reason,
  event_name: row.event_name,
  http_status: row.http_status,
  fb_trace_id: row.fb_trace_id,
  error_message: row.error_message,
  page_name: row.page_id ? pageNameById.get(row.page_id) ?? null : null,
}))
```

Pass `recentRows` into the `CapiSection`:

```tsx
body = (
  <>
    <ConnectedView pages={pages} />
    <CapiSection pages={capiPages} recentRows={recentRows} />
  </>
)
```

- [ ] **Step 3: Extend `CapiSection` to render the log**

In `capi-section.tsx`, import the new component and add a `recentRows` prop:

```tsx
import { CapiPageForm } from './capi-page-form'
import { CapiRecentEvents } from './capi-recent-events'

type LogRow = Parameters<typeof CapiRecentEvents>[0]['rows'][number]

export function CapiSection({
  pages,
  recentRows,
}: {
  pages: Page[]
  recentRows: LogRow[]
}) {
  if (pages.length === 0) return null
  return (
    <section className="space-y-4 border-t pt-6 mt-6">
      {/* ...existing header... */}
      <div className="space-y-3">
        {pages.map((p) => (
          <CapiPageForm key={p.id} page={p} />
        ))}
      </div>
      <div className="space-y-2 pt-4 border-t">
        <h3 className="text-sm font-semibold">Recent events (last 20)</h3>
        <CapiRecentEvents rows={recentRows} />
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Smoke-test**

Start the dev server, visit the page, and confirm:
- Recent events area renders even when empty ("No CAPI events yet…")
- Clicking "Send test event" on an enabled page produces a new row (visible after page refresh / redirect)

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/dashboard/settings/facebook/_components/capi-recent-events.tsx \
  src/app/(app)/dashboard/settings/facebook/_components/capi-section.tsx \
  src/app/(app)/dashboard/settings/facebook/page.tsx
git commit -m "feat(capi): recent-events log on Settings → Facebook"
```

---

## Task 14: Per-action-page event override (schema + action + UI)

**Files:**
- Modify: `src/app/(app)/dashboard/action-pages/_lib/schemas.ts`
- Modify: `src/app/(app)/dashboard/action-pages/actions.ts`
- Modify: the action-page editor form component (see Step 3)

- [ ] **Step 1: Extend the Zod schema**

Open `src/app/(app)/dashboard/action-pages/_lib/schemas.ts`. Find the top-level action-page Zod schema and add a field:

```ts
capi_event_name_override: z
  .enum([
    'Lead', 'Schedule', 'Purchase', 'InitiateCheckout',
    'CompleteRegistration', 'Contact', 'Subscribe',
    'SubmitApplication', 'AddToCart', 'ViewContent', 'SKIP',
  ])
  .nullable()
  .optional()
  .default(null),
```

Add it to the schema object in the right place — alongside other top-level fields like `notification_template`, `pipeline_rules`, etc. Open the file first to find the right object.

- [ ] **Step 2: Plumb through the save action**

Open `src/app/(app)/dashboard/action-pages/actions.ts`. Find the update/insert path that maps Zod-parsed input to a Supabase row. Add `capi_event_name_override: parsed.capi_event_name_override ?? null` to the row payload alongside the other writeable fields. Use grep to locate:

```bash
grep -n "pipeline_rules" src/app/(app)/dashboard/action-pages/actions.ts
```

…and add the new line just below `pipeline_rules` in both the create and update payloads.

- [ ] **Step 3: Add the field to the editor UI**

Locate the editor form component. Start by:

```bash
grep -rl "pipeline_rules" src/app/\(app\)/dashboard/action-pages/_components/
```

Open the file that renders the pipeline-rules section. Below that section, add a new field. The exact component depends on what's already used in the editor (shadcn `<Select>` or a plain `<select>` — match the surrounding code). Pseudocode if it's a plain `<select>`:

```tsx
import { KIND_REGISTRY } from '@/lib/action-pages/kinds'

// Inside the editor, where `kind` is in scope:
const kindDefaultLabel = {
  form: 'Lead',
  booking: 'Schedule',
  qualification: 'Lead',
  sales: 'InitiateCheckout / Purchase',
  catalog: 'InitiateCheckout / Purchase',
  realestate: 'Lead / Schedule',
}[kind] ?? 'Lead'

<label className="block text-sm">
  <span className="block mb-1">Send to Facebook as</span>
  <select
    name="capi_event_name_override"
    defaultValue={form.capi_event_name_override ?? ''}
    className="w-full border rounded px-2 py-1"
  >
    <option value="">Use default ({kindDefaultLabel})</option>
    <option value="Lead">Lead</option>
    <option value="Schedule">Schedule</option>
    <option value="Purchase">Purchase</option>
    <option value="InitiateCheckout">InitiateCheckout</option>
    <option value="CompleteRegistration">CompleteRegistration</option>
    <option value="Contact">Contact</option>
    <option value="Subscribe">Subscribe</option>
    <option value="SubmitApplication">SubmitApplication</option>
    <option value="AddToCart">AddToCart</option>
    <option value="ViewContent">ViewContent</option>
    <option value="SKIP">Don't send</option>
  </select>
  <p className="text-xs text-muted-foreground mt-1">
    When a Messenger lead submits this page, we tell Facebook what kind of conversion happened.
    Choose "Don't send" to skip this page entirely.
  </p>
</label>
```

The empty-string `""` option maps to `null` in the schema because `z.enum().nullable().optional()` only accepts the enum values; convert `""` to `null` either by parsing the form data before validation or by adapting the option value to a sentinel like `__default__`. Inspect the existing form to see how other nullable selects are handled and follow that pattern.

- [ ] **Step 4: Verify the editor saves the field**

Start dev server, open an action page in the editor, change the dropdown, save, reload the editor, confirm the value persists.

Then verify via psql:

```bash
psql "$DATABASE_URL" -c "select id, slug, capi_event_name_override from public.action_pages order by updated_at desc limit 5;"
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm exec tsc --noEmit` and `pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/_lib/schemas.ts \
  src/app/\(app\)/dashboard/action-pages/actions.ts \
  src/app/\(app\)/dashboard/action-pages/_components/
git commit -m "feat(capi): per-action-page event_name override in editor"
```

---

## Task 15: End-to-end manual verification

This task is not a code change — it's the manual smoke test from the spec's "Manual verification before claiming done" section.

- [ ] **Step 1: Apply migration to a fresh local DB**

Run: `pnpm supabase db reset`
Expected: all migrations apply cleanly through the new one.

- [ ] **Step 2: Generate real CAPI credentials in Meta Events Manager**

Using a dev/test Meta Business Manager account:
1. Open Events Manager → Data Sources → your Dataset (or create one)
2. Settings → Conversions API → Generate Access Token
3. Test Events → copy the `TEST12345`-style code

- [ ] **Step 3: Configure CAPI on a Page via the new Settings UI**

In the dashboard at `/dashboard/settings/facebook`, expand the page, paste the dataset ID + access token + test event code, check "Enabled", Save.

Expected: redirect with `?capi_saved=1`; row in `facebook_pages` updated; `capi_access_token` is an encrypted blob in DB (verify with `psql`).

- [ ] **Step 4: Send test event from the UI**

Click "Send test event". Expected:
- Redirect with `?capi_test=1`
- New row in `capi_event_logs` with `status='sent'` and an `fb_trace_id`
- Event appears in Meta Events Manager → Test Events tab within ~30 seconds

- [ ] **Step 5: Submit through each kind via real Messenger deeplink**

For each of the six action-page kinds (form, booking, qualification, sales, catalog, realestate):
1. Open Messenger, get a deeplink from the chatbot (or build one with `buildDeeplinkParams` in a debug script)
2. Submit the public action page with that deeplink in the URL
3. Confirm `capi_event_logs` shows `status='sent'`, the expected `event_name`, and a non-null `fb_trace_id`
4. Confirm Meta Events Manager → Test Events shows the event

For catalog and sales: try both with and without payment. Verify `event_name` switches between `InitiateCheckout` and `Purchase`.
For qualification: confirm `disqualified` produces `skipped/outcome_skip` (no Meta call).

- [ ] **Step 6: Negative path — disabled page**

Toggle `capi_enabled` off, submit again. Expected: log row with `status='skipped'`, `skip_reason='disabled'`. No fetch in network tab.

- [ ] **Step 7: Negative path — direct URL (no deeplink)**

Visit an action page URL without the deeplink params, submit. Expected: log row with `skip_reason='no_messenger_context'`.

- [ ] **Step 8: Document any field-name discrepancies**

If Meta's test-events tab shows the event but flags any field as "missing" or "wrong format", update the dispatcher and/or payload builder to match. Common spots:
- `messaging_channel` literal — Meta may want `MESSENGER` instead of `messenger`
- trace id header name — could be `x-fb-trace-id`, `x-fbtrace-id`, or only in body
- `event_source_url` may be rejected for business_messaging — drop if so

Open a follow-up PR for any tweaks.

---

## Self-Review Notes

Coverage check against the spec:

- ✅ **Trigger scope** — Task 7 implements the psid+pageRowId guard.
- ✅ **Event-name mapping + override** — Tasks 2, 7, 8, 14.
- ✅ **PII hashing (em/ph/fn/ln/external_id)** — Tasks 3, 4.
- ✅ **custom_data per kind** — Task 5.
- ✅ **Event envelope (`action_source: business_messaging`, `messaging_channel: messenger`)** — Task 6.
- ✅ **Network POST + log** — Task 8.
- ✅ **CatalogOrderResult shape extension** — Task 9.
- ✅ **Call site in submit route** — Task 10.
- ✅ **DB migration (facebook_pages cols, action_pages col, capi_event_logs)** — Task 1.
- ✅ **Settings UI (section + per-page form + save + test event)** — Tasks 11, 12.
- ✅ **Recent events log** — Task 13.
- ✅ **Per-action-page override UI** — Task 14.
- ✅ **Manual verification** — Task 15.
- ✅ **v2 ad attribution explicitly out of scope** — captured in spec, no tasks here.

No placeholders. Type names match across tasks: `CapiStandardEvent`, `MappingInput`, `MappingResult`, `UserData`, `CustomData`, `CapiEvent`, `CatalogOrderForCapi`, `DispatchInput`, `LogRow` all defined once and referenced consistently.
