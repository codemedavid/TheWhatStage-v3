# Catalog Cart Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist catalog action-page visitor carts per `(action_page_id, psid)` so returning Facebook visitors see their previously added items, mark carts converted on checkout, and surface saved carts in the Lead Drawer.

**Architecture:** Extend the existing `carts` + `cart_items` tables with `action_page_id` + `psid`. Add two visitor-facing API routes (`GET`/`PUT /api/action-pages/[slug]/cart`) that use service-role plus the existing signed-deeplink HMAC for auth. Hydrate the React renderer once on mount and mirror every quantity change with a debounced `PUT`. Add a new "Carts" tab to the Lead Drawer that reads via a server action.

**Tech Stack:** Next.js App Router (Node runtime), Supabase Postgres + service-role admin client, Vitest for unit tests, existing HMAC helpers in `src/lib/action-pages/signing.ts`.

**Spec:** `docs/superpowers/specs/2026-05-20-catalog-cart-persistence-design.md`

---

## File structure

| Path | Action | Responsibility |
| --- | --- | --- |
| `supabase/migrations/20260520000000_carts_action_page_visitor.sql` | Create | Adds `action_page_id`, `psid`, unique index, lookup index |
| `src/lib/action-pages/visitor-cart.ts` | Create | Resolve, upsert, convert visitor-cart helpers (DB layer) |
| `src/lib/action-pages/visitor-cart.test.ts` | Create | Vitest unit tests for the helpers (mocked admin client) |
| `src/app/api/action-pages/[slug]/cart/route.ts` | Create | `GET` + `PUT` route handlers wrapping the helpers |
| `src/app/api/action-pages/[slug]/cart/route.test.ts` | Create | Vitest tests for the route handlers |
| `src/app/api/action-pages/submit/route.ts` | Modify | Convert the active cart on successful catalog submit |
| `src/app/a/[slug]/_kinds/catalog/Renderer.tsx` | Modify | Hydrate on mount + debounced `PUT` on quantity change |
| `src/app/(app)/dashboard/leads/actions/carts.ts` | Create | Server action `loadLeadCarts` for the drawer |
| `src/app/(app)/dashboard/leads/_components/CartsPanel.tsx` | Create | Read-only carts list UI |
| `src/app/(app)/dashboard/leads/_components/LeadDrawer.tsx` | Modify | Add `'carts'` tab + render `<CartsPanel/>` |

---

### Task 1: Schema migration

**Files:**
- Create: `supabase/migrations/20260520000000_carts_action_page_visitor.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =========================================================================
-- carts: add visitor identity columns for action-page catalog carts
--
-- These nullable columns let the existing carts/cart_items tables also
-- represent a public catalog visitor's draft cart, keyed on
-- (action_page_id, psid). Owner-side RLS, abandoned-cart workflow, and
-- dashboard reads keep working because user_id is still populated (from
-- the action page's owner).
-- =========================================================================

alter table public.carts
  add column action_page_id uuid references public.action_pages(id) on delete cascade,
  add column psid           text;

-- Only one active cart per (action_page_id, psid). Partial index is safe
-- for existing rows (action_page_id is null there).
create unique index carts_active_visitor_idx
  on public.carts (action_page_id, psid)
  where status = 'active'
    and action_page_id is not null
    and psid is not null;

-- Fast lookup for the visitor GET route.
create index carts_action_page_psid_idx
  on public.carts (action_page_id, psid)
  where action_page_id is not null;
```

- [ ] **Step 2: Apply locally**

```bash
supabase db reset --linked=false   # if working against local docker
# or
supabase migration up
```

Expected: migration applies cleanly; `\d public.carts` shows the two new columns and `\di public.carts*` lists the two new indexes.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260520000000_carts_action_page_visitor.sql
git commit -m "feat(db): add action_page_id/psid to carts for visitor cart persistence"
```

---

### Task 2: Visitor-cart helper module

This module isolates all the carts/cart_items DB access so the route handlers stay thin and testable.

**Files:**
- Create: `src/lib/action-pages/visitor-cart.ts`
- Test: `src/lib/action-pages/visitor-cart.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/action-pages/visitor-cart.test.ts
import { describe, expect, it, vi } from 'vitest'
import {
  loadActiveVisitorCart,
  replaceVisitorCart,
  convertVisitorCart,
} from './visitor-cart'

type Row = Record<string, unknown>

