# My Business Product Catalog Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the My Business foundation with product management, item-level RAG sources, catalog action pages, and unpaid order capture.

**Architecture:** Add normalized Supabase tables for business profiles, items, media, orders, and order line items. Extend the existing RAG source model from `document | faq` to `document | faq | business_item`. Reuse the existing Action Pages `catalog` kind so public catalog pages render published My Business products and submit unpaid orders.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase Postgres/RLS/Storage, `@supabase/ssr`, Zod 4, Vitest, Tailwind CSS 4. Before touching Next route/server-action code, read `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md` and `node_modules/next/dist/docs/01-app/02-guides/data-security.md`.

**Spec:** `docs/superpowers/specs/2026-04-30-my-business-product-catalog-foundation-design.md`

---

## Scope Check

This plan intentionally builds one cohesive vertical slice:

- shared My Business schema
- product item type
- item-level RAG ingestion
- public catalog renderer
- unpaid order capture
- owner product and order surfaces

Property listings, digital products, services, payment methods, and Messenger carousel delivery are out of this implementation plan.

## File Structure

**Create:**

```text
supabase/migrations/<generated>_my_business_product_catalog_foundation.sql

src/lib/business/
  types.ts
  schemas.ts
  pricing.ts
  product-rag.ts
  product-rag.test.ts
  public-dto.ts
  public-dto.test.ts

src/app/(app)/dashboard/business/
  page.tsx
  products/page.tsx
  products/new/page.tsx
  products/[id]/page.tsx
  products/actions.ts
  orders/page.tsx
  orders/[id]/page.tsx
  orders/actions.ts
  _lib/queries.ts
  _components/ProductList.tsx
  _components/ProductEditor.tsx
  _components/ProductPreviewCard.tsx
  _components/OrderList.tsx

src/lib/action-pages/handlers/catalog.ts
src/lib/action-pages/handlers/catalog.test.ts
```

**Modify:**

```text
src/app/(app)/_components/sidebar.tsx
src/lib/rag/types.ts
src/lib/rag/parsers/index.ts
src/lib/rag/ingest.ts
src/lib/rag/queue.ts
src/lib/rag/worker/embed-job.ts
src/lib/rag/worker/embed-job.test.ts
src/lib/rag/retriever.ts
src/lib/chatbot/answer.ts
src/lib/action-pages/handlers/index.ts
src/app/a/[slug]/_lib/load.ts
src/app/a/[slug]/_kinds/types.ts
src/app/a/[slug]/_kinds/catalog/Renderer.tsx
src/app/a/[slug]/page.tsx
src/app/api/action-pages/submit/route.ts
```

---

### Task 1: Database Foundation and Storage

**Files:**
- Create: `supabase/migrations/<generated>_my_business_product_catalog_foundation.sql`

- [ ] **Step 1: Create the migration with Supabase CLI**

Run:

```bash
supabase migration new my_business_product_catalog_foundation
```

Expected: a new file like `supabase/migrations/20260430HHMMSS_my_business_product_catalog_foundation.sql`.

- [ ] **Step 2: Put this SQL in the generated migration**

```sql
-- =========================================================================
-- My Business product catalog foundation.
-- =========================================================================

create table public.business_profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  display_name      text not null check (char_length(display_name) between 1 and 120),
  description       text check (description is null or char_length(description) <= 2000),
  default_currency  text not null default 'PHP' check (default_currency ~ '^[A-Z]{3}$'),
  contact_email     text check (contact_email is null or char_length(contact_email) <= 320),
  contact_phone     text check (contact_phone is null or char_length(contact_phone) <= 40),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id)
);

create table public.business_items (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  kind                  text not null check (kind in ('product','property','digital','service')),
  status                text not null default 'draft' check (status in ('draft','published','archived')),
  title                 text not null check (char_length(title) between 1 and 160),
  slug                  text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  summary               text check (summary is null or char_length(summary) <= 280),
  description           text check (description is null or char_length(description) <= 8000),
  price_amount          numeric(12,2) check (price_amount is null or price_amount >= 0),
  compare_at_amount     numeric(12,2) check (compare_at_amount is null or compare_at_amount >= 0),
  currency              text not null default 'PHP' check (currency ~ '^[A-Z]{3}$'),
  pricing_model         text not null default 'fixed' check (pricing_model in ('fixed','starts_at','quote','free')),
  sku                   text check (sku is null or char_length(sku) <= 80),
  inventory_status      text not null default 'not_tracked'
                          check (inventory_status in ('in_stock','limited','out_of_stock','preorder','not_tracked')),
  tags                  text[] not null default '{}',
  details               jsonb not null default '{}'::jsonb,
  recommendation_hints  jsonb not null default '{}'::jsonb,
  rag_enabled           boolean not null default true,
  rag_text              text,
  embedding_status      text not null default 'pending' check (embedding_status in ('pending','indexed','stale')),
  version               integer not null default 0 check (version >= 0),
  embedded_at           timestamptz,
  published_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, kind, slug)
);

create table public.business_item_media (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  item_id       uuid not null references public.business_items(id) on delete cascade,
  kind          text not null check (kind in ('image','video','file')),
  storage_path  text not null check (char_length(storage_path) between 1 and 600),
  alt_text      text check (alt_text is null or char_length(alt_text) <= 240),
  position      integer not null default 0 check (position >= 0),
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now()
);

create table public.business_orders (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  action_page_id    uuid references public.action_pages(id) on delete set null,
  lead_id           uuid references public.leads(id) on delete set null,
  psid              text,
  page_id           uuid references public.facebook_pages(id) on delete set null,
  status            text not null default 'new' check (status in ('new','confirmed','cancelled','fulfilled')),
  payment_status    text not null default 'unpaid' check (payment_status in ('unpaid','pending','paid','failed','refunded')),
  currency          text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal_amount   numeric(12,2) not null check (subtotal_amount >= 0),
  customer_name     text check (customer_name is null or char_length(customer_name) <= 160),
  customer_email    text check (customer_email is null or char_length(customer_email) <= 320),
  customer_phone    text check (customer_phone is null or char_length(customer_phone) <= 40),
  customer_notes    text check (customer_notes is null or char_length(customer_notes) <= 2000),
  meta              jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.business_order_items (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.business_orders(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  business_item_id   uuid references public.business_items(id) on delete set null,
  title_snapshot     text not null check (char_length(title_snapshot) between 1 and 160),
  sku_snapshot       text check (sku_snapshot is null or char_length(sku_snapshot) <= 80),
  quantity           integer not null check (quantity between 1 and 999),
  unit_amount        numeric(12,2) not null check (unit_amount >= 0),
  currency           text not null check (currency ~ '^[A-Z]{3}$'),
  line_total_amount  numeric(12,2) not null check (line_total_amount >= 0),
  created_at         timestamptz not null default now()
);

alter table public.knowledge_chunks
  add column business_item_id uuid references public.business_items(id) on delete cascade;

alter table public.knowledge_chunks
  drop constraint if exists knowledge_chunks_one_source;

alter table public.knowledge_chunks
  add constraint knowledge_chunks_one_source
  check (num_nonnulls(document_id, faq_id, business_item_id) = 1);

alter table public.knowledge_chunks
  add constraint knowledge_chunks_item_chunk_uniq unique (business_item_id, chunk_index);

alter table public.knowledge_embedding_jobs
  add column business_item_id uuid references public.business_items(id) on delete cascade;

alter table public.knowledge_embedding_jobs
  drop constraint if exists knowledge_embedding_jobs_one_source;

alter table public.knowledge_embedding_jobs
  add constraint knowledge_embedding_jobs_one_source
  check (num_nonnulls(document_id, faq_id, business_item_id) = 1);

create unique index knowledge_embedding_jobs_active_item_uniq
  on public.knowledge_embedding_jobs (business_item_id)
  where business_item_id is not null and status in ('queued','running');

create index business_profiles_user_idx on public.business_profiles (user_id);
create index business_items_user_kind_status_idx on public.business_items (user_id, kind, status, updated_at desc);
create index business_items_search_idx on public.business_items using gin (
  to_tsvector('simple',
    coalesce(title,'') || ' ' ||
    coalesce(summary,'') || ' ' ||
    coalesce(description,'') || ' ' ||
    coalesce(array_to_string(tags, ' '),'') || ' ' ||
    coalesce(rag_text,'')
  )
);
create index business_item_media_item_idx on public.business_item_media (item_id, position);
create index business_orders_user_created_idx on public.business_orders (user_id, created_at desc);
create index business_order_items_order_idx on public.business_order_items (order_id);

create trigger business_profiles_set_updated_at
before update on public.business_profiles
for each row execute function public.set_updated_at();

create trigger business_items_set_updated_at
before update on public.business_items
for each row execute function public.set_updated_at();

create trigger business_orders_set_updated_at
before update on public.business_orders
for each row execute function public.set_updated_at();

alter table public.business_profiles enable row level security;
alter table public.business_items enable row level security;
alter table public.business_item_media enable row level security;
alter table public.business_orders enable row level security;
alter table public.business_order_items enable row level security;

create policy business_profiles_owner_all on public.business_profiles
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy business_items_owner_all on public.business_items
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy business_item_media_owner_all on public.business_item_media
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy business_orders_owner_all on public.business_orders
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy business_order_items_owner_all on public.business_order_items
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'business-media',
  'business-media',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
```

