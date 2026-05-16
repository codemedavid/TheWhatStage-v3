# Action Page Payment Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual proof-of-payment checkout to sales pages and catalog pages: per-page toggle, payment-method exclusion list, required screenshot upload to ImageKit, and a new `order_payments` table with admin verification.

**Architecture:** New `order_payments` table (one row per submission) with a trigger that syncs `business_orders.payment_status`. Per-page `payment` config block in action page configs. Reuses existing payment-method dashboard, existing submit endpoint, existing ImageKit upload pattern.

**Tech Stack:** Next.js App Router, Supabase Postgres + RLS, Zod, ImageKit, Vitest, React 19, TypeScript.

**Spec:** `docs/superpowers/specs/2026-05-16-action-page-payment-checkout-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/<ts>_order_payments.sql` | new | Table, indexes, RLS, trigger |
| `src/lib/order-payments/types.ts` | new | `OrderPayment`, `OrderPaymentStatus`, snapshot fields |
| `src/lib/order-payments/server.ts` | new | `createFromSubmission`, `verifyPayment`, `rejectPayment`, `listForSubmissionIds` |
| `src/lib/order-payments/server.test.ts` | new | Unit tests for the helpers (filter/snapshot logic) |
| `src/lib/payment-methods/public.ts` | modify | Add `loadEnabledPaymentMethodsForPage(userId, excludedIds)` |
| `src/lib/payment-methods/public.test.ts` | new | Test exclusion + ordering |
| `src/lib/action-pages/handlers/catalog.ts` | modify | Extend `CatalogSubmissionPayload` with `payment_proof_url`, `payment_proof_file_id`, `payment_amount`, `payment_note` |
| `src/lib/action-pages/handlers/catalog.test.ts` | modify | Cover new fields |
| `src/app/a/[slug]/_kinds/sales/schema.ts` | modify | Add `payment` block to `SalesConfig` |
| `src/app/a/[slug]/_kinds/sales/schema.test.ts` | new (or extend if exists) | Cover payment block defaults |
| `src/app/api/action-pages/[slug]/payment-proofs/route.ts` | new | ImageKit upload for buyer payment proofs |
| `src/app/api/action-pages/submit/route.ts` | modify | Validate payment fields, insert `order_payments`, fail catalog if proof missing |
| `src/app/a/[slug]/_kinds/sales/Renderer.tsx` | modify | Server-load payment methods, render `<SalesPaymentBlock>` |
| `src/app/a/[slug]/_kinds/sales/PaymentBlockClient.tsx` | new | Buyer-side payment client component (method picker + upload + form) |
| `src/app/a/[slug]/_kinds/catalog/Renderer.tsx` | modify | Add required screenshot upload + optional note in cart drawer |
| `src/app/a/[slug]/_kinds/types.ts` | modify (if needed) | Extend `KindRendererProps` for sales payment methods (already has `paymentMethods`) |
| `src/app/a/[slug]/page.tsx` | modify | Pass `paymentMethods` to sales renderer (currently only passed to catalog) |
| `src/app/(app)/dashboard/action-pages/_components/PaymentSettingsPanel.tsx` | new | Shared editor panel (toggle + exclusion checkboxes) |
| `src/app/(app)/dashboard/action-pages/_kinds/sales/Editor.tsx` | modify | Insert `<PaymentSettingsPanel>` |
| `src/app/(app)/dashboard/action-pages/_kinds/catalog/Editor.tsx` | modify | Replace existing payment-method picker; apply read-time shim |
| `src/app/(app)/dashboard/action-pages/_lib/payment-shim.ts` | new | Catalog `payment_method_ids` → `payment.excluded_method_ids` shim + tests |
| `src/app/(app)/dashboard/action-pages/_lib/payment-shim.test.ts` | new | Unit tests for the shim |
| `src/app/(app)/dashboard/action-pages/[id]/submissions/payment-actions.ts` | new | `verifyPayment`, `rejectPayment` server actions |
| `src/app/(app)/dashboard/action-pages/[id]/submissions/CatalogOrdersView.tsx` | modify | Payment column + Mark paid / Reject UI |
| `src/app/(app)/dashboard/action-pages/[id]/submissions/SalesPaymentsView.tsx` | new | Sales-page payments table |
| `src/app/(app)/dashboard/action-pages/[id]/submissions/page.tsx` | modify | Render `<SalesPaymentsView>` for sales kind |

---

## Task 1: DB migration — `order_payments` table + trigger

**Files:**
- Create: `supabase/migrations/20260516000000_order_payments.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260516000000_order_payments.sql

create table public.order_payments (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  submission_id        uuid not null references public.action_page_submissions(id) on delete cascade,
  business_order_id    uuid references public.business_orders(id) on delete set null,
  action_page_id       uuid not null references public.action_pages(id) on delete cascade,
  payment_method_id    uuid not null references public.payment_methods(id) on delete restrict,

  method_kind          text not null,
  method_name          text not null,

  proof_url            text not null,
  proof_file_id        text,
  amount               numeric(12,2) check (amount is null or amount >= 0),
  currency             text check (currency is null or currency ~ '^[A-Z]{3}$'),
  note                 text check (note is null or char_length(note) <= 2000),

  status               text not null default 'submitted'
                         check (status in ('submitted','verified','rejected')),
  verified_at          timestamptz,
  verified_by          uuid references auth.users(id) on delete set null,
  rejection_reason     text check (rejection_reason is null or char_length(rejection_reason) <= 500),

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index order_payments_submission_uniq on public.order_payments (submission_id);
create index        order_payments_user_idx        on public.order_payments (user_id, created_at desc);
create index        order_payments_status_idx      on public.order_payments (user_id, status, created_at desc);
create index        order_payments_order_idx       on public.order_payments (business_order_id)
  where business_order_id is not null;

alter table public.order_payments enable row level security;

create policy "order_payments owner select"
  on public.order_payments for select
  using (auth.uid() = user_id);

create policy "order_payments owner update"
  on public.order_payments for update
  using (auth.uid() = user_id);

create or replace function public._order_payments_sync_business_order()
returns trigger language plpgsql as $$
begin
  if new.business_order_id is null then return new; end if;
  if (tg_op = 'INSERT') or (new.status is distinct from old.status) then
    update public.business_orders
       set payment_status = case new.status
                              when 'verified' then 'paid'
                              when 'rejected' then 'failed'
                              else 'pending'
                            end,
           updated_at     = now()
     where id = new.business_order_id;
  end if;
  return new;
end;
$$;

create trigger order_payments_sync_business_order
after insert or update of status on public.order_payments
for each row execute function public._order_payments_sync_business_order();

create or replace function public._order_payments_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

create trigger order_payments_touch_updated_at
before update on public.order_payments
for each row execute function public._order_payments_touch_updated_at();
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `order_payments` and the SQL body above.

- [ ] **Step 3: Verify schema**

Run `mcp__supabase__list_tables` and confirm `order_payments` is present with all columns.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260516000000_order_payments.sql
git commit -m "feat(db): order_payments table with business_orders status trigger"
```