function makeAdmin(initial: {
  carts?: Row[]
  cart_items?: Row[]
  business_items?: Row[]
  messenger_threads?: Row[]
  action_pages?: Row[]
} = {}) {
  const tables: Record<string, Row[]> = {
    carts: [...(initial.carts ?? [])],
    cart_items: [...(initial.cart_items ?? [])],
    business_items: [...(initial.business_items ?? [])],
    messenger_threads: [...(initial.messenger_threads ?? [])],
    action_pages: [...(initial.action_pages ?? [])],
  }

  function builder(name: string) {
    const filters: { col: string; op: string; val: unknown }[] = []
    let mode: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let payload: Row | Row[] | null = null
    let returningCols: string | null = null

    const api: any = {
      select(cols: string) {
        returningCols = cols
        return api
      },
      eq(col: string, val: unknown) {
        filters.push({ col, op: 'eq', val })
        return api
      },
      in(col: string, vals: unknown[]) {
        filters.push({ col, op: 'in', val: vals })
        return api
      },
      insert(rows: Row | Row[]) {
        mode = 'insert'
        payload = rows
        return api
      },
      update(row: Row) {
        mode = 'update'
        payload = row
        return api
      },
      delete() {
        mode = 'delete'
        return api
      },
      maybeSingle() {
        return apply().then((rows) => ({ data: rows[0] ?? null, error: null }))
      },
      single() {
        return apply().then((rows) => ({ data: rows[0] ?? null, error: null }))
      },
      then(resolve: (v: unknown) => void) {
        return apply().then((rows) => resolve({ data: rows, error: null }))
      },
    }

    async function apply(): Promise<Row[]> {
      const matches = (row: Row) =>
        filters.every((f) =>
          f.op === 'eq'
            ? row[f.col] === f.val
            : Array.isArray(f.val) && (f.val as unknown[]).includes(row[f.col]),
        )

      if (mode === 'select') return tables[name].filter(matches)

      if (mode === 'insert') {
        const rows = Array.isArray(payload) ? payload : [payload as Row]
        const stamped = rows.map((r) => ({
          id: r.id ?? `gen-${tables[name].length + 1}`,
          ...r,
        }))
        tables[name].push(...stamped)
        return stamped
      }

      if (mode === 'update') {
        const updated: Row[] = []
        for (const row of tables[name]) {
          if (matches(row)) {
            Object.assign(row, payload as Row)
            updated.push(row)
          }
        }
        return updated
      }

      // delete
      const kept = tables[name].filter((r) => !matches(r))
      const removed = tables[name].length - kept.length
      tables[name] = kept
      return Array.from({ length: removed }, () => ({}))
    }

    return api
  }

  return { from: vi.fn((name: string) => builder(name)), _tables: tables }
}