- [ ] **Step 3: Verify migration locally**

Run:

```bash
supabase db reset
npm test -- --runInBand
```

Expected: database reset succeeds; Vitest runs. If `--runInBand` is not accepted by Vitest 4 in this project, run `npm test`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "feat(db): add my business catalog foundation"
```

---

### Task 2: Business Schemas, Pricing, and RAG Text

**Files:**
- Create: `src/lib/business/types.ts`
- Create: `src/lib/business/schemas.ts`
- Create: `src/lib/business/pricing.ts`
- Create: `src/lib/business/product-rag.ts`
- Create: `src/lib/business/product-rag.test.ts`

- [ ] **Step 1: Write tests for RAG text generation**

Create `src/lib/business/product-rag.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildProductRagText } from './product-rag'

describe('buildProductRagText', () => {
  it('includes public product and recommendation fields', () => {
    const text = buildProductRagText({
      title: 'Starter Whitening Kit',
      summary: 'For first-time users.',
      description: 'A gentle kit for visible whitening.',
      price_amount: 1299,
      currency: 'PHP',
      pricing_model: 'fixed',
      details: {
        features: ['Gentle formula'],
        specifications: [{ name: 'Duration', value: '14 days' }],
        included: ['Tray', 'Gel'],
        availability_note: 'Ships this week',
      },
      recommendation_hints: {
        budget_min: 1000,
        budget_max: 1500,
        desired_results: ['whiter teeth'],
        best_for: ['beginners'],
        not_for: ['children'],
        keywords: ['teeth whitening'],
      },
    })

    expect(text).toContain('Starter Whitening Kit')
    expect(text).toContain('Price: PHP 1299')
    expect(text).toContain('Desired results: whiter teeth')
    expect(text).toContain('Duration: 14 days')
  })

  it('does not include unknown private fields from details or hints', () => {
    const text = buildProductRagText({
      title: 'Private Test Product',
      summary: null,
      description: null,
      price_amount: null,
      currency: 'PHP',
      pricing_model: 'quote',
      details: { internal_cost: '10', features: [] },
      recommendation_hints: { owner_note: 'never expose', keywords: [] },
    })

    expect(text).toContain('Private Test Product')
    expect(text).not.toContain('internal_cost')
    expect(text).not.toContain('owner_note')
    expect(text).not.toContain('never expose')
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

```bash
npx vitest run src/lib/business/product-rag.test.ts
```

Expected: fails because `product-rag.ts` does not exist.

- [ ] **Step 3: Create `src/lib/business/types.ts`**

```ts
export type BusinessItemKind = 'product' | 'property' | 'digital' | 'service'
export type BusinessItemStatus = 'draft' | 'published' | 'archived'
export type PricingModel = 'fixed' | 'starts_at' | 'quote' | 'free'
export type InventoryStatus =
  | 'in_stock'
  | 'limited'
  | 'out_of_stock'
  | 'preorder'
  | 'not_tracked'

export interface ProductDetails {
  features: string[]
  specifications: { name: string; value: string }[]
  included: string[]
  availability_note: string | null
}

export interface ProductRecommendationHints {
  budget_min: number | null
  budget_max: number | null
  desired_results: string[]
  best_for: string[]
  not_for: string[]
  keywords: string[]
}

export interface ProductRagInput {
  title: string
  summary: string | null
  description: string | null
  price_amount: number | null
  currency: string
  pricing_model: PricingModel
  details: unknown
  recommendation_hints: unknown
}
```

- [ ] **Step 4: Create `src/lib/business/schemas.ts`**

```ts
import { z } from 'zod'

export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/)
export const BusinessItemStatusSchema = z.enum(['draft', 'published', 'archived'])
export const PricingModelSchema = z.enum(['fixed', 'starts_at', 'quote', 'free'])
export const InventoryStatusSchema = z.enum([
  'in_stock',
  'limited',
  'out_of_stock',
  'preorder',
  'not_tracked',
])

export const ProductDetailsSchema = z.object({
  features: z.array(z.string().trim().min(1).max(160)).max(30).default([]),
  specifications: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        value: z.string().trim().min(1).max(160),
      }),
    )
    .max(40)
    .default([]),
  included: z.array(z.string().trim().min(1).max(160)).max(30).default([]),
  availability_note: z.string().trim().max(240).nullable().default(null),
})

export const ProductRecommendationHintsSchema = z.object({
  budget_min: z.coerce.number().nonnegative().nullable().default(null),
  budget_max: z.coerce.number().nonnegative().nullable().default(null),
  desired_results: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  best_for: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  not_for: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  keywords: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
})

export const ProductFormInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
  status: BusinessItemStatusSchema,
  summary: z.string().trim().max(280).nullable().default(null),
  description: z.string().trim().max(8000).nullable().default(null),
  price_amount: z.coerce.number().nonnegative().nullable().default(null),
  compare_at_amount: z.coerce.number().nonnegative().nullable().default(null),
  currency: CurrencyCode.default('PHP'),
  pricing_model: PricingModelSchema.default('fixed'),
  sku: z.string().trim().max(80).nullable().default(null),
  inventory_status: InventoryStatusSchema.default('not_tracked'),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  details: ProductDetailsSchema.default({}),
  recommendation_hints: ProductRecommendationHintsSchema.default({}),
  rag_enabled: z.boolean().default(true),
})

export type ProductFormInput = z.infer<typeof ProductFormInput>
```

- [ ] **Step 5: Create `src/lib/business/pricing.ts`**

```ts
import type { PricingModel } from './types'

export function formatPrice(args: {
  amount: number | null
  currency: string
  pricingModel: PricingModel
}): string {
  if (args.pricingModel === 'free') return 'Free'
  if (args.pricingModel === 'quote') return 'Contact for price'
  if (args.amount === null) return 'Contact for price'
  const formatted = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: args.currency,
    maximumFractionDigits: 2,
  }).format(args.amount)
  return args.pricingModel === 'starts_at' ? `Starts at ${formatted}` : formatted
}

export function lineTotal(unitAmount: number, quantity: number): number {
  return Math.round(unitAmount * quantity * 100) / 100
}
```

- [ ] **Step 6: Create `src/lib/business/product-rag.ts`**

```ts
import {
  ProductDetailsSchema,
  ProductRecommendationHintsSchema,
} from './schemas'
import type { ProductRagInput } from './types'

function addLine(lines: string[], label: string, value: unknown): void {
  if (typeof value === 'string' && value.trim()) lines.push(`${label}: ${value.trim()}`)
  if (typeof value === 'number') lines.push(`${label}: ${value}`)
}

function addList(lines: string[], label: string, values: string[]): void {
  const clean = values.map((v) => v.trim()).filter(Boolean)
  if (clean.length) lines.push(`${label}: ${clean.join(', ')}`)
}

export function buildProductRagText(input: ProductRagInput): string {
  const details = ProductDetailsSchema.parse(input.details ?? {})
  const hints = ProductRecommendationHintsSchema.parse(input.recommendation_hints ?? {})
  const lines: string[] = [`Product: ${input.title}`]

  addLine(lines, 'Summary', input.summary)
  addLine(lines, 'Description', input.description)

  if (input.pricing_model === 'quote') {
    lines.push('Price: Contact for price')
  } else if (input.pricing_model === 'free') {
    lines.push('Price: Free')
  } else if (input.price_amount !== null) {
    const prefix = input.pricing_model === 'starts_at' ? 'Starts at' : 'Price'
    lines.push(`${prefix}: ${input.currency} ${input.price_amount}`)
  }

  addList(lines, 'Features', details.features)
  addList(lines, 'Included', details.included)
  for (const spec of details.specifications) {
    lines.push(`${spec.name}: ${spec.value}`)
  }
  addLine(lines, 'Availability', details.availability_note)

  if (hints.budget_min !== null || hints.budget_max !== null) {
    lines.push(`Budget range: ${hints.budget_min ?? 0} to ${hints.budget_max ?? 'any'} ${input.currency}`)
  }
  addList(lines, 'Desired results', hints.desired_results)
  addList(lines, 'Best for', hints.best_for)
  addList(lines, 'Not for', hints.not_for)
  addList(lines, 'Keywords', hints.keywords)

  return lines.join('\n')
}
```

- [ ] **Step 7: Run tests**

```bash
npx vitest run src/lib/business/product-rag.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/business
git commit -m "feat(business): add product validation and rag text helpers"
```

---

### Task 3: Extend RAG to Business Items

**Files:**
- Modify: `src/lib/rag/types.ts`
- Modify: `src/lib/rag/parsers/index.ts`
- Modify: `src/lib/rag/ingest.ts`
- Modify: `src/lib/rag/queue.ts`
- Modify: `src/lib/rag/worker/embed-job.ts`
- Modify: `src/lib/rag/worker/embed-job.test.ts`
- Modify: `src/lib/rag/retriever.ts`
- Modify: `src/lib/chatbot/answer.ts`

- [ ] **Step 1: Add parser test case**

In `src/lib/rag/chunker.test.ts` or a new `src/lib/rag/parsers/business-item.test.ts`, add:

```ts
import { describe, expect, it } from 'vitest'
import { parse } from './index'

describe('parse business item', () => {
  it('treats product rag text as an atomic business item source', () => {
    const parsed = parse({
      kind: 'business_item',
      title: 'Starter Whitening Kit',
      ragText: 'Product: Starter Whitening Kit\nPrice: PHP 1299',
    })

    expect(parsed.kind).toBe('business_item')
    expect(parsed.title).toBe('Starter Whitening Kit')
    expect(parsed.markdown).toContain('Price: PHP 1299')
    expect(parsed.atomic).toBe(true)
  })
})
```

- [ ] **Step 2: Run the new test and verify failure**

```bash
npx vitest run src/lib/rag/parsers/business-item.test.ts
```

Expected: fails because `business_item` is not in `ParseInput`.

- [ ] **Step 3: Update RAG source types**

In `src/lib/rag/types.ts`, change:

```ts
export type SourceKind = 'document' | 'faq';
```

to:

```ts
export type SourceKind = 'document' | 'faq' | 'business_item';
```

- [ ] **Step 4: Update parser union**

In `src/lib/rag/parsers/index.ts`, use this full union and switch:

```ts
export type ParseInput =
  | { kind: 'document'; title: string; contentJson: unknown }
  | { kind: 'faq'; question: string; answer: string }
  | { kind: 'business_item'; title: string; ragText: string };

export function parse(input: ParseInput): ParsedSource {
  switch (input.kind) {
    case 'document':
      return parseTiptap(input);
    case 'faq':
      return parseFaq(input);
    case 'business_item':
      return {
        kind: 'business_item',
        title: input.title,
        markdown: input.ragText.replace(/\r\n?/g, '\n').trim(),
        atomic: true,
      };
  }
}
```

- [ ] **Step 5: Update source-column helpers in `ingest.ts`**

Replace the document/faq ternaries with helpers:

```ts
function sourceColumns(kind: SourceKind): {
  sourceCol: 'document_id' | 'faq_id' | 'business_item_id'
  nullCols: ('document_id' | 'faq_id' | 'business_item_id')[]
} {
  if (kind === 'document') return { sourceCol: 'document_id', nullCols: ['faq_id', 'business_item_id'] }
  if (kind === 'faq') return { sourceCol: 'faq_id', nullCols: ['document_id', 'business_item_id'] }
  return { sourceCol: 'business_item_id', nullCols: ['document_id', 'faq_id'] }
}
```

Then in `applyIngest`, build rows with:

```ts
const { sourceCol, nullCols } = sourceColumns(source.kind);
const rows = toEmbed.map((c, i) => ({
  [sourceCol]: source.sourceId,
  [nullCols[0]]: null,
  [nullCols[1]]: null,
  user_id: source.userId,
  chunk_index: c.chunkIndex,
  content: c.content,
  heading_path: c.headingPath,
  source_offset: c.sourceOffset
    ? `[${c.sourceOffset.start},${c.sourceOffset.end})`
    : null,
  token_count: c.tokenCount,
  content_hash: c.contentHash,
  is_atomic: c.isAtomic,
  embedding: vectors[i],
}));
```

Use the same `sourceColumns` helper in `loadExistingChunks`.

- [ ] **Step 6: Update queue source mapping**

In `src/lib/rag/queue.ts`, replace source mapping with:

```ts
function sourceMeta(kind: SourceKind): {
  sourceCol: 'document_id' | 'faq_id' | 'business_item_id'
  sourceTable: 'knowledge_documents' | 'knowledge_faqs' | 'business_items'
} {
  if (kind === 'document') return { sourceCol: 'document_id', sourceTable: 'knowledge_documents' }
  if (kind === 'faq') return { sourceCol: 'faq_id', sourceTable: 'knowledge_faqs' }
  return { sourceCol: 'business_item_id', sourceTable: 'business_items' }
}
```

Use `sourceMeta(args.kind)` where the file currently chooses document/faq columns.

- [ ] **Step 7: Update worker row and fetchers**

In `src/lib/rag/worker/embed-job.ts`:

```ts
export interface EmbedJobRow {
  id: string;
  document_id: string | null;
  faq_id: string | null;
  business_item_id: string | null;
  user_id: string;
  attempts: number;
  source_version: number;
}

export interface SourceFetchers {
  fetchDocument: (id: string) => Promise<{ title: string; contentJson: unknown; version?: number }>;
  fetchFaq: (id: string) => Promise<{ question: string; answer: string; version?: number }>;
  fetchBusinessItem: (id: string) => Promise<{ title: string; ragText: string; version?: number }>;
}
```

Select `business_item_id` in `claimJobs`. Add this branch to `buildParseInput`:

```ts
if (job.business_item_id) {
  const item = await fetchers.fetchBusinessItem(job.business_item_id);
  return {
    kind: 'business_item',
    sourceId: job.business_item_id,
    sourceVersion: item.version ?? 0,
    parseInput: { kind: 'business_item', title: item.title, ragText: item.ragText },
  };
}
```

Change the source table after `applyIngest` to:

```ts
const sourceTable =
  kind === 'document'
    ? 'knowledge_documents'
    : kind === 'faq'
      ? 'knowledge_faqs'
      : 'business_items';
```

- [ ] **Step 8: Include pending business items**

In `enqueuePendingSources`, add a third query:

```ts
client
  .from('business_items')
  .select('id, user_id, version')
  .eq('kind', 'product')
  .eq('status', 'published')
  .eq('rag_enabled', true)
  .in('embedding_status', ['pending', 'stale'])
  .not('rag_text', 'is', null)
  .limit(limit)
```

Loop rows with `enqueueEmbedJob(client, { kind: 'business_item', sourceId: row.id, userId: row.user_id, sourceVersion: row.version ?? 0 })`.

- [ ] **Step 9: Extend retrieval title resolution**

In `src/lib/rag/retriever.ts`, add `business_item_id: string | null` to `RetrievedChunk` and map raw rows accordingly.

In `src/lib/chatbot/answer.ts`, select `business_item_id` from `knowledge_chunks`, collect item IDs, query `business_items` for `id, title`, and resolve titles in this precedence:

```ts
const title =
  (c.document_id && docTitle.get(c.document_id)) ||
  (c.faq_id && faqTitle.get(c.faq_id)) ||
  (c.business_item_id && itemTitle.get(c.business_item_id)) ||
  null
```

- [ ] **Step 10: Run focused RAG tests**

```bash
npx vitest run src/lib/rag/parsers/business-item.test.ts src/lib/rag/worker/embed-job.test.ts src/lib/rag/retriever.test.ts
```

Expected: pass.

- [ ] **Step 11: Commit**

```bash
git add src/lib/rag src/lib/chatbot/answer.ts
git commit -m "feat(rag): add business item sources"
```

---

### Task 4: Business Data Access and Product Actions

**Files:**
- Create: `src/app/(app)/dashboard/business/_lib/queries.ts`
- Create: `src/app/(app)/dashboard/business/products/actions.ts`
- Modify: `src/app/(app)/_components/sidebar.tsx`

- [ ] **Step 1: Create query DTOs**

Create `src/app/(app)/dashboard/business/_lib/queries.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProductDetails, ProductRecommendationHints } from '@/lib/business/types'

export interface ProductListItem {
  id: string
  title: string
  slug: string
  status: 'draft' | 'published' | 'archived'
  summary: string | null
  price_amount: number | null
  currency: string
  pricing_model: 'fixed' | 'starts_at' | 'quote' | 'free'
  inventory_status: string
  tags: string[]
  updated_at: string
}

export interface ProductEditorRow extends ProductListItem {
  description: string | null
  compare_at_amount: number | null
  sku: string | null
  details: ProductDetails
  recommendation_hints: ProductRecommendationHints
  rag_enabled: boolean
  rag_text: string | null
}

export async function fetchProducts(
  supabase: SupabaseClient,
  userId: string,
  opts: { q?: string; status?: string } = {},
): Promise<ProductListItem[]> {
  let query = supabase
    .from('business_items')
    .select('id, title, slug, status, summary, price_amount, currency, pricing_model, inventory_status, tags, updated_at')
    .eq('user_id', userId)
    .eq('kind', 'product')
    .order('updated_at', { ascending: false })

  if (opts.status && opts.status !== 'all') query = query.eq('status', opts.status)
  if (opts.q?.trim()) {
    const q = opts.q.trim().replace(/[%_]/g, '')
    query = query.ilike('title', `%${q}%`)
  }

  const { data, error } = await query
  if (error) throw new Error(`fetchProducts: ${error.message}`)
  return (data ?? []) as ProductListItem[]
}

export async function fetchProduct(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<ProductEditorRow | null> {
  const { data, error } = await supabase
    .from('business_items')
    .select('id, title, slug, status, summary, description, price_amount, compare_at_amount, currency, pricing_model, sku, inventory_status, tags, details, recommendation_hints, rag_enabled, rag_text, updated_at')
    .eq('user_id', userId)
    .eq('kind', 'product')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`fetchProduct: ${error.message}`)
  return (data ?? null) as ProductEditorRow | null
}
```

- [ ] **Step 2: Create product server actions**

Create `src/app/(app)/dashboard/business/products/actions.ts` with:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { enqueueEmbedJob } from '@/lib/rag'
import { ProductFormInput } from '@/lib/business/schemas'
import { buildProductRagText } from '@/lib/business/product-rag'

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

function parseJsonField<T>(value: FormDataEntryValue | null, fallback: T): T {
  if (typeof value !== 'string' || value.trim() === '') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function nullable(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export async function createProduct(): Promise<void> {
  const { supabase, userId } = await requireUser()
  const { data, error } = await supabase
    .from('business_items')
    .insert({
      user_id: userId,
      kind: 'product',
      title: 'Untitled product',
      slug: `product-${Date.now()}`,
      status: 'draft',
      currency: 'PHP',
      pricing_model: 'fixed',
      details: {},
      recommendation_hints: {},
      tags: [],
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(error?.message ?? 'create product failed')
  revalidatePath('/dashboard/business/products')
  redirect(`/dashboard/business/products/${data.id}`)
}

export async function saveProduct(formData: FormData): Promise<void> {
  const input = ProductFormInput.parse({
    id: formData.get('id') || undefined,
    title: formData.get('title'),
    slug: formData.get('slug'),
    status: formData.get('status'),
    summary: nullable(formData.get('summary')),
    description: nullable(formData.get('description')),
    price_amount: nullable(formData.get('price_amount')),
    compare_at_amount: nullable(formData.get('compare_at_amount')),
    currency: formData.get('currency') || 'PHP',
    pricing_model: formData.get('pricing_model') || 'fixed',
    sku: nullable(formData.get('sku')),
    inventory_status: formData.get('inventory_status') || 'not_tracked',
    tags: parseJsonField(formData.get('tags'), []),
    details: parseJsonField(formData.get('details'), {}),
    recommendation_hints: parseJsonField(formData.get('recommendation_hints'), {}),
    rag_enabled: formData.get('rag_enabled') === 'on',
  })
  if (!input.id) throw new Error('Product id is required')

  const { supabase, userId } = await requireUser()
  const ragText = buildProductRagText(input)
  const nextVersion = Date.now()
  const publishedAt = input.status === 'published' ? new Date().toISOString() : null

  const { error } = await supabase
    .from('business_items')
    .update({
      title: input.title,
      slug: input.slug,
      status: input.status,
      summary: input.summary,
      description: input.description,
      price_amount: input.price_amount,
      compare_at_amount: input.compare_at_amount,
      currency: input.currency,
      pricing_model: input.pricing_model,
      sku: input.sku,
      inventory_status: input.inventory_status,
      tags: input.tags,
      details: input.details,
      recommendation_hints: input.recommendation_hints,
      rag_enabled: input.rag_enabled,
      rag_text: ragText,
      version: nextVersion,
      embedding_status: input.status === 'published' && input.rag_enabled ? 'stale' : 'pending',
      published_at: publishedAt,
    })
    .eq('id', input.id)
    .eq('user_id', userId)
    .eq('kind', 'product')
  if (error) throw error

  if (input.status === 'published' && input.rag_enabled) {
    await enqueueEmbedJob(supabase, {
      kind: 'business_item',
      sourceId: input.id,
      userId,
      sourceVersion: nextVersion,
    })
  } else {
    await supabase.from('knowledge_chunks').delete().eq('business_item_id', input.id).eq('user_id', userId)
  }

  revalidatePath('/dashboard/business/products')
  revalidatePath(`/dashboard/business/products/${input.id}`)
}

export async function deleteProduct(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const { supabase, userId } = await requireUser()
  const { error } = await supabase
    .from('business_items')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .eq('kind', 'product')
  if (error) throw error
  revalidatePath('/dashboard/business/products')
  redirect('/dashboard/business/products')
}
```

- [ ] **Step 3: Add My Business to sidebar**

In `src/app/(app)/_components/sidebar.tsx`, add this item between Chatbot and Action Pages:

```ts
{ href: '/dashboard/business', label: 'My Business' },
```

- [ ] **Step 4: Run typecheck/build**

```bash
npm run lint
```

Expected: no lint errors from the new files.

- [ ] **Step 5: Commit**

```bash
git add src/app/'(app)'/_components/sidebar.tsx src/app/'(app)'/dashboard/business src/lib/business src/lib/rag
git commit -m "feat(business): add product data access and actions"
```

---

### Task 5: Owner Product and Order UI

**Files:**
- Create: `src/app/(app)/dashboard/business/page.tsx`
- Create: `src/app/(app)/dashboard/business/products/page.tsx`
- Create: `src/app/(app)/dashboard/business/products/new/page.tsx`
- Create: `src/app/(app)/dashboard/business/products/[id]/page.tsx`
- Create: `src/app/(app)/dashboard/business/_components/ProductList.tsx`
- Create: `src/app/(app)/dashboard/business/_components/ProductEditor.tsx`
- Create: `src/app/(app)/dashboard/business/_components/ProductPreviewCard.tsx`
- Create: `src/app/(app)/dashboard/business/orders/page.tsx`
- Create: `src/app/(app)/dashboard/business/orders/[id]/page.tsx`
- Create: `src/app/(app)/dashboard/business/orders/actions.ts`
- Create: `src/app/(app)/dashboard/business/_components/OrderList.tsx`

- [ ] **Step 1: Create business index page**

Create `src/app/(app)/dashboard/business/page.tsx`:

```tsx
import Link from 'next/link'

export default function BusinessIndexPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[24px] font-semibold text-[#111827]">My Business</h1>
        <p className="mt-1 text-[14px] text-[#6B7280]">
          Manage the products your chatbot, catalog pages, and recommendations can use.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Link href="/dashboard/business/products" className="rounded-xl border border-[#E5E7EB] bg-white p-5 hover:border-[#D1D5DB]">
          <div className="text-[15px] font-semibold text-[#111827]">Products</div>
          <p className="mt-1 text-[13px] text-[#6B7280]">Create product cards, RAG details, and catalog listings.</p>
        </Link>
        <Link href="/dashboard/business/orders" className="rounded-xl border border-[#E5E7EB] bg-white p-5 hover:border-[#D1D5DB]">
          <div className="text-[15px] font-semibold text-[#111827]">Orders</div>
          <p className="mt-1 text-[13px] text-[#6B7280]">Review unpaid catalog orders and customer notes.</p>
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create product list component**

Create `src/app/(app)/dashboard/business/_components/ProductList.tsx`:

```tsx
import Link from 'next/link'
import { formatPrice } from '@/lib/business/pricing'
import type { ProductListItem } from '../_lib/queries'

export function ProductList({ products }: { products: ProductListItem[] }) {
  if (products.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#D1D5DB] bg-white p-10 text-center">
        <h2 className="text-[15px] font-semibold text-[#111827]">No products yet</h2>
        <p className="mt-1 text-[13px] text-[#6B7280]">Add one product with a title, price, and customer-facing details.</p>
        <form action="/dashboard/business/products/new" className="mt-4">
          <button className="rounded-md bg-[#059669] px-3 py-2 text-[13px] font-semibold text-white">New product</button>
        </form>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
      <table className="min-w-full text-[13px]">
        <thead className="bg-[#F9FAFB] text-left text-[12px] font-semibold uppercase text-[#6B7280]">
          <tr>
            <th className="px-4 py-3">Product</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Price</th>
            <th className="px-4 py-3">Inventory</th>
            <th className="px-4 py-3">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F3F4F6]">
          {products.map((product) => (
            <tr key={product.id} className="hover:bg-[#FAFAFA]">
              <td className="px-4 py-3">
                <Link href={`/dashboard/business/products/${product.id}`} className="font-medium text-[#111827] hover:text-[#059669]">
                  {product.title}
                </Link>
                <div className="mt-0.5 text-[12px] text-[#9CA3AF]">{product.summary ?? product.slug}</div>
              </td>
              <td className="px-4 py-3 text-[#374151]">{product.status}</td>
              <td className="px-4 py-3 text-[#374151]">
                {formatPrice({ amount: product.price_amount, currency: product.currency, pricingModel: product.pricing_model })}
              </td>
              <td className="px-4 py-3 text-[#6B7280]">{product.inventory_status.replaceAll('_', ' ')}</td>
              <td className="px-4 py-3 text-[#6B7280]">{new Date(product.updated_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: Create product list page**

Create `src/app/(app)/dashboard/business/products/page.tsx`:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProductList } from '../_components/ProductList'
import { fetchProducts } from '../_lib/queries'

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const products = await fetchProducts(supabase, user.id, sp)

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold text-[#111827]">Products</h1>
          <p className="mt-1 text-[14px] text-[#6B7280]">Products are reusable by RAG, catalog pages, and recommendations.</p>
        </div>
        <Link href="/dashboard/business/products/new" className="rounded-md bg-[#059669] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#047857]">
          New product
        </Link>
      </header>
      <ProductList products={products} />
    </div>
  )
}
```

- [ ] **Step 4: Create product creation route**

Create `src/app/(app)/dashboard/business/products/new/page.tsx`:

```tsx
import { createProduct } from '../actions'

export default function NewProductPage() {
  return (
    <form action={createProduct}>
      <button className="rounded-md bg-[#059669] px-3 py-2 text-[13px] font-semibold text-white">
        Create draft product
      </button>
    </form>
  )
}
```

- [ ] **Step 5: Create preview component**

Create `src/app/(app)/dashboard/business/_components/ProductPreviewCard.tsx`:

```tsx
import { formatPrice } from '@/lib/business/pricing'
import type { ProductEditorRow } from '../_lib/queries'

export function ProductPreviewCard({ product }: { product: ProductEditorRow }) {
  return (
    <aside className="rounded-xl border border-[#E5E7EB] bg-white p-4">
      <div className="aspect-[4/3] rounded-lg border border-dashed border-[#D1D5DB] bg-[#F9FAFB]" />
      <div className="mt-4">
        <div className="text-[15px] font-semibold text-[#111827]">{product.title}</div>
        <p className="mt-1 text-[13px] text-[#6B7280]">
          {product.summary || 'Add a short summary for the product card.'}
        </p>
        <div className="mt-3 text-[14px] font-semibold text-[#111827]">
          {formatPrice({
            amount: product.price_amount,
            currency: product.currency,
            pricingModel: product.pricing_model,
          })}
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 6: Create editor component**

Create `src/app/(app)/dashboard/business/_components/ProductEditor.tsx`:

```tsx
import type { ProductEditorRow } from '../_lib/queries'
import { deleteProduct, saveProduct } from '../products/actions'
import { ProductPreviewCard } from './ProductPreviewCard'

const statusOptions = ['draft', 'published', 'archived'] as const
const pricingOptions = ['fixed', 'starts_at', 'quote', 'free'] as const
const inventoryOptions = ['in_stock', 'limited', 'out_of_stock', 'preorder', 'not_tracked'] as const

export function ProductEditor({ product }: { product: ProductEditorRow }) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[24px] font-semibold text-[#111827]">{product.title}</h1>
        <p className="mt-1 text-[14px] text-[#6B7280]">
          Edit customer-facing product details and the text used for item-level RAG.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form action={saveProduct} className="space-y-5 rounded-xl border border-[#E5E7EB] bg-white p-5">
          <input type="hidden" name="id" value={product.id} />
          <input type="hidden" name="tags" value={JSON.stringify(product.tags ?? [])} />
          <input type="hidden" name="details" value={JSON.stringify(product.details ?? {})} />
          <input
            type="hidden"
            name="recommendation_hints"
            value={JSON.stringify(product.recommendation_hints ?? {})}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-[13px] font-medium text-[#374151]">
              <span>Title</span>
              <input name="title" required defaultValue={product.title} className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]" />
            </label>
            <label className="space-y-1 text-[13px] font-medium text-[#374151]">
              <span>Slug</span>
              <input name="slug" required defaultValue={product.slug} className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]" />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-1 text-[13px] font-medium text-[#374151]">
              <span>Status</span>
              <select name="status" defaultValue={product.status} className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]">
                {statusOptions.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-[13px] font-medium text-[#374151]">
              <span>Pricing</span>
              <select name="pricing_model" defaultValue={product.pricing_model} className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]">
                {pricingOptions.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-[13px] font-medium text-[#374151]">
              <span>Inventory</span>
              <select name="inventory_status" defaultValue={product.inventory_status} className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]">
                {inventoryOptions.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
              </select>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-1 text-[13px] font-medium text-[#374151]">
              <span>Price</span>
              <input name="price_amount" inputMode="decimal" defaultValue={product.price_amount ?? ''} className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]" />
            </label>
            <label className="space-y-1 text-[13px] font-medium text-[#374151]">
              <span>Compare at</span>
              <input name="compare_at_amount" inputMode="decimal" defaultValue={product.compare_at_amount ?? ''} className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]" />
            </label>
            <label className="space-y-1 text-[13px] font-medium text-[#374151]">
              <span>Currency</span>
              <input name="currency" defaultValue={product.currency} maxLength={3} className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px] uppercase" />
            </label>
          </div>

          <label className="space-y-1 text-[13px] font-medium text-[#374151]">
            <span>Summary</span>
            <textarea name="summary" rows={2} defaultValue={product.summary ?? ''} className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]" />
          </label>
          <label className="space-y-1 text-[13px] font-medium text-[#374151]">
            <span>Description</span>
            <textarea name="description" rows={8} defaultValue={product.description ?? ''} className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]" />
          </label>
          <label className="space-y-1 text-[13px] font-medium text-[#374151]">
            <span>SKU</span>
            <input name="sku" defaultValue={product.sku ?? ''} className="w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]" />
          </label>
          <label className="flex items-center gap-2 text-[13px] font-medium text-[#374151]">
            <input type="checkbox" name="rag_enabled" defaultChecked={product.rag_enabled} />
            Include this product in RAG
          </label>

          <div className="flex justify-between border-t border-[#F3F4F6] pt-4">
            <button type="submit" className="rounded-md bg-[#059669] px-4 py-2 text-[13px] font-semibold text-white">Save product</button>
            <button formAction={deleteProduct} className="rounded-md border border-[#FCA5A5] px-4 py-2 text-[13px] font-semibold text-[#DC2626]">Delete</button>
          </div>
        </form>

        <ProductPreviewCard product={product} />
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Create product edit page**

Create `src/app/(app)/dashboard/business/products/[id]/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProductEditor } from '../../_components/ProductEditor'
import { fetchProduct } from '../../_lib/queries'

export default async function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const product = await fetchProduct(supabase, user.id, id)
  if (!product) notFound()
  return <ProductEditor product={product} />
}
```

- [ ] **Step 8: Create order query functions and pages**

Append these query types and functions to `src/app/(app)/dashboard/business/_lib/queries.ts`:

```ts
export interface OrderListItem {
  id: string
  status: 'new' | 'confirmed' | 'cancelled' | 'fulfilled'
  payment_status: string
  currency: string
  subtotal_amount: number
  customer_name: string | null
  customer_phone: string | null
  created_at: string
}

export interface OrderDetail extends OrderListItem {
  customer_email: string | null
  customer_notes: string | null
  items: {
    id: string
    title_snapshot: string
    quantity: number
    unit_amount: number
    currency: string
    line_total_amount: number
  }[]
}

export async function fetchOrders(
  supabase: SupabaseClient,
  userId: string,
): Promise<OrderListItem[]> {
  const { data, error } = await supabase
    .from('business_orders')
    .select('id, status, payment_status, currency, subtotal_amount, customer_name, customer_phone, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`fetchOrders: ${error.message}`)
  return (data ?? []) as OrderListItem[]
}

export async function fetchOrder(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<OrderDetail | null> {
  const { data: order, error } = await supabase
    .from('business_orders')
    .select('id, status, payment_status, currency, subtotal_amount, customer_name, customer_phone, customer_email, customer_notes, created_at')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`fetchOrder: ${error.message}`)
  if (!order) return null

  const { data: items, error: itemErr } = await supabase
    .from('business_order_items')
    .select('id, title_snapshot, quantity, unit_amount, currency, line_total_amount')
    .eq('user_id', userId)
    .eq('order_id', id)
    .order('created_at', { ascending: true })
  if (itemErr) throw new Error(`fetchOrder items: ${itemErr.message}`)
  return { ...(order as OrderListItem), items: (items ?? []) as OrderDetail['items'] } as OrderDetail
}
```

Create `src/app/(app)/dashboard/business/_components/OrderList.tsx`:

```tsx
import Link from 'next/link'
import type { OrderListItem } from '../_lib/queries'

export function OrderList({ orders }: { orders: OrderListItem[] }) {
  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#D1D5DB] bg-white p-10 text-center">
        <h2 className="text-[15px] font-semibold text-[#111827]">No orders yet</h2>
        <p className="mt-1 text-[13px] text-[#6B7280]">Catalog orders will appear here after customers submit a cart.</p>
      </div>
    )
  }
  return (
    <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
      <table className="min-w-full text-[13px]">
        <thead className="bg-[#F9FAFB] text-left text-[12px] font-semibold uppercase text-[#6B7280]">
          <tr><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Created</th></tr>
        </thead>
        <tbody className="divide-y divide-[#F3F4F6]">
          {orders.map((order) => (
            <tr key={order.id} className="hover:bg-[#FAFAFA]">
              <td className="px-4 py-3"><Link href={`/dashboard/business/orders/${order.id}`} className="font-medium text-[#111827] hover:text-[#059669]">{order.customer_name || 'Unnamed customer'}</Link><div className="text-[12px] text-[#9CA3AF]">{order.customer_phone}</div></td>
              <td className="px-4 py-3 text-[#374151]">{order.status} / {order.payment_status}</td>
              <td className="px-4 py-3 text-[#374151]">{order.currency} {order.subtotal_amount}</td>
              <td className="px-4 py-3 text-[#6B7280]">{new Date(order.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

Create `src/app/(app)/dashboard/business/orders/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { OrderList } from '../_components/OrderList'
import { fetchOrders } from '../_lib/queries'

export default async function OrdersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const orders = await fetchOrders(supabase, user.id)
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[24px] font-semibold text-[#111827]">Orders</h1>
        <p className="mt-1 text-[14px] text-[#6B7280]">Unpaid product catalog order captures.</p>
      </header>
      <OrderList orders={orders} />
    </div>
  )
}
```

Create `src/app/(app)/dashboard/business/orders/[id]/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchOrder } from '../../_lib/queries'

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const order = await fetchOrder(supabase, user.id, id)
  if (!order) notFound()
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[24px] font-semibold text-[#111827]">Order</h1>
        <p className="mt-1 text-[14px] text-[#6B7280]">{order.status} / {order.payment_status}</p>
      </header>
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-5 text-[14px] text-[#374151]">
        <div className="font-semibold text-[#111827]">{order.customer_name || 'Unnamed customer'}</div>
        <div className="mt-1 text-[13px] text-[#6B7280]">{order.customer_phone || 'No phone'} · {order.customer_email || 'No email'}</div>
        {order.customer_notes ? <p className="mt-4 whitespace-pre-wrap">{order.customer_notes}</p> : null}
      </section>
      <section className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
        <table className="min-w-full text-[13px]">
          <tbody className="divide-y divide-[#F3F4F6]">
            {order.items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3 font-medium text-[#111827]">{item.title_snapshot}</td>
                <td className="px-4 py-3 text-[#6B7280]">x{item.quantity}</td>
                <td className="px-4 py-3 text-right text-[#374151]">{item.currency} {item.line_total_amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
```

- [ ] **Step 9: Run lint**

```bash
npm run lint
```

Expected: no lint errors.

- [ ] **Step 10: Commit**

```bash
git add src/app/'(app)'/dashboard/business
git commit -m "feat(business): add product and order workspace"
```

---

### Task 6: Public Catalog DTOs, Renderer, and Order Handler

**Files:**
- Create: `src/lib/business/public-dto.ts`
- Create: `src/lib/business/public-dto.test.ts`
- Create: `src/lib/action-pages/handlers/catalog.ts`
- Create: `src/lib/action-pages/handlers/catalog.test.ts`
- Modify: `src/lib/action-pages/handlers/index.ts`
- Modify: `src/app/a/[slug]/_lib/load.ts`
- Modify: `src/app/a/[slug]/_kinds/types.ts`
- Modify: `src/app/a/[slug]/_kinds/catalog/Renderer.tsx`
- Modify: `src/app/a/[slug]/page.tsx`
- Modify: `src/app/api/action-pages/submit/route.ts`

- [ ] **Step 1: Create public DTO helper**

Create `src/lib/business/public-dto.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatPrice } from './pricing'

export interface PublicProductCard {
  id: string
  title: string
  slug: string
  summary: string | null
  description: string | null
  price_amount: number | null
  currency: string
  pricing_model: 'fixed' | 'starts_at' | 'quote' | 'free'
  price_label: string
  inventory_status: string
  tags: string[]
}

export async function fetchPublicCatalogProducts(
  supabase: SupabaseClient,
  userId: string,
): Promise<PublicProductCard[]> {
  const { data, error } = await supabase
    .from('business_items')
    .select('id, title, slug, summary, description, price_amount, currency, pricing_model, inventory_status, tags')
    .eq('user_id', userId)
    .eq('kind', 'product')
    .eq('status', 'published')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(`fetchPublicCatalogProducts: ${error.message}`)
  return (data ?? []).map((row: any) => ({
    ...row,
    price_label: formatPrice({
      amount: row.price_amount,
      currency: row.currency,
      pricingModel: row.pricing_model,
    }),
  }))
}
```

- [ ] **Step 2: Add products to public page load**

In `src/app/a/[slug]/_lib/load.ts`, add `products?: PublicProductCard[]` to `PublicLoadResult`. After building `page`, if `data.kind === 'catalog'`, call:

```ts
const products = await fetchPublicCatalogProducts(admin, data.user_id as string)
```

Return it as `products`. This uses the service-role admin client but filters by action-page owner and product published status.

- [ ] **Step 3: Extend renderer props**

In `src/app/a/[slug]/_kinds/types.ts`, add:

```ts
import type { PublicProductCard } from '@/lib/business/public-dto'

products?: PublicProductCard[]
```

to `KindRendererProps`.

Pass `products={result.products ?? []}` from `src/app/a/[slug]/page.tsx` through `ActionPageRenderer`.

- [ ] **Step 4: Build catalog renderer**

Replace `src/app/a/[slug]/_kinds/catalog/Renderer.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import type { KindRendererProps } from '../types'

export default function CatalogRenderer({ page, rawToken, claims, products = [] }: KindRendererProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const items = useMemo(
    () =>
      Object.entries(quantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([id, quantity]) => ({ id, quantity })),
    [quantities],
  )
  const count = items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-[24px] font-semibold text-[#111827]">{page.title}</h1>
        {page.description ? <p className="mt-2 text-[14px] text-[#6B7280]">{page.description}</p> : null}
      </header>

      {products.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#D1D5DB] bg-[#F9FAFB] p-6 text-center text-[13px] text-[#6B7280]">
          No products are available right now.
        </div>
      ) : (
        <form action="/api/action-pages/submit" method="post" className="space-y-6">
          <input type="hidden" name="slug" value={page.slug} />
          {claims ? (
            <>
              <input type="hidden" name="p" value={claims.psid} />
              <input type="hidden" name="g" value={claims.pageId} />
              <input type="hidden" name="e" value={String(claims.exp)} />
              {rawToken ? <input type="hidden" name="t" value={rawToken} /> : null}
            </>
          ) : null}
          <input type="hidden" name="data.items" value={JSON.stringify(items)} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {products.map((product) => {
              const quantity = quantities[product.id] ?? 0
              return (
                <article key={product.id} className="rounded-lg border border-[#E5E7EB] bg-white p-4">
                  <div className="aspect-[4/3] rounded-md bg-[#F3F4F6]" />
                  <h2 className="mt-3 text-[15px] font-semibold text-[#111827]">{product.title}</h2>
                  <p className="mt-1 min-h-10 text-[13px] text-[#6B7280]">{product.summary ?? product.description ?? ''}</p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-[14px] font-semibold text-[#111827]">{product.price_label}</span>
                    <input
                      aria-label={`Quantity for ${product.title}`}
                      type="number"
                      min={0}
                      max={999}
                      value={quantity}
                      onChange={(event) =>
                        setQuantities((current) => ({
                          ...current,
                          [product.id]: Math.max(0, Number(event.target.value) || 0),
                        }))
                      }
                      className="w-20 rounded-md border border-[#D1D5DB] px-2 py-1.5 text-[13px]"
                    />
                  </div>
                </article>
              )
            })}
          </div>

          <section className="rounded-lg border border-[#E5E7EB] bg-white p-4">
            <h2 className="text-[15px] font-semibold text-[#111827]">Checkout</h2>
            <div className="mt-4 grid gap-3">
              <input name="data.customer_name" placeholder="Name" className="rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]" />
              <input name="data.customer_phone" placeholder="Phone" className="rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]" />
              <input name="data.customer_email" placeholder="Email" className="rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]" />
              <textarea name="data.customer_notes" placeholder="Notes" rows={3} className="rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]" />
            </div>
            <button
              type="submit"
              disabled={count === 0}
              className="mt-4 w-full rounded-md bg-[#059669] px-4 py-2 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#9CA3AF]"
            >
              Submit order{count ? ` (${count})` : ''}
            </button>
          </section>
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Add catalog handler**

Create `src/lib/action-pages/handlers/catalog.ts`:

```ts
import { z } from 'zod'
import { registerHandler, type ParsedSubmission } from '../dispatch'

export const CatalogSubmissionPayload = z.object({
  items: z
    .union([
      z.string().transform((value) => JSON.parse(value)),
      z.array(z.object({ id: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(999) })),
    ])
    .pipe(z.array(z.object({ id: z.string().uuid(), quantity: z.coerce.number().int().min(1).max(999) })).min(1).max(100)),
  customer_name: z.string().trim().max(160).optional(),
  customer_email: z.string().trim().max(320).optional(),
  customer_phone: z.string().trim().max(40).optional(),
  customer_notes: z.string().trim().max(2000).optional(),
})

export function parseCatalogSubmission(payload: Record<string, unknown>): ParsedSubmission {
  const parsed = CatalogSubmissionPayload.parse(payload)
  return {
    outcome: 'checked_out',
    data: {
      items: parsed.items,
      customer: {
        name: parsed.customer_name ?? null,
        email: parsed.customer_email ?? null,
        phone: parsed.customer_phone ?? null,
        notes: parsed.customer_notes ?? null,
      },
    },
  }
}

registerHandler('catalog', parseCatalogSubmission)
```

Add `import './catalog'` to `src/lib/action-pages/handlers/index.ts`.

- [ ] **Step 6: Update submit route to create orders for catalog**

In `src/app/api/action-pages/submit/route.ts`, after `const parsed = parseSubmission(...)` and before inserting the action-page submission, add:

```ts
let businessOrderId: string | null = null
if (page.kind === 'catalog') {
  businessOrderId = await createBusinessOrderFromCatalog({
    admin,
    page,
    parsedData: parsed.data,
    leadId,
    psid,
    fbPageId,
  })
}
```

Add helper below `applyStageMove`:

```ts
async function createBusinessOrderFromCatalog(args: {
  admin: ReturnType<typeof createAdminClient>
  page: ActionPageRecord
  parsedData: Record<string, unknown>
  leadId: string | null
  psid: string | null
  fbPageId: string | null
}): Promise<string> {
  const items = (args.parsedData.items ?? []) as { id: string; quantity: number }[]
  if (!items.length) throw new Error('cart is empty')
  const ids = items.map((item) => item.id)
  const { data: products, error } = await args.admin
    .from('business_items')
    .select('id, title, sku, price_amount, currency, pricing_model')
    .eq('user_id', args.page.user_id)
    .eq('kind', 'product')
    .eq('status', 'published')
    .in('id', ids)
  if (error) throw new Error(`load catalog products failed: ${error.message}`)
  if ((products ?? []).length !== ids.length) throw new Error('cart contains unavailable products')

  const productById = new Map((products ?? []).map((p: any) => [p.id as string, p]))
  const currency = String((products ?? [])[0]?.currency ?? 'PHP')
  const lines = items.map((item) => {
    const product = productById.get(item.id) as any
    const unit = Number(product.price_amount ?? 0)
    const total = Math.round(unit * item.quantity * 100) / 100
    return {
      user_id: args.page.user_id,
      business_item_id: item.id,
      title_snapshot: String(product.title),
      sku_snapshot: product.sku ?? null,
      quantity: item.quantity,
      unit_amount: unit,
      currency: String(product.currency ?? currency),
      line_total_amount: total,
    }
  })
  const subtotal = lines.reduce((sum, line) => sum + Number(line.line_total_amount), 0)
  const customer = (args.parsedData.customer ?? {}) as Record<string, unknown>

  const { data: order, error: orderErr } = await args.admin
    .from('business_orders')
    .insert({
      user_id: args.page.user_id,
      action_page_id: args.page.id,
      lead_id: args.leadId,
      psid: args.psid,
      page_id: args.fbPageId,
      status: 'new',
      payment_status: 'unpaid',
      currency,
      subtotal_amount: subtotal,
      customer_name: customer.name ?? null,
      customer_email: customer.email ?? null,
      customer_phone: customer.phone ?? null,
      customer_notes: customer.notes ?? null,
      meta: {},
    })
    .select('id')
    .single<{ id: string }>()
  if (orderErr || !order) throw new Error(orderErr?.message ?? 'order insert failed')

  const { error: lineErr } = await args.admin
    .from('business_order_items')
    .insert(lines.map((line) => ({ ...line, order_id: order.id })))
  if (lineErr) throw new Error(`order lines insert failed: ${lineErr.message}`)
  return order.id
}
```

When inserting `action_page_submissions`, include the order id in `meta`:

```ts
meta: businessOrderId ? { business_order_id: businessOrderId } : null,
```

- [ ] **Step 7: Create handler tests**

Create `src/lib/action-pages/handlers/catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseCatalogSubmission } from './catalog'

describe('parseCatalogSubmission', () => {
  it('parses cart items and customer details', () => {
    const parsed = parseCatalogSubmission({
      items: JSON.stringify([{ id: '00000000-0000-4000-8000-000000000001', quantity: 2 }]),
      customer_name: 'Ada',
      customer_phone: '+63917',
    })

    expect(parsed.outcome).toBe('checked_out')
    expect(parsed.data.items).toEqual([
      { id: '00000000-0000-4000-8000-000000000001', quantity: 2 },
    ])
    expect(parsed.data.customer).toMatchObject({ name: 'Ada', phone: '+63917' })
  })

  it('rejects an empty cart', () => {
    expect(() => parseCatalogSubmission({ items: '[]' })).toThrow()
  })
})
```

Create `src/lib/business/public-dto.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatPrice } from './pricing'

describe('public catalog dto pricing labels', () => {
  it('uses stable customer-facing price labels', () => {
    expect(formatPrice({ amount: 1299, currency: 'PHP', pricingModel: 'fixed' })).toContain('1,299')
    expect(formatPrice({ amount: 500, currency: 'PHP', pricingModel: 'starts_at' })).toContain('Starts at')
    expect(formatPrice({ amount: null, currency: 'PHP', pricingModel: 'quote' })).toBe('Contact for price')
  })
})
```

- [ ] **Step 8: Run focused tests**

```bash
npx vitest run src/lib/action-pages/handlers/catalog.test.ts src/lib/business/public-dto.test.ts
```

Expected: pass.

- [ ] **Step 9: Run lint**

```bash
npm run lint
```

Expected: no lint errors.

- [ ] **Step 10: Commit**

```bash
git add src/lib/business src/lib/action-pages src/app/a src/app/api/action-pages/submit/route.ts
git commit -m "feat(action-pages): render catalog products and capture orders"
```

---

### Task 7: End-to-End Verification and Hardening

**Files:**
- No planned file changes. If verification fails, modify only the files named by the failing command and explain the change in the final verification note.

- [ ] **Step 1: Run full unit suite**

```bash
npm test
```

Expected: all Vitest tests pass.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: no lint errors.

- [ ] **Step 3: Build the app**

```bash
npm run build
```

Expected: Next build succeeds. If the build flags dynamic server-action or App Router API issues, read the matching Next doc in `node_modules/next/dist/docs/01-app/` and fix the implementation.

- [ ] **Step 4: Manual security checks**

Run:

```bash
rg -n "service_role|SUPABASE_SERVICE_ROLE|business_orders|business_items|payment|bank|card" src supabase/migrations
```

Expected:

- `service_role` appears only in server-only admin client or server route code.
- `payment` appears only as `payment_status` or explicit non-payment text.
- no code stores bank account, card number, CVV, or payment credentials.

- [ ] **Step 5: Manual smoke test**

Start dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000/dashboard/business/products
```

Verify:

- My Business appears in sidebar.
- Create draft product redirects to editor.
- Saving a published product does not expose private/internal fields.
- Product list shows the saved product.
- A published catalog action page renders published products.
- Submitting a cart creates a `business_orders` row and line items.

- [ ] **Step 6: Final commit for fixes**

If Step 1-5 required fixes:

```bash
git add -A
git commit -m "fix(business): harden catalog foundation"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: schema, RLS, products, item RAG, public catalog, order capture, owner order review, UI direction, and security constraints are mapped to Tasks 1-7.
- Payment boundary: payment methods, bank details, and payment credentials are explicitly excluded. Only `payment_status` is stored.
- Type consistency: the source kind is `business_item`, the database column is `business_item_id`, and queue/worker/parser tasks use the same names.
- Placeholder scan: no `TBD`, `TODO`, or unspecified test step remains in this plan.
