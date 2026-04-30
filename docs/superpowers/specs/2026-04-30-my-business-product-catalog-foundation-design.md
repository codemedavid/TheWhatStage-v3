# My Business Product Catalog Foundation — Design

**Date:** 2026-04-30
**Status:** Approved
**Owner:** John Angelo David

## Summary

Add a **My Business** area that stores structured business offerings instead
of forcing the chatbot to ingest one large business profile. The first working
store type is an e-commerce-style **Product Catalog**: owners can create,
publish, and manage products; public catalog action pages can show published
products with a cart; submissions create unpaid order records with line items.

The foundation is deliberately shared so property listings, digital products,
and services can be added in parallel later without duplicating media,
publishing, RAG, recommendation, or order-capture logic.

## Goals

- Add sidebar entry **My Business** at `/dashboard/business`.
- Build a reusable per-user business foundation:
  - business profile/settings
  - typed business items
  - item media
  - item-level RAG source text
  - orders and order line items
- Build the first usable item type: `product`.
- Let owners add/edit/archive/publish products with price, description, media,
  categories/tags, and recommendation hints.
- Let catalog action pages read published products from My Business instead of
  storing product arrays inside `action_pages.config`.
- Let public visitors add products to cart and submit an unpaid order.
- Keep payment as a later extension point. This pass stores no card data, bank
  account data, payment credentials, or payment instructions.

## Non-Goals

- Online payment integration.
- Bank account or wallet instructions.
- Inventory reservation, fulfillment, shipping labels, taxes, discounts, or
  abandoned cart automation.
- Full property, digital product, or service editors.
- Messenger carousel/product-card sending implementation. This pass exposes
  clean DTOs that a later Messenger step can use.
- Multi-user org/team permissions. Scope remains per `auth.users.id`.

## Product Direction

The selected UX direction is **Operator Catalog**.

My Business is a quiet operating surface, not a visual store-builder. Owners
should see many products at once, filter quickly, edit without losing context,
and understand exactly which products are available to customers and RAG.

The public catalog should feel polished and trustworthy, but not like a heavy
commerce platform. Product cards, detail views, cart, and order capture should
be clear and fast on mobile because Messenger traffic will often land there.

## Information Architecture

Routes under the authenticated app:

```text
/dashboard/business
/dashboard/business/products
/dashboard/business/products/new
/dashboard/business/products/[id]
/dashboard/business/orders
/dashboard/business/orders/[id]
```

Future routes reserve the same shape:

```text
/dashboard/business/properties
/dashboard/business/digital
/dashboard/business/services
```

Sidebar:

- Add `My Business` between `Chatbot` and `Action Pages`.
- Keep `Action Pages` separate. Action Pages are public funnels; My Business is
  the source of truth for offerings.

## Data Model

All tables live in `public`, have RLS enabled, and are scoped by `user_id =
auth.uid()` for authenticated owner access. Service-role code may read
published public data for action pages, but must still filter by owner and
status explicitly.

### `business_profiles`

One row per owner. This gives action pages a stable source for store identity
without coupling it to any one catalog page.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | `gen_random_uuid()` |
| `user_id` | `uuid` FK `auth.users.id` | unique, not null |
| `display_name` | `text` | 1-120 chars |
| `description` | `text` | nullable |
| `default_currency` | `text` | 3-letter ISO-like code, default `PHP` |
| `contact_email` | `text` | nullable |
| `contact_phone` | `text` | nullable |
| `created_at` | `timestamptz` | default `now()` |
| `updated_at` | `timestamptz` | trigger |

### `business_items`

Shared item table for products now and other item types later.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK `auth.users.id` | indexed |
| `kind` | `text` | check in `product`, `property`, `digital`, `service` |
| `status` | `text` | `draft`, `published`, `archived` |
| `title` | `text` | 1-160 chars |
| `slug` | `text` | per-user unique, URL-safe |
| `summary` | `text` | short card copy, nullable |
| `description` | `text` | long customer-facing details, nullable |
| `price_amount` | `numeric(12,2)` | nullable for future flexible pricing |
| `compare_at_amount` | `numeric(12,2)` | nullable |
| `currency` | `text` | 3-letter code, default from profile |
| `pricing_model` | `text` | `fixed`, `starts_at`, `quote`, `free` |
| `sku` | `text` | nullable |
| `inventory_status` | `text` | `in_stock`, `limited`, `out_of_stock`, `preorder`, `not_tracked` |
| `tags` | `text[]` | owner-managed tags |
| `details` | `jsonb` | kind-specific structured fields |
| `recommendation_hints` | `jsonb` | budget, outcome, audience, use cases |
| `rag_enabled` | `boolean` | default true |
| `rag_text` | `text` | generated searchable text for this item |
| `published_at` | `timestamptz` | nullable |
| `created_at` | `timestamptz` | default `now()` |
| `updated_at` | `timestamptz` | trigger |

Indexes:

