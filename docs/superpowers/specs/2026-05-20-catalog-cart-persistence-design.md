# Catalog Action-Page Cart Persistence

**Status:** design
**Date:** 2026-05-20

## Problem

The catalog action page (`src/app/a/[slug]/_kinds/catalog/Renderer.tsx`) keeps the visitor's cart in React `useState` only — once the page is closed or reloaded, the cart is gone. A returning Facebook visitor who arrived earlier with items in their cart sees an empty store.

We want carts to persist per Facebook visitor (PSID) per action page, so the same visitor returning to the same catalog sees the items they had previously added. We also want store owners to see these carts in the Lead Drawer, alongside orders.

## Goals

- A returning Facebook visitor (identified by a signed PSID claim on the action page URL) sees their previously added items when they revisit the same catalog.
- Cart writes happen automatically on quantity changes — no extra UX surface.
- On successful checkout, the cart is converted and the next visit starts fresh.
- Saved carts are visible in the Lead Drawer under a new "Carts" tab.
- Action-page visitor carts plug into the existing `cart_abandoned` workflow tick without further code changes.

## Non-goals

- Persistence for anonymous visitors without signed claims (no cookie/device fallback). The catalog still works; just no persistence.
- Cross-page cart merging.
- Multi-active-cart support per visitor.
- Editing or deleting visitor carts from the dashboard.

## Architecture

### Identity and key

Visitor carts are keyed on `(action_page_id, psid)`. The PSID is read from the signed JWT claims already present on action page URLs (`claims.psid`, `claims.pageId`, `claims.exp`, validated against `rawToken`). No claims → no persistence.

### Data model

Extend the existing `public.carts` table — no new tables. The existing abandoned-cart workflow, RLS, and dashboard read paths continue to work unchanged.

```sql
alter table public.carts
  add column action_page_id uuid references public.action_pages(id) on delete cascade,
  add column psid           text;

-- Only one active cart per visitor per action page
create unique index carts_active_visitor_idx
  on public.carts (action_page_id, psid)
  where status = 'active'
    and action_page_id is not null
    and psid is not null;

-- Fast lookup for the GET route
create index carts_action_page_psid_idx
  on public.carts (action_page_id, psid)
  where action_page_id is not null;
```

- `user_id` remains required and is populated from the action page's owner so existing `carts_owner_all` RLS works for the dashboard.
- `source = 'action_page'` is set on insert (already a documented value).
- `lead_id` is populated when the visitor's PSID maps to an existing `messenger_threads.psid` for the same `page_id` (resolves to `thread.lead_id`). If no thread/lead exists yet, `lead_id` stays null; it will not surface in the Lead Drawer until a thread is established.

### API routes

Two new public routes under the existing action-page API surface. Both verify the signed claims (`t` token + `p`/`g`/`e` query/body params) using the same helper the existing submit route uses. All writes use service-role inside the route — the visitor is anonymous, RLS denies them direct access.

#### `GET /api/action-pages/[slug]/cart`

Auth: requires valid signed claims.

Response:

```json
{ "items": [{ "id": "<product_id>", "quantity": 2 }] }
```

- Looks up the action page by slug, joins to the active cart by `(action_page_id, psid)`, returns its `cart_items` mapped to `{ id: product_id, quantity }`.
- Returns `{ "items": [] }` when no active cart exists or claims are invalid/expired (no error response — keep the page resilient).

#### `PUT /api/action-pages/[slug]/cart`

Auth: requires valid signed claims.

Body:

```json
{ "items": [{ "id": "<product_id>", "quantity": 2 }] }
```

Behavior:

1. Validate claims; if invalid → 200 with `{ skipped: true }` (silent no-op to keep the renderer simple).
2. Resolve action page → `(action_page_id, user_id)`.
3. Resolve `lead_id` via `messenger_threads` lookup on `(page_id, psid)` → `thread.lead_id` (nullable).
4. Look up active cart for `(action_page_id, psid)`. If none, insert one with `status='active'`, `source='action_page'`, `user_id`, `lead_id`, `currency` from the page's products (fallback `'USD'`).
5. Fetch current product prices for the submitted product ids (filter to products belonging to `user_id` and active). Drop unknown/inactive ids.
6. Replace `cart_items`: delete existing items for the cart, insert new rows with server-resolved `name`, `unit_price`, `image_url`, `quantity`.
7. Recompute and update `carts.total_amount` from the new lines. `carts.updated_at` is bumped automatically by the existing trigger.