---

## Task 2: `order-payments` lib — types

**Files:**
- Create: `src/lib/order-payments/types.ts`

- [ ] **Step 1: Write the file**

```ts
// src/lib/order-payments/types.ts
import type { PaymentMethodKind } from '@/lib/payment-methods/types'

export type OrderPaymentStatus = 'submitted' | 'verified' | 'rejected'

export interface OrderPayment {
  id: string
  user_id: string
  submission_id: string
  business_order_id: string | null
  action_page_id: string
  payment_method_id: string

  method_kind: PaymentMethodKind
  method_name: string

  proof_url: string
  proof_file_id: string | null
  amount: number | null
  currency: string | null
  note: string | null

  status: OrderPaymentStatus
  verified_at: string | null
  verified_by: string | null
  rejection_reason: string | null

  created_at: string
  updated_at: string
}

export interface CreateOrderPaymentInput {
  user_id: string
  submission_id: string
  business_order_id: string | null
  action_page_id: string
  payment_method_id: string
  method_kind: PaymentMethodKind
  method_name: string
  proof_url: string
  proof_file_id: string | null
  amount: number | null
  currency: string | null
  note: string | null
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/order-payments/types.ts
git commit -m "feat(order-payments): add types"
```

---

## Task 3: `order-payments` lib — server helpers + tests

**Files:**
- Create: `src/lib/order-payments/server.ts`
- Create: `src/lib/order-payments/server.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/order-payments/server.test.ts
import { describe, expect, it, vi } from 'vitest'
import { resolveStatusForOrder, snapshotMethod } from './server'

describe('snapshotMethod', () => {
  it('returns kind + name from a payment method row', () => {
    const snap = snapshotMethod({
      id: 'm1', kind: 'gcash', name: 'My GCash',
    })
    expect(snap).toEqual({ method_kind: 'gcash', method_name: 'My GCash' })
  })
})

describe('resolveStatusForOrder', () => {
  it('maps submitted to pending', () => {
    expect(resolveStatusForOrder('submitted')).toBe('pending')
  })
  it('maps verified to paid', () => {
    expect(resolveStatusForOrder('verified')).toBe('paid')
  })
  it('maps rejected to failed', () => {
    expect(resolveStatusForOrder('rejected')).toBe('failed')
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
pnpm vitest run src/lib/order-payments/server.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `server.ts`**

```ts
// src/lib/order-payments/server.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CreateOrderPaymentInput,
  OrderPayment,
  OrderPaymentStatus,
} from './types'
import type { PaymentMethod, PaymentMethodKind } from '@/lib/payment-methods/types'

export function snapshotMethod(m: Pick<PaymentMethod, 'kind' | 'name'>) {
  return { method_kind: m.kind, method_name: m.name }
}

export function resolveStatusForOrder(
  s: OrderPaymentStatus,
): 'pending' | 'paid' | 'failed' {
  if (s === 'verified') return 'paid'
  if (s === 'rejected') return 'failed'
  return 'pending'
}

export async function createFromSubmission(
  admin: SupabaseClient,
  input: CreateOrderPaymentInput,
): Promise<OrderPayment> {
  const { data, error } = await admin
    .from('order_payments')
    .insert(input)
    .select('*')
    .single<OrderPayment>()
  if (error || !data) {
    throw new Error(`order_payments insert failed: ${error?.message}`)
  }
  return data
}

export async function verifyPayment(
  admin: SupabaseClient,
  id: string,
  userId: string,
  verifiedBy: string,
): Promise<void> {
  const { error } = await admin
    .from('order_payments')
    .update({
      status: 'verified',
      verified_at: new Date().toISOString(),
      verified_by: verifiedBy,
      rejection_reason: null,
    })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`verifyPayment: ${error.message}`)
}

export async function rejectPayment(
  admin: SupabaseClient,
  id: string,
  userId: string,
  reason: string,
): Promise<void> {
  const r = reason.trim().slice(0, 500)
  if (!r) throw new Error('Rejection reason required.')
  const { error } = await admin
    .from('order_payments')
    .update({ status: 'rejected', rejection_reason: r })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`rejectPayment: ${error.message}`)
}

export async function listBySubmissionIds(
  admin: SupabaseClient,
  userId: string,
  submissionIds: string[],
): Promise<Map<string, OrderPayment>> {
  if (!submissionIds.length) return new Map()
  const { data, error } = await admin
    .from('order_payments')
    .select('*')
    .eq('user_id', userId)
    .in('submission_id', submissionIds)
  if (error || !data) return new Map()
  const map = new Map<string, OrderPayment>()
  for (const row of data as OrderPayment[]) map.set(row.submission_id, row)
  return map
}

export type { PaymentMethodKind }
```

- [ ] **Step 4: Re-run the test, confirm it passes**

```bash
pnpm vitest run src/lib/order-payments/server.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/order-payments/
git commit -m "feat(order-payments): server helpers with status mapping"
```

---

## Task 4: `loadEnabledPaymentMethodsForPage` helper + test

**Files:**
- Modify: `src/lib/payment-methods/public.ts`
- Create: `src/lib/payment-methods/public.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/payment-methods/public.test.ts
import { describe, expect, it } from 'vitest'
import { filterAllowedIds } from './public'