- `(user_id, kind, status, updated_at desc)`
- `(user_id, kind, slug)` unique
- GIN/trigram search over title, summary, description, tags, and `rag_text`

Product `details` fields for this pass:

```json
{
  "features": ["string"],
  "specifications": [{"name": "string", "value": "string"}],
  "included": ["string"],
  "availability_note": "string"
}
```

Product `recommendation_hints` fields for this pass:

```json
{
  "budget_min": 0,
  "budget_max": 0,
  "desired_results": ["string"],
  "best_for": ["string"],
  "not_for": ["string"],
  "keywords": ["string"]
}
```

### `business_item_media`

Media metadata only. Files live in Supabase Storage.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK `auth.users.id` | indexed |
| `item_id` | `uuid` FK `business_items.id` | cascade |
| `kind` | `text` | `image`, `video`, `file` |
| `storage_path` | `text` | owner-scoped path |
| `alt_text` | `text` | nullable |
| `position` | `integer` | stable ordering |
| `is_primary` | `boolean` | one primary image per item in app logic |
| `created_at` | `timestamptz` | default `now()` |

Storage bucket:

- `business-media`
- Private by default.
- Owner paths use `${user_id}/${item_id}/${media_id}-filename`.
- Upload/download signed URLs are generated server-side after ownership checks.
- Validate file type and size before upload. First pass allows images only for
  products; video/file metadata is reserved for digital products later.

### `business_orders`

Order records created by catalog action pages. No payment secrets.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK `auth.users.id` | owner |
| `action_page_id` | `uuid` FK `action_pages.id` | nullable |
| `lead_id` | `uuid` FK `leads.id` | nullable |
| `psid` | `text` | nullable |
| `page_id` | `uuid` FK `facebook_pages.id` | nullable |
| `status` | `text` | `new`, `confirmed`, `cancelled`, `fulfilled` |
| `payment_status` | `text` | default `unpaid`; future values allowed |
| `currency` | `text` | |
| `subtotal_amount` | `numeric(12,2)` | |
| `customer_name` | `text` | nullable |
| `customer_email` | `text` | nullable |
| `customer_phone` | `text` | nullable |
| `customer_notes` | `text` | nullable |
| `meta` | `jsonb` | non-sensitive request metadata |
| `created_at` | `timestamptz` | default `now()` |
| `updated_at` | `timestamptz` | trigger |

### `business_order_items`

Line items snapshot product data at purchase time.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `order_id` | `uuid` FK `business_orders.id` | cascade |
| `user_id` | `uuid` FK `auth.users.id` | denormalized for RLS |
| `business_item_id` | `uuid` FK `business_items.id` | nullable on delete set null |
| `title_snapshot` | `text` | required |
| `sku_snapshot` | `text` | nullable |
| `quantity` | `integer` | 1-999 |
| `unit_amount` | `numeric(12,2)` | |
| `currency` | `text` | |
| `line_total_amount` | `numeric(12,2)` | |
| `created_at` | `timestamptz` | default `now()` |

## RAG Integration

Products become independent RAG sources. This prevents the model from pulling a
whole business knowledge dump when a customer asks about one product.

Extend `knowledge_chunks` with an optional `business_item_id` source and update
its one-source constraint to allow exactly one of:

- `document_id`
- `faq_id`
- `business_item_id`

Update ingest source kind to include `business_item`. The chunk text is built
from safe, customer-facing product fields only:

- title
- summary
- description
- price/currency/pricing model
- features/specifications/included
- public availability note
- recommendation hints that are safe for customers

Excluded from RAG:

- draft/archived products
- internal notes
- owner metadata
- order data
- raw storage paths
- private contact/settings fields

When a product is saved:

1. Validate and persist the item.
2. Regenerate `rag_text`.
3. Queue an embedding job for the item if `status = published` and
   `rag_enabled = true`.
4. Delete or tombstone item chunks when unpublished, archived, deleted, or
   `rag_enabled = false`.

Retrieval later can return item-aware results. The first pass only needs the
data and chunks; Messenger product cards can be added after item DTOs are in
place.

## Action Page Integration

The existing `catalog` action-page kind should become a renderer over My
Business products.

`action_pages.config` for catalog should store display/filter settings, not
full product data:

```json
{
  "business_profile_id": "uuid",
  "title": "Featured products",
  "description": "Optional page intro",
  "item_filter": {
    "kind": "product",
    "tags": [],
    "include_item_ids": [],
    "exclude_item_ids": []
  },
  "cart": {
    "enabled": true,
    "customer_fields": ["name", "phone", "email", "notes"]
  }
}
```

Public loading rules:

- Only published action pages render.
- Only published products owned by the action page owner render.
- Product DTOs include only public fields and signed media URLs.
- Draft/archived products return 404 if directly requested.

Catalog submission:

- Accept product IDs and quantities only.
- Server re-fetches products by owner and published status.
- Server computes totals. Never trust client-submitted prices.
- Insert `business_orders` and `business_order_items`.
- Insert or link an `action_page_submissions` row with outcome `checked_out`.
- Apply existing pipeline rules for `checked_out` when an attributed lead
  exists.