Empty `items` (visitor emptied their cart) deletes all `cart_items` and sets `total_amount = null` — the active cart row itself stays so the workflow can still mark it abandoned. (Alternative considered: delete the cart row when empty. Rejected for simplicity — empty cart rows are cheap and avoid race conditions with concurrent puts.)

#### Convert on checkout

The existing checkout submit handler at `/api/action-pages/submit` already runs when the visitor places an order. Add a step at the tail of the successful order-create path: if `claims.psid` is present and an active cart exists for `(action_page_id, psid)`, set `status='converted'`, `converted_at = now()`. Failures here log but do not fail the order.

### Renderer changes (`src/app/a/[slug]/_kinds/catalog/Renderer.tsx`)

Minimal surface area — keep `quantities` as the single source of truth in React.

- On mount, if `claims` is present, `GET /api/action-pages/:slug/cart` and seed `quantities` from the response inside a `startTransition`. While loading, the UI behaves as if the cart is empty; no skeleton needed.
- Wrap the existing `setQty` so each change schedules a debounced (≈500 ms) `PUT` carrying the full items list. Maintain at most one in-flight request; if a newer call lands while one is in flight, queue it and fire on completion. Failures are caught and logged to console; the UI never blocks.
- Skip both hydrate and writes when `claims` is missing.
- No changes to checkout submit on the client — the server takes care of conversion.

### Lead Drawer — Carts tab

- Add `'carts'` to the `Tab` union in `LeadDrawer.tsx`, positioned next to `'orders'`.
- New `src/app/(app)/dashboard/leads/_components/CartsPanel.tsx`, modelled on the existing `OrdersPanel.tsx` shape.
- Server query (via a server action, mirroring how `OrdersPanel` loads): fetch carts where `lead_id = $1`, joined to action page name and items, ordered by `created_at desc`.
- Each row renders: status badge (`active` / `abandoned` / `converted`), source, action page name, created/updated timestamps, line items (thumbnail + name + qty + unit price), total.
- Read-only — no mutate actions.

### Abandoned-cart workflow

No code changes. The existing tick sweeps `status='active'` carts idle past the configured threshold and fires the `cart_abandoned` trigger when a `lead_id` is attached. Action-page carts inherit this automatically when their visitor's PSID resolves to a known lead. Carts without a lead remain `active` until checkout or until manual cleanup — accepted trade-off.

## Component boundaries

| Unit | Purpose | Inputs | Outputs |
| --- | --- | --- | --- |
| `cart` API routes (GET, PUT) | Visitor-facing persistence | slug, signed claims, items[] | items[] / 204 |
| `cartConvert` step in submit route | Mark cart converted on order create | action_page_id, psid | side effect |
| `Renderer.tsx` cart sync | Hydrate + debounced sync | claims, quantities | network writes |
| `CartsPanel.tsx` | Owner-facing read | lead_id | rendered list |

The two backend surfaces (visitor write path, owner read path) reuse the same `carts` / `cart_items` tables but never touch each other's RLS — visitor routes are service-role, owner reads go through the existing `carts_owner_all` policy.

## Error handling

- Invalid / expired claims on GET → return empty items (no error to client).
- Invalid claims on PUT → return `{ skipped: true }` with 200.
- DB error on PUT → 500 to client; renderer logs and continues with local state.
- DB error on convert-on-submit → log only; order success is the contract, cart status is best-effort.
- Unknown product ids in PUT body → silently dropped (the catalog page can never legitimately send these unless products were deleted mid-session).

## Migrations

One new SQL migration: `supabase/migrations/<timestamp>_carts_action_page_visitor.sql` containing the two column adds and two indexes from the Data model section.

No backfill — existing rows have `action_page_id = null` and `psid = null` and remain only matched by `user_id`-based RLS.

## Testing

- **Migration**: applied against local Supabase. Re-run `carts_owner_all` RLS check from a non-owner session to confirm policies are unchanged.
- **API**:
  - GET with valid claims returns saved items.
  - GET with no claims returns empty.
  - GET with expired claims returns empty.
  - PUT creates active cart on first call; PUT replaces items; PUT with empty array leaves cart row but clears items.
  - PUT unknown product ids → filtered, not stored.
  - Submit route marks cart converted when claims match.
- **Renderer**: hydration test (cart seeded), debounce coalesces rapid `+` clicks into one PUT, no PUT fired when claims missing.
- **CartsPanel**: renders carts for a lead with status badges and totals; empty state with no carts.

## Out of scope (deferred)

- Anonymous visitor fallback (cookie / device ID).
- Cross-action-page or cross-page cart unification.
- Manual cart edit/delete from dashboard.
- Push of abandoned-cart triggers for carts without a lead.