describe('visitor-cart helpers', () => {
  const baseCtx = {
    actionPageId: 'page-1',
    psid: 'PSID_A',
    pageOwnerId: 'owner-1',
    fbPageId: 'fb-1',
  }

  it('loadActiveVisitorCart returns empty when no cart exists', async () => {
    const admin = makeAdmin()
    const cart = await loadActiveVisitorCart(admin as any, baseCtx)
    expect(cart).toEqual({ items: [] })
  })

  it('loadActiveVisitorCart returns items for the active cart', async () => {
    const admin = makeAdmin({
      carts: [{
        id: 'c1', action_page_id: 'page-1', psid: 'PSID_A', status: 'active',
        user_id: 'owner-1',
      }],
      cart_items: [
        { id: 'i1', cart_id: 'c1', product_id: 'prod-1', quantity: 2 },
        { id: 'i2', cart_id: 'c1', product_id: 'prod-2', quantity: 1 },
      ],
    })
    const cart = await loadActiveVisitorCart(admin as any, baseCtx)
    expect(cart.items).toEqual([
      { id: 'prod-1', quantity: 2 },
      { id: 'prod-2', quantity: 1 },
    ])
  })

  it('replaceVisitorCart creates a new active cart on first call', async () => {
    const admin = makeAdmin({
      business_items: [
        { id: 'prod-1', user_id: 'owner-1', status: 'published',
          title: 'Mug', price_amount: 10, currency: 'USD', cover_image_url: null },
      ],
    })
    await replaceVisitorCart(admin as any, baseCtx, [{ id: 'prod-1', quantity: 3 }])
    expect((admin as any)._tables.carts).toHaveLength(1)
    expect((admin as any)._tables.cart_items).toHaveLength(1)
    expect((admin as any)._tables.cart_items[0]).toMatchObject({
      product_id: 'prod-1', quantity: 3, unit_price: 10, name: 'Mug',
    })
  })

  it('replaceVisitorCart drops unknown product ids', async () => {
    const admin = makeAdmin({
      business_items: [
        { id: 'prod-1', user_id: 'owner-1', status: 'published',
          title: 'Mug', price_amount: 10, currency: 'USD', cover_image_url: null },
      ],
    })
    await replaceVisitorCart(admin as any, baseCtx, [
      { id: 'prod-1', quantity: 1 },
      { id: 'prod-bad', quantity: 9 },
    ])
    const items = (admin as any)._tables.cart_items
    expect(items).toHaveLength(1)
    expect(items[0].product_id).toBe('prod-1')
  })

  it('replaceVisitorCart with empty array clears items but keeps cart row', async () => {
    const admin = makeAdmin({
      carts: [{ id: 'c1', action_page_id: 'page-1', psid: 'PSID_A', status: 'active',
        user_id: 'owner-1', total_amount: 20, currency: 'USD' }],
      cart_items: [{ id: 'i1', cart_id: 'c1', product_id: 'prod-1', quantity: 2,
        unit_price: 10, name: 'Mug' }],
      business_items: [],
    })
    await replaceVisitorCart(admin as any, baseCtx, [])
    expect((admin as any)._tables.carts).toHaveLength(1)
    expect((admin as any)._tables.cart_items).toHaveLength(0)
    expect((admin as any)._tables.carts[0].total_amount).toBeNull()
  })

  it('convertVisitorCart marks active cart converted', async () => {
    const admin = makeAdmin({
      carts: [{ id: 'c1', action_page_id: 'page-1', psid: 'PSID_A', status: 'active',
        user_id: 'owner-1' }],
    })
    await convertVisitorCart(admin as any, baseCtx)
    expect((admin as any)._tables.carts[0].status).toBe('converted')
    expect((admin as any)._tables.carts[0].converted_at).toBeTruthy()
  })

  it('convertVisitorCart no-ops when there is no active cart', async () => {
    const admin = makeAdmin()
    await expect(convertVisitorCart(admin as any, baseCtx)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- src/lib/action-pages/visitor-cart.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

```ts
// src/lib/action-pages/visitor-cart.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface VisitorCartItem {
  id: string        // product_id
  quantity: number
}

export interface VisitorCartContext {
  actionPageId: string
  psid: string
  pageOwnerId: string   // carts.user_id
  fbPageId: string | null  // for messenger_threads lookup; null when unknown
}

interface CartRow {
  id: string
  currency: string | null
  status: string
}

const ZERO = 0

async function findActiveCartId(
  admin: SupabaseClient,
  ctx: VisitorCartContext,
): Promise<CartRow | null> {
  const { data } = await admin
    .from('carts')
    .select('id, currency, status')
    .eq('action_page_id', ctx.actionPageId)
    .eq('psid', ctx.psid)
    .eq('status', 'active')
    .maybeSingle<CartRow>()
  return data
}

async function resolveLeadId(
  admin: SupabaseClient,
  ctx: VisitorCartContext,
): Promise<string | null> {
  if (!ctx.fbPageId) return null
  const { data } = await admin
    .from('messenger_threads')
    .select('lead_id')
    .eq('page_id', ctx.fbPageId)
    .eq('psid', ctx.psid)
    .maybeSingle<{ lead_id: string | null }>()
  return data?.lead_id ?? null
}

export async function loadActiveVisitorCart(
  admin: SupabaseClient,
  ctx: VisitorCartContext,
): Promise<{ items: VisitorCartItem[] }> {
  const cart = await findActiveCartId(admin, ctx)
  if (!cart) return { items: [] }

  const { data } = await admin
    .from('cart_items')
    .select('product_id, quantity')
    .eq('cart_id', cart.id)

  const items: VisitorCartItem[] = (data ?? [])
    .map((row) => ({
      id: (row.product_id as string | null) ?? '',
      quantity: Number(row.quantity ?? 0),
    }))
    .filter((i) => i.id && i.quantity > ZERO)

  return { items }
}

interface ProductRow {
  id: string
  title: string
  price_amount: number | null
  currency: string
  cover_image_url: string | null
}

async function fetchProducts(
  admin: SupabaseClient,
  pageOwnerId: string,
  ids: string[],
): Promise<Map<string, ProductRow>> {
  if (ids.length === 0) return new Map()
  const { data } = await admin
    .from('business_items')
    .select('id, title, price_amount, currency, cover_image_url')
    .eq('user_id', pageOwnerId)
    .eq('status', 'published')
    .in('id', ids)
  const map = new Map<string, ProductRow>()
  for (const row of data ?? []) {
    map.set(row.id as string, {
      id: row.id as string,
      title: row.title as string,
      price_amount:
        row.price_amount === null || row.price_amount === undefined
          ? null
          : Number(row.price_amount),
      currency: (row.currency as string) ?? 'USD',
      cover_image_url: (row.cover_image_url as string | null) ?? null,
    })
  }
  return map
}

export async function replaceVisitorCart(
  admin: SupabaseClient,
  ctx: VisitorCartContext,
  items: VisitorCartItem[],
): Promise<void> {
  const clean = items
    .filter((i) => typeof i.id === 'string' && i.id && Number.isFinite(i.quantity) && i.quantity > 0)
    .map((i) => ({ id: i.id, quantity: Math.min(999, Math.floor(i.quantity)) }))

  const productMap = await fetchProducts(admin, ctx.pageOwnerId, clean.map((i) => i.id))
  const lines = clean
    .filter((i) => productMap.has(i.id))
    .map((i) => {
      const p = productMap.get(i.id)!
      return {
        product_id: p.id,
        name: p.title,
        quantity: i.quantity,
        unit_price: p.price_amount ?? 0,
        image_url: p.cover_image_url,
        currency: p.currency,
      }
    })

  const total = lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0)
  const currency = lines[0]?.currency ?? 'USD'

  let cart = await findActiveCartId(admin, ctx)
  if (!cart) {
    const leadId = await resolveLeadId(admin, ctx)
    const { data: inserted } = await admin
      .from('carts')
      .insert({
        user_id: ctx.pageOwnerId,
        action_page_id: ctx.actionPageId,
        psid: ctx.psid,
        lead_id: leadId,
        source: 'action_page',
        status: 'active',
        currency,
        total_amount: total > 0 ? total : null,
      })
      .select('id, currency, status')
      .single<CartRow>()
    cart = inserted
  }
  if (!cart) return

  await admin.from('cart_items').delete().eq('cart_id', cart.id)

  if (lines.length > 0) {
    await admin.from('cart_items').insert(
      lines.map((l) => ({
        cart_id: cart!.id,
        product_id: l.product_id,
        name: l.name,
        quantity: l.quantity,
        unit_price: l.unit_price,
        image_url: l.image_url,
      })),
    )
  }

  await admin
    .from('carts')
    .update({
      total_amount: total > 0 ? total : null,
      currency,
    })
    .eq('id', cart.id)
}

export async function convertVisitorCart(
  admin: SupabaseClient,
  ctx: VisitorCartContext,
): Promise<void> {
  const cart = await findActiveCartId(admin, ctx)
  if (!cart) return
  await admin
    .from('carts')
    .update({ status: 'converted', converted_at: new Date().toISOString() })
    .eq('id', cart.id)
}
```

- [ ] **Step 4: Run tests, verify all pass**

```bash
npm test -- src/lib/action-pages/visitor-cart.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/action-pages/visitor-cart.ts src/lib/action-pages/visitor-cart.test.ts
git commit -m "feat(action-pages): visitor-cart helpers for catalog persistence"
```

---

### Task 3: GET /api/action-pages/[slug]/cart route

**Files:**
- Create: `src/app/api/action-pages/[slug]/cart/route.ts`
- Test: `src/app/api/action-pages/[slug]/cart/route.test.ts`

- [ ] **Step 1: Write the failing test for GET**

```ts
// src/app/api/action-pages/[slug]/cart/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/action-pages/visitor-cart', () => ({
  loadActiveVisitorCart: vi.fn(),
  replaceVisitorCart: vi.fn(),
}))
vi.mock('@/lib/action-pages/signing', () => ({
  verifyDeeplink: vi.fn(),
}))

import { GET, PUT } from './route'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  loadActiveVisitorCart,
  replaceVisitorCart,
} from '@/lib/action-pages/visitor-cart'
import { verifyDeeplink } from '@/lib/action-pages/signing'

function pageFixture() {
  return {
    id: 'page-1',
    user_id: 'owner-1',
    status: 'published',
    signing_secret: 'secret',
  }
}

function adminFor(page: ReturnType<typeof pageFixture> | null) {
  const single = vi.fn().mockResolvedValue({ data: page, error: null })
  const maybeSingle = vi.fn().mockResolvedValue({ data: page, error: null })
  const eq = vi.fn().mockReturnValue({ maybeSingle, single })
  const select = vi.fn().mockReturnValue({ eq })
  return { from: vi.fn().mockReturnValue({ select }) }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET /api/action-pages/[slug]/cart', () => {
  it('returns empty items when claims are missing', async () => {
    ;(createAdminClient as any).mockReturnValue(adminFor(pageFixture()))
    const req = new Request('http://test/api/action-pages/s/cart')
    const res = await GET(req as any, { params: Promise.resolve({ slug: 's' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [] })
    expect(loadActiveVisitorCart).not.toHaveBeenCalled()
  })

  it('returns empty items when verifyDeeplink fails', async () => {
    ;(createAdminClient as any).mockReturnValue(adminFor(pageFixture()))
    ;(verifyDeeplink as any).mockReturnValue({ ok: false, reason: 'expired' })
    const req = new Request(
      'http://test/api/action-pages/s/cart?p=PSID&g=fb&e=1&t=tok',
    )
    const res = await GET(req as any, { params: Promise.resolve({ slug: 's' }) })
    const body = await res.json()
    expect(body).toEqual({ items: [] })
  })

  it('returns saved items when claims valid', async () => {
    ;(createAdminClient as any).mockReturnValue(adminFor(pageFixture()))
    ;(verifyDeeplink as any).mockReturnValue({
      ok: true,
      claims: { slug: 's', psid: 'PSID', pageId: 'fb', exp: 9 },
    })
    ;(loadActiveVisitorCart as any).mockResolvedValue({
      items: [{ id: 'prod-1', quantity: 2 }],
    })
    const req = new Request(
      'http://test/api/action-pages/s/cart?p=PSID&g=fb&e=9&t=tok',
    )
    const res = await GET(req as any, { params: Promise.resolve({ slug: 's' }) })
    const body = await res.json()
    expect(body).toEqual({ items: [{ id: 'prod-1', quantity: 2 }] })
  })

  it('returns 404 when page is not published', async () => {
    ;(createAdminClient as any).mockReturnValue(adminFor(null))
    const req = new Request('http://test/api/action-pages/s/cart')
    const res = await GET(req as any, { params: Promise.resolve({ slug: 's' }) })
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/action-pages/[slug]/cart', () => {
  it('skips when claims missing', async () => {
    ;(createAdminClient as any).mockReturnValue(adminFor(pageFixture()))
    const req = new Request('http://test/api/action-pages/s/cart', {
      method: 'PUT',
      body: JSON.stringify({ items: [{ id: 'prod-1', quantity: 1 }] }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await PUT(req as any, { params: Promise.resolve({ slug: 's' }) })
    const body = await res.json()
    expect(body).toEqual({ skipped: true })
    expect(replaceVisitorCart).not.toHaveBeenCalled()
  })

  it('writes when claims valid', async () => {
    ;(createAdminClient as any).mockReturnValue(adminFor(pageFixture()))
    ;(verifyDeeplink as any).mockReturnValue({
      ok: true,
      claims: { slug: 's', psid: 'PSID', pageId: 'fb', exp: 9 },
    })
    ;(replaceVisitorCart as any).mockResolvedValue(undefined)
    const req = new Request(
      'http://test/api/action-pages/s/cart?p=PSID&g=fb&e=9&t=tok',
      {
        method: 'PUT',
        body: JSON.stringify({ items: [{ id: 'prod-1', quantity: 2 }] }),
        headers: { 'content-type': 'application/json' },
      },
    )
    const res = await PUT(req as any, { params: Promise.resolve({ slug: 's' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(replaceVisitorCart).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actionPageId: 'page-1',
        psid: 'PSID',
        pageOwnerId: 'owner-1',
        fbPageId: 'fb',
      }),
      [{ id: 'prod-1', quantity: 2 }],
    )
  })

  it('rejects invalid JSON', async () => {
    ;(createAdminClient as any).mockReturnValue(adminFor(pageFixture()))
    const req = new Request('http://test/api/action-pages/s/cart', {
      method: 'PUT',
      body: 'not json',
      headers: { 'content-type': 'application/json' },
    })
    const res = await PUT(req as any, { params: Promise.resolve({ slug: 's' }) })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run, verify failure**

```bash
npm test -- src/app/api/action-pages/\[slug\]/cart/route.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

```ts
// src/app/api/action-pages/[slug]/cart/route.ts
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyDeeplink } from '@/lib/action-pages/signing'
import {
  loadActiveVisitorCart,
  replaceVisitorCart,
  type VisitorCartContext,
  type VisitorCartItem,
} from '@/lib/action-pages/visitor-cart'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PageRow {
  id: string
  user_id: string
  status: string
  signing_secret: string
}

async function loadPage(slug: string): Promise<{
  admin: ReturnType<typeof createAdminClient>
  page: PageRow | null
}> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('action_pages')
    .select('id, user_id, status, signing_secret')
    .eq('slug', slug)
    .maybeSingle<PageRow>()
  return { admin, page: data ?? null }
}

function readClaims(url: URL, slug: string, secret: string) {
  const p = url.searchParams.get('p')
  const g = url.searchParams.get('g')
  const e = url.searchParams.get('e')
  const t = url.searchParams.get('t')
  if (!p || !g || !e || !t) return null
  const v = verifyDeeplink(secret, slug, { p, g, e, t })
  return v.ok && v.claims ? v.claims : null
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params
  const { admin, page } = await loadPage(slug)
  if (!page || page.status !== 'published') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const claims = readClaims(new URL(req.url), slug, page.signing_secret)
  if (!claims) return NextResponse.json({ items: [] })

  const cartCtx: VisitorCartContext = {
    actionPageId: page.id,
    psid: claims.psid,
    pageOwnerId: page.user_id,
    fbPageId: claims.pageId,
  }
  try {
    const cart = await loadActiveVisitorCart(admin as any, cartCtx)
    return NextResponse.json(cart)
  } catch {
    return NextResponse.json({ items: [] })
  }
}

interface PutBody {
  items?: VisitorCartItem[]
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params
  const { admin, page } = await loadPage(slug)
  if (!page || page.status !== 'published') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  let body: PutBody
  try {
    body = (await req.json()) as PutBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const items = Array.isArray(body.items)
    ? body.items
        .filter(
          (i): i is VisitorCartItem =>
            !!i && typeof i.id === 'string' && typeof i.quantity === 'number',
        )
        .map((i) => ({ id: i.id, quantity: i.quantity }))
    : []

  const url = new URL(req.url)
  // Allow claims either in query string or in body (some clients prefer body)
  const claims = readClaims(url, slug, page.signing_secret)
  if (!claims) return NextResponse.json({ skipped: true })

  const cartCtx: VisitorCartContext = {
    actionPageId: page.id,
    psid: claims.psid,
    pageOwnerId: page.user_id,
    fbPageId: claims.pageId,
  }
  try {
    await replaceVisitorCart(admin as any, cartCtx, items)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[carts] PUT failed', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'write_failed' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- src/app/api/action-pages/\[slug\]/cart/route.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/action-pages/\[slug\]/cart/route.ts src/app/api/action-pages/\[slug\]/cart/route.test.ts
git commit -m "feat(api): GET/PUT /api/action-pages/[slug]/cart for visitor carts"
```

---

### Task 4: Convert visitor cart on successful checkout submit

**Files:**
- Modify: `src/app/api/action-pages/submit/route.ts`

The catalog submit branch runs after `createBusinessOrderFromCatalog`. We mark the visitor's active cart as `converted` only when both `psid` and `fbPageId` are known (the existing route already resolves these). Failures must not break the order response.

- [ ] **Step 1: Locate the insertion point**

Run:
```bash
grep -n "createBusinessOrderFromCatalog\|businessOrderId = catalogOrderResult" \
  src/app/api/action-pages/submit/route.ts
```
Expected: a single block (around the `if (page.kind === 'catalog') { ... }` branch) where `businessOrderId` is assigned from `catalogOrderResult.orderId`. We insert immediately after the catch, inside the `if` block.

- [ ] **Step 2: Modify the submit route**

Add a new import near the existing visitor-cart imports:

```ts
import { convertVisitorCart } from '@/lib/action-pages/visitor-cart'
```

After the `catalogOrderResult = await createBusinessOrderFromCatalog(...)` success path (i.e. immediately after the closing brace of the try/catch that assigns `businessOrderId`), within the `if (page.kind === 'catalog') { ... }` block, append:

```ts
    if (psid && fbPageId) {
      try {
        await convertVisitorCart(admin, {
          actionPageId: page.id,
          psid,
          pageOwnerId: page.user_id,
          fbPageId,
        })
      } catch (e) {
        console.error(
          '[submit] convertVisitorCart failed',
          e instanceof Error ? e.message : e,
        )
      }
    }
```

- [ ] **Step 3: Add a test**

Append to `src/app/api/action-pages/submit/route.test.ts`:

```ts
import { convertVisitorCart } from '@/lib/action-pages/visitor-cart'

vi.mock('@/lib/action-pages/visitor-cart', async (orig) => {
  const actual = await (orig() as Promise<typeof import('@/lib/action-pages/visitor-cart')>)
  return { ...actual, convertVisitorCart: vi.fn().mockResolvedValue(undefined) }
})

describe('catalog submit cart conversion', () => {
  it('marks the active visitor cart as converted on successful order', async () => {
    // Reuse the existing fixture helper from this file that produces a
    // catalog submission with valid signed claims. (If no helper exists,
    // build a minimal FormData payload with slug + signed p/g/e/t + items.)
    // ... fixture setup omitted for brevity — copy the existing
    //     "catalog submit creates business_order" test as a baseline ...
    expect(convertVisitorCart).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actionPageId: expect.any(String) }),
    )
  })
})
```

> **Note for the engineer:** if `route.test.ts` already mocks `@/lib/action-pages/visitor-cart` (it shouldn't yet — this is a new module), merge the mocks. The existing test file already has fixtures for a valid catalog submission; copy that pattern and add the assertion above to confirm `convertVisitorCart` was called. Do not invent new fixtures from scratch.

- [ ] **Step 4: Run submit route tests**

```bash
npm test -- src/app/api/action-pages/submit/route.test.ts
```

Expected: existing tests pass + new conversion test passes.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/action-pages/submit/route.ts \
        src/app/api/action-pages/submit/route.test.ts
git commit -m "feat(api): convert visitor cart on successful catalog submit"
```

---

### Task 5: Hydrate + debounced sync in catalog Renderer

**Files:**
- Modify: `src/app/a/[slug]/_kinds/catalog/Renderer.tsx`

The current `quantities` state stays the source of truth. We add a hydration effect, a debounced PUT effect, and a stable URL builder that injects the signed-deeplink params.

- [ ] **Step 1: Identify exact insertion points**

Run:
```bash
grep -n "const \[quantities\|const setQty = (id: string" \
  src/app/a/\[slug\]/_kinds/catalog/Renderer.tsx
```
Expected: `quantities` declared near top of `CatalogRenderer`; `setQty` defined below the `cartLines` memo.

- [ ] **Step 2: Add the hydration + sync block**

Immediately after the `const [quantities, setQuantities] = useState<Record<string, number>>({})` line, paste this block. It uses `rawToken` and `claims` which are already passed to `CatalogRenderer` as props.

```tsx
  const cartUrl = useMemo(() => {
    if (!claims || !rawToken) return null
    const sp = new URLSearchParams()
    sp.set('p', claims.psid)
    sp.set('g', claims.pageId)
    sp.set('e', String(claims.exp))
    sp.set('t', rawToken)
    return `/api/action-pages/${page.slug}/cart?${sp.toString()}`
  }, [claims, rawToken, page.slug])

  // Hydrate from saved cart on mount.
  const hydrated = useRef(false)
  useEffect(() => {
    if (!cartUrl || hydrated.current) return
    hydrated.current = true
    fetch(cartUrl, { method: 'GET' })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((body: { items?: { id: string; quantity: number }[] }) => {
        const next: Record<string, number> = {}
        for (const i of body.items ?? []) {
          if (i.id && typeof i.quantity === 'number' && i.quantity > 0) {
            next[i.id] = Math.min(999, Math.floor(i.quantity))
          }
        }
        if (Object.keys(next).length > 0) {
          startTransition(() => setQuantities(next))
        }
      })
      .catch(() => {
        /* network/parse failure → keep local state */
      })
  }, [cartUrl, startTransition])

  // Debounced write of the current quantities to the server.
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef(false)
  const pendingSnapshot = useRef<Record<string, number> | null>(null)

  useEffect(() => {
    if (!cartUrl) return
    if (!hydrated.current) return
    if (writeTimer.current) clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(() => {
      const snapshot = { ...quantities }
      if (inFlight.current) {
        pendingSnapshot.current = snapshot
        return
      }
      void sendSnapshot(snapshot)
    }, 500)
    return () => {
      if (writeTimer.current) clearTimeout(writeTimer.current)
    }

    async function sendSnapshot(snap: Record<string, number>) {
      inFlight.current = true
      try {
        const items = Object.entries(snap)
          .filter(([, q]) => q > 0)
          .map(([id, quantity]) => ({ id, quantity }))
        await fetch(cartUrl!, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items }),
        })
      } catch {
        /* swallow — visitor's local state is still correct */
      } finally {
        inFlight.current = false
        if (pendingSnapshot.current) {
          const queued = pendingSnapshot.current
          pendingSnapshot.current = null
          void sendSnapshot(queued)
        }
      }
    }
  }, [quantities, cartUrl])
```

- [ ] **Step 3: Build the page**

```bash
npm run build
```

Expected: type-check + build succeed.

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```

Open a published catalog page in a browser at `/a/<slug>?p=<psid>&g=<pageId>&e=<exp>&t=<token>` using a valid signed link (generate via the existing Messenger flow, or use `signDeeplink` from a Node REPL).

Verify:
- Add an item → in DevTools Network, observe a `PUT /api/action-pages/<slug>/cart` ~500 ms after the click with the items payload.
- Refresh the page → on load, `GET /api/action-pages/<slug>/cart` returns the items, cart badge shows the same count.
- Open the page in a separate browser tab without `p/g/e/t` → no requests fire; cart behaves as before.

State explicitly: "I verified hydration on refresh + debounced PUT in browser." If the dev server can't be exercised in this environment, say so explicitly and skip the manual step.

- [ ] **Step 5: Commit**

```bash
git add src/app/a/\[slug\]/_kinds/catalog/Renderer.tsx
git commit -m "feat(catalog): hydrate + debounced sync for visitor cart persistence"
```

---

### Task 6: Server action — loadLeadCarts

**Files:**
- Create: `src/app/(app)/dashboard/leads/actions/carts.ts`

Mirrors `actions/orders.ts`. Reads the carts table via the authenticated server client (owner RLS applies).

- [ ] **Step 1: Write the server action**

```ts
// src/app/(app)/dashboard/leads/actions/carts.ts
'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export interface LeadCartItem {
  id: string
  product_id: string | null
  name: string
  quantity: number
  unit_price: number
  image_url: string | null
}

export interface LeadCart {
  id: string
  status: 'active' | 'abandoned' | 'converted'
  source: string | null
  currency: string
  total_amount: number | null
  action_page_title: string | null
  created_at: string
  updated_at: string
  abandoned_at: string | null
  converted_at: string | null
  items: LeadCartItem[]
}

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function loadLeadCarts(leadId: string): Promise<LeadCart[]> {
  const { supabase } = await requireUser()
  const { data: carts, error } = await supabase
    .from('carts')
    .select(
      'id, status, source, currency, total_amount, action_page_id, created_at, updated_at, abandoned_at, converted_at, action_pages(title)',
    )
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(`loadLeadCarts: ${error.message}`)
  if (!carts || carts.length === 0) return []

  const cartIds = carts.map((c) => c.id as string)
  const { data: items, error: itemErr } = await supabase
    .from('cart_items')
    .select('id, cart_id, product_id, name, quantity, unit_price, image_url')
    .in('cart_id', cartIds)
    .order('created_at', { ascending: true })
  if (itemErr) throw new Error(`loadLeadCarts items: ${itemErr.message}`)

  const byCart = new Map<string, LeadCartItem[]>()
  for (const row of items ?? []) {
    const cid = row.cart_id as string
    const list = byCart.get(cid) ?? []
    list.push({
      id: row.id as string,
      product_id: (row.product_id as string | null) ?? null,
      name: row.name as string,
      quantity: Number(row.quantity),
      unit_price: Number(row.unit_price),
      image_url: (row.image_url as string | null) ?? null,
    })
    byCart.set(cid, list)
  }

  return carts.map((c) => {
    const ap = c.action_pages as { title?: string } | { title?: string }[] | null
    const apTitle = Array.isArray(ap) ? ap[0]?.title ?? null : ap?.title ?? null
    return {
      id: c.id as string,
      status: c.status as LeadCart['status'],
      source: (c.source as string | null) ?? null,
      currency: (c.currency as string) ?? 'USD',
      total_amount:
        c.total_amount === null || c.total_amount === undefined
          ? null
          : Number(c.total_amount),
      action_page_title: apTitle,
      created_at: c.created_at as string,
      updated_at: c.updated_at as string,
      abandoned_at: (c.abandoned_at as string | null) ?? null,
      converted_at: (c.converted_at as string | null) ?? null,
      items: byCart.get(c.id as string) ?? [],
    }
  })
}
```

- [ ] **Step 2: Build to type-check**

```bash
npm run build
```

Expected: builds cleanly.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/actions/carts.ts
git commit -m "feat(leads): loadLeadCarts server action"
```

---

### Task 7: CartsPanel component

**Files:**
- Create: `src/app/(app)/dashboard/leads/_components/CartsPanel.tsx`

Read-only listing modelled on `OrdersPanel.tsx`. Each cart renders status badge + action page + line items + total.

- [ ] **Step 1: Write the component**

```tsx
// src/app/(app)/dashboard/leads/_components/CartsPanel.tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import { loadLeadCarts, type LeadCart } from '../actions/carts'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rows: LeadCart[] }

export function CartsPanel({ leadId }: { leadId: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    startTransition(() => setState({ kind: 'loading' }))
    loadLeadCarts(leadId)
      .then((rows) => {
        if (!cancelled) startTransition(() => setState({ kind: 'ready', rows }))
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          startTransition(() =>
            setState({
              kind: 'error',
              message: e instanceof Error ? e.message : 'Failed to load',
            }),
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [leadId, startTransition])

  if (state.kind === 'loading') {
    return (
      <div className="text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
        Loading carts…
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className="text-[12.5px]" style={{ color: 'var(--lead-danger)' }}>
        {state.message}
      </div>
    )
  }
  if (state.rows.length === 0) {
    return (
      <div
        className="rounded-lg p-4 text-[12.5px]"
        style={{
          background: 'var(--lead-surface-2)',
          border: '1px solid var(--lead-line)',
          color: 'var(--lead-muted)',
        }}
      >
        No carts for this lead yet.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {state.rows.map((c) => (
        <CartCard key={c.id} cart={c} />
      ))}
    </div>
  )
}

function CartCard({ cart }: { cart: LeadCart }) {
  const [open, setOpen] = useState(false)
  const when = new Date(cart.created_at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  const itemCount = cart.items.reduce((sum, i) => sum + i.quantity, 0)
  const subtotal =
    cart.total_amount ??
    cart.items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0)

  return (
    <div
      className="rounded-lg"
      style={{
        background: 'var(--lead-surface)',
        border: '1px solid var(--lead-line)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="lead-focus flex w-full items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{
            background: 'var(--lead-surface-2)',
            color: 'var(--lead-muted)',
          }}
        >
          Cart
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-medium"
          style={{ color: 'var(--lead-ink)' }}
        >
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
          {cart.action_page_title ? ` · ${cart.action_page_title}` : ''}
          {' · '}
          {formatMoney(subtotal, cart.currency)}
        </span>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
          style={{
            background: statusBg(cart.status),
            color: statusFg(cart.status),
          }}
        >
          {cart.status}
        </span>
        <span
          className="shrink-0 text-[11px] tabular-nums"
          style={{ color: 'var(--lead-faint)' }}
        >
          {when}
        </span>
      </button>
      {open && (
        <div
          className="border-t px-3 py-2.5"
          style={{ borderColor: 'var(--lead-line)' }}
        >
          {cart.items.length === 0 ? (
            <div
              className="text-[12.5px]"
              style={{ color: 'var(--lead-muted)' }}
            >
              Empty cart.
            </div>
          ) : (
            <table className="w-full text-[12.5px]">
              <tbody>
                {cart.items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-1.5 pr-2" style={{ color: 'var(--lead-ink)' }}>
                      <span className="font-medium">{item.name}</span>
                    </td>
                    <td
                      className="px-2 py-1.5 text-right tabular-nums"
                      style={{ color: 'var(--lead-muted)' }}
                    >
                      × {item.quantity}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right tabular-nums"
                      style={{ color: 'var(--lead-muted)' }}
                    >
                      {formatMoney(item.unit_price, cart.currency)}
                    </td>
                    <td
                      className="py-1.5 pl-2 text-right tabular-nums"
                      style={{ color: 'var(--lead-ink)' }}
                    >
                      {formatMoney(item.unit_price * item.quantity, cart.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '1px solid var(--lead-line)' }}>
                  <td
                    colSpan={3}
                    className="py-2 pr-2 text-right text-[11.5px] font-medium"
                    style={{ color: 'var(--lead-muted)' }}
                  >
                    Subtotal
                  </td>
                  <td
                    className="py-2 pl-2 text-right text-[13px] font-semibold tabular-nums"
                    style={{ color: 'var(--lead-ink)' }}
                  >
                    {formatMoney(subtotal, cart.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount}`
  }
}

function statusBg(status: LeadCart['status']): string {
  if (status === 'converted') return 'rgba(5,150,105,0.12)'
  if (status === 'abandoned') return 'rgba(217,119,6,0.12)'
  return 'var(--lead-surface-2)'
}

function statusFg(status: LeadCart['status']): string {
  if (status === 'converted') return '#047857'
  if (status === 'abandoned') return '#B45309'
  return 'var(--lead-body)'
}
```

- [ ] **Step 2: Build to type-check**

```bash
npm run build
```

Expected: builds cleanly.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/_components/CartsPanel.tsx
git commit -m "feat(leads): CartsPanel read-only list for the lead drawer"
```

---

### Task 8: Wire CartsPanel into LeadDrawer

**Files:**
- Modify: `src/app/(app)/dashboard/leads/_components/LeadDrawer.tsx`

- [ ] **Step 1: Locate exact lines**

Run:
```bash
grep -n "OrdersPanel\|'orders',\|tab === 'orders'\|type Tab" \
  src/app/\(app\)/dashboard/leads/_components/LeadDrawer.tsx
```
Expected: shows the import line, the `Tab` union, the tab-list array (`'orders'` inside it), and the conditional render block (`tab === 'orders'`).

- [ ] **Step 2: Add the import**

Right below the existing `import { OrdersPanel } from './OrdersPanel'` line:

```tsx
import { CartsPanel } from './CartsPanel'
```

- [ ] **Step 3: Extend the Tab union**

Find:
```tsx
type Tab =
  | 'details'
  | 'conversation'
  | 'comments'
  | 'orders'
  | 'appointments'
  | 'forms'
```
Change to:
```tsx
type Tab =
  | 'details'
  | 'conversation'
  | 'comments'
  | 'orders'
  | 'carts'
  | 'appointments'
  | 'forms'
```

- [ ] **Step 4: Add to the tab list**

Find the array around line 210 with `'orders'` and add `'carts'` immediately after it. (Search for the exact line via `grep -n "'orders',"`.)

Replace:
```tsx
                'orders',
```
With:
```tsx
                'orders',
                'carts',
```

- [ ] **Step 5: Render the panel**

Find the existing block (around line 256-257):
```tsx
          ) : mode === 'edit' && tab === 'orders' ? (
            <OrdersPanel leadId={form.id} />
```
Insert a new branch immediately after the `<OrdersPanel ... />` closing line and before the next `) :`:

```tsx
          ) : mode === 'edit' && tab === 'carts' ? (
            <CartsPanel leadId={form.id} />
```

- [ ] **Step 6: Build + smoke test in dev**

```bash
npm run build && npm run dev
```

Open the dashboard, click a lead that has carts (or run a catalog session beforehand). Verify:
- The "Carts" tab appears between Orders and Appointments.
- Clicking it loads the panel.
- Carts with items render their lines, status, and totals.
- Leads with no carts show the empty state.

State explicitly: "I verified the Carts tab end-to-end in dev." If the dev environment isn't usable in this run, say so explicitly.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/_components/LeadDrawer.tsx
git commit -m "feat(leads): add Carts tab to lead drawer"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: green; specifically the new files
- `src/lib/action-pages/visitor-cart.test.ts`
- `src/app/api/action-pages/[slug]/cart/route.test.ts`
- updated `src/app/api/action-pages/submit/route.test.ts`

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 3: Final build**

```bash
npm run build
```

Expected: clean.

- [ ] **Step 4: Confirmation summary**

Write a one-paragraph summary of: migration applied, new files, key behavior changes, what was manually verified vs. only tested in unit tests. Do not claim "feature complete" — describe what was actually verified.

---

## Self-review notes

- Spec section 1 (data model) → Task 1.
- Spec section 2 (API routes) → Tasks 2 + 3.
- Spec section "Convert on checkout" → Task 4.
- Spec section 3 (Renderer changes) → Task 5.
- Spec section "Lead Drawer — Carts tab" → Tasks 6 + 7 + 8.
- Spec section "Abandoned-cart workflow" → no code changes (inherits automatically once `lead_id` is set during Task 2 cart creation).
- Spec testing checklist → covered in Tasks 2, 3, 4, and the final verification step.