## Dashboard UX

### Product List

`/dashboard/business/products`

- Header: `My Business / Products`, search, status filter, `New product`.
- Table/list columns: product, status, price, inventory status, tags, updated.
- Row actions: edit, view public card preview, archive/publish toggle.
- Empty state: direct CTA to create the first product and explain the minimum
  fields needed.

### Product Editor

`/dashboard/business/products/[id]`

Layout:

- Left/main: title, summary, description, pricing, availability, tags, feature
  list, specifications, recommendation hints.
- Right/aside: customer card preview, RAG preview text, publish state, media.

Behavior:

- Save as draft by default.
- Publish requires title, summary or description, valid price/pricing model,
  and at least one image unless the product explicitly allows no image.
- Show validation errors inline.
- Show whether the product is included in RAG.

### Orders

`/dashboard/business/orders`

- Lists unpaid/new order captures from catalog pages.
- Shows customer, order total, line item count, source page, lead link if
  attributed, and created time.
- Detail page shows line items and customer notes.
- Status can be changed manually among `new`, `confirmed`, `cancelled`,
  `fulfilled`.

## Public Catalog UX

Desktop:

- Store header with business display name and page intro.
- Responsive product grid.
- Product cards show image, title, short copy, price, and `Add to cart`.
- Detail panel/page shows full product details and media.
- Cart is a sticky side panel.

Mobile:

- Product cards become a single-column list/grid.
- Cart action is a bottom bar.
- Checkout form is a focused step after cart review.

Thank-you state:

- Confirms the order was received.
- Says the business will follow up.
- Does not mention payment unless a future payment module adds instructions.

## Server Code Structure

```text
src/lib/business/
  types.ts
  schemas.ts
  product-rag.ts
  public-dto.ts
  pricing.ts

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
src/app/a/[slug]/_kinds/catalog/Renderer.tsx
```

Data access should follow a small server-only DAL pattern: query functions
verify ownership and return minimal DTOs to UI/client components.

## Security Requirements

- Enable RLS on every new table.
- Every owner policy uses `user_id = auth.uid()` and `with check`.
- Public catalog routes use service-role only where necessary, and always
  filter by:
  - action page `status = published`
  - action page owner
  - item `status = published`
  - item `kind = product`
- Server actions must call `supabase.auth.getUser()` and include `user_id` in
  every write predicate.
- Never trust client-submitted prices, totals, owner IDs, product titles, or
  item status.
- Never expose service-role keys to client components.
- Do not store payment credentials, card data, bank-account data, or secret
  payment instructions.
- Sanitize/validate all text lengths. Render descriptions as plain text or a
  controlled rich-text subset; do not render arbitrary HTML.
- Uploads require owner checks, content-type checks, size limits, private
  storage, and short-lived signed URLs for public display.
- Order request metadata stores only non-sensitive data. IPs, if stored, must
  be hashed as existing action-page submissions do.
- Add database constraints for enum-like fields, positive prices, non-negative
  totals, and valid quantity ranges.

## Error Handling

- Missing auth in dashboard routes redirects to `/login`.
- Product not found or not owned returns `notFound()`.
- Invalid form input redirects back with a compact error message or returns a
  typed action state for client editors.
- Catalog with zero published products shows a neutral empty state, not a
  server error.
- Cart submission with invalid item IDs returns a validation error and does
  not create a partial order.
- If order insert succeeds but action-page submission linkage fails, log the
  failure and keep the order as source of truth.
- If RAG queueing fails after product save, keep the product save and mark
  embedding status stale/pending for retry.

## Testing

- Schema/RLS:
  - owner can CRUD own products
  - owner cannot read or mutate another user's products/orders/media
  - public/service queries only return published products for the page owner
- Product validation:
  - valid draft save
  - publish requirements
  - invalid price/currency/status rejected
  - `rag_text` generation excludes private fields
- RAG:
  - item source chunk planning
  - chunks deleted/tombstoned when product unpublished
  - retrieval title resolution includes product titles
- Catalog handler:
  - rejects invalid item IDs
  - recomputes totals server-side
  - creates order + line items
  - stores snapshots so later product edits do not alter old orders
- UI:
  - product list empty state
  - product editor validation states
  - public catalog cart quantity changes
  - mobile cart bottom action does not hide checkout fields

## Parallelization Plan After This Spec

This foundation can split cleanly into independent implementation tracks:

1. Schema, RLS, and storage bucket.
2. Business DAL, validation schemas, RAG text generation.
3. Owner dashboard product list/editor.
4. Public catalog renderer and order capture.
5. RAG ingest/retrieval source extension.

Each track should own a narrow file set and avoid changing the others'
implementation details except through DTO/schema contracts.

## Open Questions

None for the first pass. Payment methods, property listings, digital products,
and services will each get their own follow-up spec once this foundation is in
place.