describe('filterAllowedIds', () => {
  it('returns all when no exclusions', () => {
    expect(filterAllowedIds(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c'])
  })
  it('drops excluded ids and preserves order', () => {
    expect(filterAllowedIds(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c'])
  })
  it('dedupes the exclusion set', () => {
    expect(filterAllowedIds(['a', 'b'], ['a', 'a'])).toEqual(['b'])
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
pnpm vitest run src/lib/payment-methods/public.test.ts
```
Expected: FAIL (`filterAllowedIds` not exported).

- [ ] **Step 3: Add helper to `public.ts`**

Append to `src/lib/payment-methods/public.ts`:

```ts
export function filterAllowedIds(allIds: string[], excluded: string[]): string[] {
  const set = new Set(excluded)
  return allIds.filter((id) => !set.has(id))
}

/**
 * Load all enabled payment methods for a user, minus excluded ids.
 * Used at SSR time on sales/catalog action pages when the page-level
 * payment block has no explicit include list.
 */
export async function loadEnabledPaymentMethodsForPage(
  userId: string,
  excluded: string[],
): Promise<PublicPaymentMethod[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('payment_methods')
    .select('id, kind, name, instructions, details, enabled, position')
    .eq('user_id', userId)
    .eq('enabled', true)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error || !data) return []
  const set = new Set(excluded)
  const out: PublicPaymentMethod[] = []
  for (const r of data as (Row & { position: number })[]) {
    if (set.has(r.id)) continue
    out.push({
      id: r.id,
      kind: r.kind,
      name: r.name,
      instructions: r.instructions,
      account_name: pick(r.details, 'account_name'),
      account_number: pick(r.details, 'account_number'),
      bank_name: pick(r.details, 'bank_name'),
      branch: pick(r.details, 'branch'),
      qr_image_url: pick(r.details, 'qr_image_url'),
    })
  }
  return out
}
```

- [ ] **Step 4: Re-run the test, confirm it passes**

```bash
pnpm vitest run src/lib/payment-methods/public.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payment-methods/
git commit -m "feat(payment-methods): loadEnabledPaymentMethodsForPage helper"
```

---

## Task 5: Catalog submission payload — accept new payment fields + tests

**Files:**
- Modify: `src/lib/action-pages/handlers/catalog.ts`
- Modify: `src/lib/action-pages/handlers/catalog.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `catalog.test.ts`:

```ts
it('parses payment proof fields', () => {
  const parsed = parseCatalogSubmission({
    items: JSON.stringify([
      { id: '00000000-0000-4000-8000-000000000001', quantity: 1 },
    ]),
    payment_method_id: '00000000-0000-4000-8000-000000000011',
    payment_proof_url: 'https://ik.imagekit.io/foo/proof.jpg',
    payment_proof_file_id: 'file_abc',
    payment_amount: '199.50',
    payment_note: 'paid via GCash',
  })
  expect(parsed.data.payment_method_id).toBe('00000000-0000-4000-8000-000000000011')
  expect(parsed.data.payment_proof_url).toBe('https://ik.imagekit.io/foo/proof.jpg')
  expect(parsed.data.payment_proof_file_id).toBe('file_abc')
  expect(parsed.data.payment_amount).toBe(199.5)
  expect(parsed.data.payment_note).toBe('paid via GCash')
})

it('rejects payment_method_id without a proof url', () => {
  expect(() =>
    parseCatalogSubmission({
      items: JSON.stringify([
        { id: '00000000-0000-4000-8000-000000000001', quantity: 1 },
      ]),
      payment_method_id: '00000000-0000-4000-8000-000000000011',
    }),
  ).toThrow(/payment proof/i)
})
```

- [ ] **Step 2: Run, confirm fails**

```bash
pnpm vitest run src/lib/action-pages/handlers/catalog.test.ts
```
Expected: FAIL on the two new cases.

- [ ] **Step 3: Extend the zod schema and parser**

In `catalog.ts`, extend `CatalogSubmissionPayload`:

```ts
export const CatalogSubmissionPayload = z.object({
  items: /* unchanged */,
  customer_name: z.string().trim().max(160).optional(),
  customer_email: z.string().trim().max(320).optional(),
  customer_phone: z.string().trim().max(40).optional(),
  customer_notes: z.string().trim().max(2000).optional(),
  payment_method_id: z.string().uuid().optional(),
  payment_proof_url: z.string().url().max(2048).optional(),
  payment_proof_file_id: z.string().max(256).optional(),
  payment_amount: z.coerce.number().min(0).optional(),
  payment_note: z.string().trim().max(2000).optional(),
  custom: /* unchanged */,
})
```

In `parseCatalogSubmission` (the function that turns parsed payload into `ParsedSubmission`), after method validation add:

```ts
if (parsed.payment_method_id && !parsed.payment_proof_url) {
  throw new Error('payment proof is required when a payment method is selected')
}
```

And include the new fields in the returned `data` object:

```ts
return {
  outcome: 'checked_out',
  data: {
    items: parsed.items,
    customer: { /* unchanged */ },
    custom: validatedCustom,
    payment_method_id: parsed.payment_method_id ?? null,
    payment_proof_url: parsed.payment_proof_url ?? null,
    payment_proof_file_id: parsed.payment_proof_file_id ?? null,
    payment_amount: parsed.payment_amount ?? null,
    payment_note: parsed.payment_note ?? null,
  },
}
```

(Match the existing return shape — only the changed/new keys are shown.)

- [ ] **Step 4: Re-run tests**

```bash
pnpm vitest run src/lib/action-pages/handlers/catalog.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/action-pages/handlers/catalog.ts src/lib/action-pages/handlers/catalog.test.ts
git commit -m "feat(catalog): accept payment proof fields in checkout submission"
```

---

## Task 6: Sales config schema — payment block

**Files:**
- Modify: `src/app/a/[slug]/_kinds/sales/schema.ts`
- Create: `src/app/a/[slug]/_kinds/sales/schema.test.ts` (or extend the existing test if present)

- [ ] **Step 1: Inspect current schema**

Read `src/app/a/[slug]/_kinds/sales/schema.ts` and locate the `parseSalesConfig` function and `SalesConfig` type.

- [ ] **Step 2: Write the failing test**

```ts
// src/app/a/[slug]/_kinds/sales/schema.test.ts
import { describe, expect, it } from 'vitest'
import { parseSalesConfig } from './schema'

describe('parseSalesConfig payment block', () => {
  it('defaults payment.enabled to true when missing', () => {
    const cfg = parseSalesConfig({})
    expect(cfg.payment.enabled).toBe(true)
    expect(cfg.payment.excluded_method_ids).toEqual([])
  })

  it('honors explicit disable', () => {
    const cfg = parseSalesConfig({ payment: { enabled: false } })
    expect(cfg.payment.enabled).toBe(false)
  })

  it('keeps excluded ids as a string array', () => {
    const cfg = parseSalesConfig({
      payment: { excluded_method_ids: ['m1', 'm2', 5 as unknown as string] },
    })
    expect(cfg.payment.excluded_method_ids).toEqual(['m1', 'm2'])
  })
})
```

- [ ] **Step 3: Run, confirm fails**

```bash
pnpm vitest run src/app/a/\[slug\]/_kinds/sales/schema.test.ts
```
Expected: FAIL (`cfg.payment` undefined).

- [ ] **Step 4: Extend `SalesConfig` + `parseSalesConfig`**

Add to the `SalesConfig` type:

```ts
payment: {
  enabled: boolean
  excluded_method_ids: string[]
}
```

In `parseSalesConfig`, after existing block parsing, add:

```ts
const rawPayment =
  raw && typeof raw === 'object' && 'payment' in (raw as object)
    ? ((raw as Record<string, unknown>).payment as Record<string, unknown>)
    : null
const paymentEnabled = rawPayment?.enabled === false ? false : true
const paymentExcluded = Array.isArray(rawPayment?.excluded_method_ids)
  ? (rawPayment!.excluded_method_ids as unknown[]).filter(
      (x): x is string => typeof x === 'string' && x.length > 0,
    )
  : []
// then add `payment: { enabled: paymentEnabled, excluded_method_ids: paymentExcluded }` to the returned config.
```

- [ ] **Step 5: Re-run tests**

```bash
pnpm vitest run src/app/a/\[slug\]/_kinds/sales/schema.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/a/\[slug\]/_kinds/sales/schema.ts src/app/a/\[slug\]/_kinds/sales/schema.test.ts
git commit -m "feat(sales): payment block in SalesConfig"
```

---

## Task 7: Payment-proof upload route (clones customer-images)

**Files:**
- Create: `src/app/api/action-pages/[slug]/payment-proofs/route.ts`

- [ ] **Step 1: Write the file**

```ts
// src/app/api/action-pages/[slug]/payment-proofs/route.ts
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getImageKit } from '@/lib/imagekit/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 5 * 1024 * 1024

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params
  const admin = createAdminClient()
  const { data: page } = await admin
    .from('action_pages')
    .select('id, status')
    .eq('slug', slug)
    .maybeSingle<{ id: string; status: string }>()
  if (!page || page.status !== 'published') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File))
    return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (!ALLOWED.has(file.type))
    return NextResponse.json(
      { error: 'unsupported image type — use JPEG, PNG, or WebP' },
      { status: 400 },
    )
  if (file.size > MAX_BYTES)
    return NextResponse.json({ error: 'image too large (max 5 MB)' }, { status: 400 })

  const imagekit = getImageKit()
  const buffer = Buffer.from(await file.arrayBuffer())
  const ext =
    file.type === 'image/webp' ? 'webp' :
    file.type === 'image/png'  ? 'png'  : 'jpg'
  const fileName = `payment-${Date.now()}.${ext}`

  const result = await imagekit.upload({
    file: buffer,
    fileName,
    folder: `/action-pages/${page.id}/payment-proofs`,
    useUniqueFileName: true,
  })

  return NextResponse.json({ url: result.url, fileId: result.fileId })
}
```

- [ ] **Step 2: Sanity-check with curl (optional)**

Run the dev server (`pnpm dev`) and POST a small PNG to a published slug. Confirm 200 with `{url, fileId}`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/action-pages/\[slug\]/payment-proofs/route.ts
git commit -m "feat(api): payment-proof upload route"
```

---

## Task 8: Submit route — payment validation + order_payments insert

**Files:**
- Modify: `src/app/api/action-pages/submit/route.ts`

- [ ] **Step 1: Locate the post-insert site**

After the existing `action_page_submissions` insert (around line 372–402 in the current file). The new logic runs only when `subInsert?.id` is defined.

- [ ] **Step 2: Add payment validation and insert**

Insert a new block immediately after the submission insert and before the workflow dispatch (around line ~430). Imports at top of file:

```ts
import { createFromSubmission, snapshotMethod } from '@/lib/order-payments/server'
import type { PaymentMethod } from '@/lib/payment-methods/types'
```

New block:

```ts
// Payment proof handling — applies when the buyer selected a payment method.
const paymentMethodId =
  typeof parsed.data.payment_method_id === 'string'
    ? parsed.data.payment_method_id
    : null
if (subInsert?.id && paymentMethodId) {
  const proofUrl =
    typeof parsed.data.payment_proof_url === 'string'
      ? parsed.data.payment_proof_url
      : null
  if (!proofUrl) {
    return NextResponse.json(
      { error: 'payment_proof_required' },
      { status: 400 },
    )
  }

  const cfgPayment =
    (page.config as Record<string, unknown>).payment as
      | { enabled?: boolean; excluded_method_ids?: string[] }
      | undefined
  const excluded = new Set(cfgPayment?.excluded_method_ids ?? [])
  if (cfgPayment?.enabled === false || excluded.has(paymentMethodId)) {
    return NextResponse.json(
      { error: 'payment_method_not_allowed' },
      { status: 400 },
    )
  }

  const { data: pm } = await admin
    .from('payment_methods')
    .select('id, kind, name, enabled, user_id')
    .eq('id', paymentMethodId)
    .maybeSingle<Pick<PaymentMethod, 'id' | 'kind' | 'name' | 'enabled'> & { user_id: string }>()
  if (!pm || !pm.enabled || pm.user_id !== page.user_id) {
    return NextResponse.json(
      { error: 'payment_method_not_found' },
      { status: 400 },
    )
  }

  try {
    await createFromSubmission(admin, {
      user_id: page.user_id,
      submission_id: subInsert.id,
      business_order_id: businessOrderId,
      action_page_id: page.id,
      payment_method_id: pm.id,
      ...snapshotMethod(pm),
      proof_url: proofUrl,
      proof_file_id:
        typeof parsed.data.payment_proof_file_id === 'string'
          ? parsed.data.payment_proof_file_id
          : null,
      amount:
        typeof parsed.data.payment_amount === 'number'
          ? parsed.data.payment_amount
          : null,
      currency:
        typeof parsed.data.payment_currency === 'string'
          ? parsed.data.payment_currency
          : null,
      note:
        typeof parsed.data.payment_note === 'string'
          ? parsed.data.payment_note
          : null,
    })
  } catch (e) {
    console.error('[action-pages.submit] order_payments insert failed', e)
    return NextResponse.json(
      { error: 'payment_record_failed' },
      { status: 500 },
    )
  }
}
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 4: Manual smoke**

Submit a JSON payload locally with `payment_method_id` + `payment_proof_url` and confirm a row appears in `order_payments` and (for catalog) `business_orders.payment_status = 'pending'`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/action-pages/submit/route.ts
git commit -m "feat(submit): validate payment fields and insert order_payments"
```

---

## Task 9: Sales Renderer — load + render payment block

**Files:**
- Modify: `src/app/a/[slug]/_kinds/sales/Renderer.tsx`
- Modify: `src/app/a/[slug]/page.tsx` (pass paymentMethods to sales renderer; load via `loadEnabledPaymentMethodsForPage`)

- [ ] **Step 1: Update `page.tsx`**

Find the existing branch that picks the sales renderer. Above the renderer call, load payment methods:

```ts
import { loadEnabledPaymentMethodsForPage } from '@/lib/payment-methods/public'
// ...
const salesPayment = (result.page.config as { payment?: { enabled?: boolean; excluded_method_ids?: string[] } }).payment
const salesPaymentMethods =
  result.page.kind === 'sales' && salesPayment?.enabled !== false
    ? await loadEnabledPaymentMethodsForPage(
        result.page.user_id,
        salesPayment?.excluded_method_ids ?? [],
      )
    : []
```

Pass `paymentMethods={salesPaymentMethods}` to the sales `Renderer`.

- [ ] **Step 2: Update sales `Renderer.tsx` signature**

Accept `paymentMethods` and pass it through to the new client component. After the main card and before the closing `</main>`, add:

```tsx
import PaymentBlockClient from './PaymentBlockClient'
// ...
{config.payment.enabled && props.paymentMethods && props.paymentMethods.length > 0 ? (
  <section className="rounded-2xl border border-[#E5E7EB] bg-white p-5 sm:p-7">
    <PaymentBlockClient
      slug={props.page.slug}
      pageId={props.page.id}
      methods={props.paymentMethods}
      accent={config.theme.accent_color}
      claims={props.claims}
      rawToken={props.rawToken}
      defaultCurrency={config.product.currency ?? 'PHP'}
    />
  </section>
) : null}
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```
Expected: PASS once Task 10 lands. If it fails on missing `PaymentBlockClient`, proceed to Task 10 then re-check.

- [ ] **Step 4: Commit**

```bash
git add src/app/a/\[slug\]/_kinds/sales/Renderer.tsx src/app/a/\[slug\]/page.tsx
git commit -m "feat(sales): server-load payment methods and render block"
```

---

## Task 10: `PaymentBlockClient` — buyer-side sales payment UI

**Files:**
- Create: `src/app/a/[slug]/_kinds/sales/PaymentBlockClient.tsx`

- [ ] **Step 1: Write the client component**

```tsx
'use client'
import { useState } from 'react'
import type { PublicPaymentMethod } from '@/lib/payment-methods/public'

interface Claims { psid: string; pageId: string; exp: number }

interface Props {
  slug: string
  pageId: string
  methods: PublicPaymentMethod[]
  accent: string
  claims: Claims | null
  rawToken: string | null
  defaultCurrency: string
}

export default function PaymentBlockClient({
  slug, methods, accent, claims, rawToken, defaultCurrency,
}: Props) {
  const [methodId, setMethodId] = useState<string>(methods.length === 1 ? methods[0].id : '')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(defaultCurrency)
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [note, setNote] = useState('')
  const [proofUrl, setProofUrl] = useState('')
  const [proofFileId, setProofFileId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const selected = methods.find((m) => m.id === methodId) ?? null
  const ready =
    !!methodId && Number(amount) > 0 && name.trim() && contact.trim() && !!proofUrl

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/action-pages/${slug}/payment-proofs`, {
        method: 'POST', body: fd,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'upload_failed')
      setProofUrl(body.url); setProofFileId(body.fileId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload_failed')
    } finally {
      setUploading(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready) return
    setSubmitting(true); setError(null)
    try {
      const fd = new FormData()
      fd.append('slug', slug)
      if (claims) {
        fd.append('p', claims.psid)
        fd.append('g', claims.pageId)
        fd.append('e', String(claims.exp))
        if (rawToken) fd.append('t', rawToken)
      }
      fd.append('data.payment_method_id', methodId)
      fd.append('data.payment_proof_url', proofUrl)
      fd.append('data.payment_proof_file_id', proofFileId)
      fd.append('data.payment_amount', amount)
      fd.append('data.payment_currency', currency)
      fd.append('data.payment_note', note)
      fd.append('data.contact_name', name)
      fd.append('data.contact_phone', contact)
      fd.append('outcome', 'payment_submitted')

      const res = await fetch('/api/action-pages/submit', { method: 'POST', body: fd })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? 'submit_failed')
      }
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'submit_failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <p className="text-lg font-semibold">Thanks — we’ve received your payment proof.</p>
        <p className="mt-1 text-sm text-gray-600">We’ll confirm shortly.</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <h3 className="text-lg font-semibold">Proceed to payment</h3>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Payment method</legend>
        {methods.map((m) => (
          <label
            key={m.id}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3"
            style={methodId === m.id ? { borderColor: accent, background: `${accent}10` } : undefined}
          >
            <input
              type="radio" name="method" className="mt-1"
              checked={methodId === m.id}
              onChange={() => setMethodId(m.id)}
            />
            <div className="flex-1">
              <div className="font-medium">{m.name}</div>
              {m.account_name ? <div className="text-xs text-gray-600">{m.account_name}</div> : null}
              {m.account_number ? <div className="text-xs text-gray-600">{m.account_number}</div> : null}
              {m.instructions ? (
                <p className="mt-1 whitespace-pre-line text-xs text-gray-700">{m.instructions}</p>
              ) : null}
              {m.qr_image_url ? (
                <img src={m.qr_image_url} alt="QR" className="mt-2 h-32 w-32 rounded border" />
              ) : null}
            </div>
          </label>
        ))}
      </fieldset>

      <div className="grid grid-cols-[1fr_120px] gap-2">
        <label className="grid gap-1 text-sm">
          Amount
          <input
            type="number" min="0" step="0.01" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="rounded border border-gray-300 p-2"
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          Currency
          <input
            value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            className="rounded border border-gray-300 p-2"
            required
          />
        </label>
      </div>

      <label className="grid gap-1 text-sm">
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)}
               className="rounded border border-gray-300 p-2" required />
      </label>
      <label className="grid gap-1 text-sm">
        Phone or email
        <input value={contact} onChange={(e) => setContact(e.target.value)}
               className="rounded border border-gray-300 p-2" required />
      </label>

      <label className="grid gap-1 text-sm">
        Payment screenshot (required)
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile} />
        {uploading ? <span className="text-xs">Uploading…</span> : null}
        {proofUrl ? (
          <img src={proofUrl} alt="Proof" className="mt-1 h-32 w-32 rounded border object-cover" />
        ) : null}
      </label>

      <label className="grid gap-1 text-sm">
        Note (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)}
                  className="rounded border border-gray-300 p-2" maxLength={500} />
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={!ready || submitting || uploading}
        className="rounded-lg px-4 py-2 font-semibold text-white disabled:opacity-50"
        style={{ background: accent }}
      >
        {submitting ? 'Submitting…' : 'Submit payment proof'}
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/a/\[slug\]/_kinds/sales/PaymentBlockClient.tsx
git commit -m "feat(sales): payment block client UI with imagekit upload"
```

---

## Task 11: Catalog Renderer — required upload field in cart drawer

**Files:**
- Modify: `src/app/a/[slug]/_kinds/catalog/Renderer.tsx`

- [ ] **Step 1: Locate the cart drawer form**

Around line 1049–1080: the `<form action="/api/action-pages/submit" method="post">`. The hidden `data.payment_method_id` field is already there.

- [ ] **Step 2: Add required upload + note**

Convert the form to client-managed (it already is — the component is `'use client'`). After the method picker (around line 1347–1360) and before the Place-order button, add a controlled file input that POSTs to `/api/action-pages/[slug]/payment-proofs`. Use the same upload logic shape as `PaymentBlockClient` but inline:

```tsx
const [proofUrl, setProofUrl] = useState('')
const [proofFileId, setProofFileId] = useState('')
const [uploadingProof, setUploadingProof] = useState(false)
const [proofError, setProofError] = useState<string | null>(null)
const [note, setNote] = useState('')

async function uploadProof(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0]
  if (!file) return
  setUploadingProof(true); setProofError(null)
  try {
    const fd = new FormData(); fd.append('file', file)
    const res = await fetch(`/api/action-pages/${page.slug}/payment-proofs`, {
      method: 'POST', body: fd,
    })
    const b = await res.json()
    if (!res.ok) throw new Error(b?.error ?? 'upload_failed')
    setProofUrl(b.url); setProofFileId(b.fileId)
  } catch (err) {
    setProofError(err instanceof Error ? err.message : 'upload_failed')
  } finally {
    setUploadingProof(false)
  }
}
```

Add inside the form, after the method picker:

```tsx
{paymentMethods.length > 0 ? (
  <div style={{ padding: '0 22px 14px' }}>
    <label className="grid gap-1 text-sm">
      Payment screenshot (required)
      <input
        type="file" accept="image/jpeg,image/png,image/webp"
        onChange={uploadProof}
        disabled={uploadingProof}
      />
      {uploadingProof ? <span>Uploading…</span> : null}
      {proofError ? <span style={{ color: '#b91c1c' }}>{proofError}</span> : null}
      {proofUrl ? (
        <img src={proofUrl} alt="Proof" style={{ width: 120, height: 120, borderRadius: 8, objectFit: 'cover' }} />
      ) : null}
    </label>
    <label className="grid gap-1 text-sm" style={{ marginTop: 10 }}>
      Note (optional)
      <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
    </label>
    {proofUrl ? <input type="hidden" name="data.payment_proof_url" value={proofUrl} /> : null}
    {proofFileId ? <input type="hidden" name="data.payment_proof_file_id" value={proofFileId} /> : null}
    {note ? <input type="hidden" name="data.payment_note" value={note} /> : null}
  </div>
) : null}
```

Then update the Place-order submit button to be `disabled` when `paymentMethods.length > 0 && (!paymentMethodId || !proofUrl)`.

- [ ] **Step 3: Hide entire payment section when `config.payment.enabled === false`**

At the top of the cart drawer's payment-method block (existing line 1347), wrap the method picker AND the new upload in a single `paymentEnabled && paymentMethods.length > 0` conditional. Read `paymentEnabled` from `config.payment?.enabled !== false`.

- [ ] **Step 4: Run typecheck + dev**

```bash
pnpm typecheck && pnpm dev
```

Open a published catalog page, add to cart, attempt to place without a proof — button stays disabled.

- [ ] **Step 5: Commit**

```bash
git add src/app/a/\[slug\]/_kinds/catalog/Renderer.tsx
git commit -m "feat(catalog): required payment screenshot in cart checkout"
```

---

## Task 12: Catalog payment-config shim + tests

**Files:**
- Create: `src/app/(app)/dashboard/action-pages/_lib/payment-shim.ts`
- Create: `src/app/(app)/dashboard/action-pages/_lib/payment-shim.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// payment-shim.test.ts
import { describe, expect, it } from 'vitest'
import { migrateCatalogPaymentConfig } from './payment-shim'

describe('migrateCatalogPaymentConfig', () => {
  it('returns input unchanged when payment block already present', () => {
    const input = { payment: { enabled: true, excluded_method_ids: ['x'] } }
    expect(migrateCatalogPaymentConfig(input, ['a', 'b', 'x'])).toEqual(input)
  })

  it('converts include-list to exclude-list', () => {
    const input = { payment_method_ids: ['a', 'c'] }
    const out = migrateCatalogPaymentConfig(input, ['a', 'b', 'c', 'd'])
    expect(out).toEqual({
      payment: { enabled: true, excluded_method_ids: ['b', 'd'] },
    })
  })

  it('treats absent payment_method_ids as "all enabled allowed"', () => {
    const out = migrateCatalogPaymentConfig({}, ['a', 'b'])
    expect(out).toEqual({
      payment: { enabled: true, excluded_method_ids: [] },
    })
  })
})
```

- [ ] **Step 2: Implement the shim**

```ts
// payment-shim.ts
export interface CatalogPaymentConfigSlice {
  payment_method_ids?: string[]
  payment?: { enabled?: boolean; excluded_method_ids?: string[] }
}

export function migrateCatalogPaymentConfig<T extends CatalogPaymentConfigSlice>(
  config: T,
  allEnabledMethodIds: string[],
): T & { payment: { enabled: boolean; excluded_method_ids: string[] } } {
  if (config.payment && typeof config.payment.enabled === 'boolean') {
    return config as T & { payment: { enabled: boolean; excluded_method_ids: string[] } }
  }
  const include = Array.isArray(config.payment_method_ids)
    ? new Set(config.payment_method_ids)
    : null
  const excluded =
    include === null ? [] : allEnabledMethodIds.filter((id) => !include.has(id))
  const next = { ...config, payment: { enabled: true, excluded_method_ids: excluded } }
  delete (next as CatalogPaymentConfigSlice).payment_method_ids
  return next as T & { payment: { enabled: boolean; excluded_method_ids: string[] } }
}
```

- [ ] **Step 3: Run tests**

```bash
pnpm vitest run src/app/\(app\)/dashboard/action-pages/_lib/payment-shim.test.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/_lib/payment-shim.ts src/app/\(app\)/dashboard/action-pages/_lib/payment-shim.test.ts
git commit -m "feat(action-pages): catalog payment include→exclude shim"
```

---

## Task 13: `PaymentSettingsPanel` shared component

**Files:**
- Create: `src/app/(app)/dashboard/action-pages/_components/PaymentSettingsPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'
import Link from 'next/link'
import type { PaymentMethod } from '@/lib/payment-methods/types'
import { paymentMethodKindLabel } from '@/lib/payment-methods/types'

export interface PaymentSettings {
  enabled: boolean
  excluded_method_ids: string[]
}

interface Props {
  value: PaymentSettings
  onChange: (next: PaymentSettings) => void
  paymentMethods: PaymentMethod[]
}

export default function PaymentSettingsPanel({ value, onChange, paymentMethods }: Props) {
  const enabledMethods = paymentMethods.filter((m) => m.enabled)
  const excluded = new Set(value.excluded_method_ids)

  function toggleEnabled(next: boolean) {
    onChange({ ...value, enabled: next })
  }

  function toggleMethod(id: string) {
    const e = new Set(excluded)
    if (e.has(id)) e.delete(id); else e.add(id)
    onChange({ ...value, excluded_method_ids: Array.from(e) })
  }

  return (
    <section className="rounded-lg border border-gray-200 p-4">
      <header className="flex items-center justify-between">
        <h3 className="font-semibold">Payment</h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(e) => toggleEnabled(e.target.checked)}
          />
          Show payment section on this page
        </label>
      </header>

      {value.enabled ? (
        <div className="mt-3">
          {paymentMethods.length === 0 ? (
            <p className="text-sm text-gray-600">
              You don’t have any payment methods yet.{' '}
              <Link href="/dashboard/payment-methods" className="underline">
                Add one
              </Link>.
            </p>
          ) : (
            <ul className="grid gap-2">
              {paymentMethods.map((m) => {
                const shown = m.enabled && !excluded.has(m.id)
                return (
                  <li
                    key={m.id}
                    className={
                      'flex items-center justify-between rounded border border-gray-200 p-2 ' +
                      (m.enabled ? '' : 'opacity-50')
                    }
                  >
                    <div>
                      <div className="text-sm font-medium">{m.name}</div>
                      <div className="text-xs text-gray-500">
                        {paymentMethodKindLabel(m.kind)}
                        {!m.enabled ? ' · Disabled in /payment-methods' : ''}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={!m.enabled}
                        checked={shown}
                        onChange={() => toggleMethod(m.id)}
                      />
                      Show on this page
                    </label>
                  </li>
                )
              })}
              {enabledMethods.length === 0 ? (
                <p className="text-xs text-gray-600">
                  All your payment methods are disabled. Enable at least one in{' '}
                  <Link href="/dashboard/payment-methods" className="underline">
                    /payment-methods
                  </Link>.
                </p>
              ) : null}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  )
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/_components/PaymentSettingsPanel.tsx
git commit -m "feat(action-pages): PaymentSettingsPanel shared editor component"
```

---

## Task 14: Sales editor — integrate panel

**Files:**
- Modify: `src/app/(app)/dashboard/action-pages/_kinds/sales/Editor.tsx`

- [ ] **Step 1: Load payment methods server-side**

Determine where the editor receives `paymentMethods`. If not already a prop, extend the parent (`EditActionPageShell.tsx` or its server loader) to load `loadPaymentMethods()` from `/dashboard/payment-methods/actions.ts` and pass it as a prop.

- [ ] **Step 2: Insert the panel**

Inside the sales editor JSX, between existing sections (after "Linked action pages" if present, else at the bottom of the config form):

```tsx
import PaymentSettingsPanel, { type PaymentSettings } from '../../_components/PaymentSettingsPanel'
// ...
const payment: PaymentSettings = config.payment ?? { enabled: true, excluded_method_ids: [] }

<PaymentSettingsPanel
  value={payment}
  onChange={(next) => setConfig({ ...config, payment: next })}
  paymentMethods={paymentMethods}
/>
```

(Match the editor's existing state management conventions — `useState`, `useReducer`, or form-action; the snippet uses a generic `setConfig`.)

- [ ] **Step 3: Run typecheck + dev**

```bash
pnpm typecheck && pnpm dev
```

Open a sales-page edit screen. Toggle ON/OFF, exclude a method, save, reload — verify state round-trips through `action_pages.config.payment`.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/_kinds/sales/Editor.tsx src/app/\(app\)/dashboard/action-pages/_components/EditActionPageShell.tsx
git commit -m "feat(sales-editor): payment settings panel"
```

---

## Task 15: Catalog editor — panel + apply shim on read

**Files:**
- Modify: `src/app/(app)/dashboard/action-pages/_kinds/catalog/Editor.tsx`

- [ ] **Step 1: Remove old payment_method_ids picker**

If the catalog editor has an include-list method picker today, remove it.

- [ ] **Step 2: Apply the shim on load**

```ts
import { migrateCatalogPaymentConfig } from '../../_lib/payment-shim'
// when initializing state:
const allEnabledIds = paymentMethods.filter((m) => m.enabled).map((m) => m.id)
const initial = migrateCatalogPaymentConfig(rawConfig, allEnabledIds)
```

- [ ] **Step 3: Render `<PaymentSettingsPanel>`**

```tsx
<PaymentSettingsPanel
  value={config.payment}
  onChange={(next) => setConfig({ ...config, payment: next })}
  paymentMethods={paymentMethods}
/>
```

- [ ] **Step 4: Save path**

Ensure that when the editor saves, it writes only `config.payment` (no `payment_method_ids`). The save normalizer should strip `payment_method_ids` if present.

- [ ] **Step 5: Run typecheck + manual round-trip**

```bash
pnpm typecheck
```

Then save a catalog page that previously had `payment_method_ids`, reload, and confirm the panel reflects the shim's output.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/_kinds/catalog/Editor.tsx
git commit -m "feat(catalog-editor): payment settings panel + shim"
```

---

## Task 16: Verify/Reject server actions

**Files:**
- Create: `src/app/(app)/dashboard/action-pages/[id]/submissions/payment-actions.ts`

- [ ] **Step 1: Write the actions**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  verifyPayment as verifyPaymentDb,
  rejectPayment as rejectPaymentDb,
} from '@/lib/order-payments/server'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function verifyPayment(orderPaymentId: string, actionPageId: string) {
  const { supabase, userId } = await requireUser()
  await verifyPaymentDb(supabase, orderPaymentId, userId, userId)
  revalidatePath(`/dashboard/action-pages/${actionPageId}/submissions`)
}

export async function rejectPayment(
  orderPaymentId: string,
  reason: string,
  actionPageId: string,
) {
  const { supabase, userId } = await requireUser()
  await rejectPaymentDb(supabase, orderPaymentId, userId, reason)
  revalidatePath(`/dashboard/action-pages/${actionPageId}/submissions`)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/\[id\]/submissions/payment-actions.ts
git commit -m "feat(action-pages): verify/reject payment server actions"
```

---

## Task 17: Catalog orders view — payment column + actions

**Files:**
- Modify: `src/app/(app)/dashboard/action-pages/[id]/submissions/CatalogOrdersView.tsx`

- [ ] **Step 1: Load payments map**

In the server component / loader that feeds `CatalogOrdersView`, load `listBySubmissionIds(admin, userId, submissionIds)` and pass the resulting `Map<string, OrderPayment>` as a prop.

- [ ] **Step 2: Add Payment column**

Render in each row:
- Method label (`row.payment?.method_name`) with kind badge.
- Status pill (color-coded by `submitted` / `verified` / `rejected`).
- Thumbnail link → `row.payment.proof_url` opens new tab.

- [ ] **Step 3: Add row actions**

A small dropdown with:
- "Mark as paid" → calls `verifyPayment(payment.id, actionPageId)`.
- "Reject…" → opens a dialog with a `<textarea>` for `rejection_reason`, then calls `rejectPayment(payment.id, reason, actionPageId)`.

Hide actions when `payment.status !== 'submitted'`. Show the resulting status pill instead.

- [ ] **Step 4: Run typecheck + dev**

```bash
pnpm typecheck && pnpm dev
```

Submit a catalog order with a proof, then Mark as paid → confirm `business_orders.payment_status` is `paid` (via SQL inspection).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/\[id\]/submissions/CatalogOrdersView.tsx
git commit -m "feat(orders): payment column + verify/reject actions"
```

---

## Task 18: Sales payments view

**Files:**
- Create: `src/app/(app)/dashboard/action-pages/[id]/submissions/SalesPaymentsView.tsx`
- Modify: `src/app/(app)/dashboard/action-pages/[id]/submissions/page.tsx`

- [ ] **Step 1: Build the view**

A client component receiving `payments: Array<{ payment: OrderPayment; submission: { id: string; created_at: string; data: Record<string, unknown> } }>` plus `actionPageId`. Render a table:

| Created | Buyer | Method | Amount | Note | Proof | Status | Actions |

Where buyer = `submission.data.contact_name` + `contact_phone | contact_email`, and Actions mirror Task 17.

- [ ] **Step 2: Wire into the submissions page**

In `page.tsx`, when `page.kind === 'sales'`:
- Load submissions for the page.
- Load `listBySubmissionIds`.
- Join into the shape above (only rows that have a payment).
- Render `<SalesPaymentsView payments={...} actionPageId={...} />` in a new section above the existing submissions list.

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 4: Manual smoke**

Submit a sales page with payment proof, open the submissions page, see the new view, verify + reject buttons work.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/\[id\]/submissions/
git commit -m "feat(sales): payments view on submissions page"
```

---

## Task 19: Full-suite verification

- [ ] **Step 1: Lint + typecheck + tests**

```bash
pnpm lint && pnpm typecheck && pnpm vitest run
```
Expected: all green.

- [ ] **Step 2: Smoke walkthroughs**

1. Sales page → submit payment → see in submissions view → Mark paid → status flips.
2. Catalog cart → cannot Place order without proof → submit → `business_orders.payment_status = pending` → Mark paid → `paid`. Reject → `failed`, rejection reason persisted.
3. Per-page toggle OFF on a sales page → no payment block rendered.
4. Exclude one method on a page → no longer offered on that page; still offered on others.
5. Catalog page with legacy `payment_method_ids` → editor opens, shim applies, save round-trips to `payment.excluded_method_ids`.

- [ ] **Step 3: Final commit (changelog / notes if applicable)**

No commit if everything was already committed by prior tasks.

---

## Notes

- **Tests we explicitly added:** `order-payments/server.test.ts`, `payment-methods/public.test.ts`, `catalog.test.ts` (new cases), `sales/schema.test.ts`, `payment-shim.test.ts`. UI components are exercised manually in the smoke walkthroughs; deeper component tests are out of scope for v1.
- **Pricing fields:** sales pages use free-entry amount + currency; catalog uses the existing cart subtotal. The `order_payments.amount` is populated from the buyer-entered amount on sales, and (optionally) from the cart subtotal on catalog. If you skip populating it for catalog, leave as `null` — both `business_orders.subtotal_amount` and the payment row coexist.
- **Auth-less buyer upload:** `/api/action-pages/[slug]/payment-proofs` matches the convention of the existing `/customer-images` route — the page must be `published`. No buyer auth.
- **RLS:** the dashboard reads `order_payments` via the user's authenticated client, so the table's RLS suffices. Inserts and trigger-driven updates use the admin client from the submit route.
- **Concurrency:** the `unique(submission_id)` index protects against duplicate inserts if the submit route retries.
