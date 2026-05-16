# Action Page Payment Checkout — Design

**Date:** 2026-05-16
**Status:** Draft

## Goal

Every **sales page** and **catalog page** exposes a "Proceed to payment" checkout block that:

1. Lists the seller's enabled payment methods, minus per-page exclusions.
2. Requires the buyer to upload a payment screenshot to ImageKit.
3. Records the result in a new `order_payments` table with admin verification (`submitted` / `verified` / `rejected`).

A per-page toggle hides/shows the payment section (default ON).

## Non-goals

- Card/gateway payments. Manual proof-of-payment only.
- Buyer-facing reconciliation ("your payment was confirmed" emails) — out of scope for v1.
- Multi-payment-per-order. One `order_payments` row per submission.

---

## Architecture

| Layer | Component | New / Changed |
|---|---|---|
| DB | `order_payments` table + trigger that syncs `business_orders.payment_status` | new migration |
| Config | Sales + Catalog `config.payment` block | schema-only (no DB migration) |
| Lib | `loadEnabledPaymentMethodsForPage(userId, excludedIds)` | new helper in `src/lib/payment-methods/public.ts` |
| Lib | `src/lib/order-payments/` — types, createFromSubmission, verify, reject | new module |
| API | `POST /api/action-pages/[slug]/payment-proofs` | new route (ImageKit upload, public) |
| API | `POST /api/action-pages/submit` | changed — accepts payment fields, creates `order_payments` |
| Public | Sales `Renderer.tsx` + new `SalesPaymentBlock.tsx` client | changed / new |
| Public | Catalog `Renderer.tsx` cart drawer | changed — required screenshot field |
| Dashboard | `PaymentSettingsPanel.tsx` reusable component | new |
| Dashboard | Sales editor + Catalog editor | changed — embed panel |
| Dashboard | `CatalogOrdersView.tsx` + new `SalesPaymentsView.tsx` | changed / new |
| Dashboard | `payment-actions.ts` server actions (verify / reject) | new |

## Buyer-side data flow

```
buyer picks method + amount + uploads screenshot
   ↓
POST /api/action-pages/[slug]/payment-proofs (multipart)
   → ImageKit upload to /action-pages/<page.id>/payment-proofs
   → { url, fileId }
   ↓
POST /api/action-pages/submit (form-encoded)
   data.payment_method_id, data.payment_proof_url, data.payment_proof_file_id,
   data.payment_amount, data.payment_currency, data.payment_note
   ↓
insert action_page_submissions (existing flow)
insert order_payments (new) with status='submitted'
if catalog: insert business_orders, payment_status='pending' (existing flow + new value)
trigger keeps business_orders.payment_status in sync when order_payments.status changes
```

---

## Database

New migration `supabase/migrations/<ts>_order_payments.sql`:

```sql
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
create index order_payments_user_idx          on public.order_payments (user_id, created_at desc);
create index order_payments_status_idx        on public.order_payments (user_id, status, created_at desc);
create index order_payments_order_idx         on public.order_payments (business_order_id)
  where business_order_id is not null;

alter table public.order_payments enable row level security;

create policy "owner can read"   on public.order_payments for select using (auth.uid() = user_id);
create policy "owner can update" on public.order_payments for update using (auth.uid() = user_id);
-- Inserts go through the service-role admin client (same pattern as action_page_submissions / business_orders).

-- Trigger: keep business_orders.payment_status in sync when status changes.
create or replace function public._order_payments_sync_business_order()
returns trigger language plpgsql as $$
begin
  if new.business_order_id is null then
    return new;
  end if;

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
```

### Why these choices

- **Unique by submission** — simplest mental model; one row per buyer transaction.
- **Snapshot `method_kind` / `method_name`** — record stays readable even after the payment method is renamed; FK is `restrict` so methods with payments can't be hard-deleted (soft-disable via `enabled=false`).
- **Trigger over app logic** for the catalog status sync — guarantees consistency even if a future code path forgets to update both sides.
- **RLS policies for read/update only**; inserts use the admin client, matching existing submit-route conventions.

## Config schema (no migration)

Sales config schema (`src/app/a/[slug]/_kinds/sales/schema.ts`) and catalog config gain:

```ts
payment?: {
  enabled?: boolean              // default true; missing/undefined → true
  excluded_method_ids?: string[] // ids to hide on this page
  require_proof?: boolean        // v1 locked to true; reserved
  amount_mode?: 'free'           // v1: sales = free entry; catalog = cart subtotal (no field)
}
```

**Catalog migration shim:** if old config has `payment_method_ids` (current include-list), the editor's read path converts it on load:

```
excluded_method_ids = (all current user's enabled method ids) - payment_method_ids
delete payment_method_ids
```

Persisted on next save. No DB migration needed.

---

## Public buyer UI

### Sales page — `SalesPaymentBlock.tsx` (new client component)

Rendered at the bottom of `src/app/a/[slug]/_kinds/sales/Renderer.tsx` when:
- `config.payment?.enabled !== false`, AND
- the user has ≥1 enabled payment method after applying `excluded_method_ids`.

Server-side load:

```ts
const paymentMethods = config.payment?.enabled === false
  ? []
  : await loadEnabledPaymentMethodsForPage(
      page.user_id,
      config.payment?.excluded_method_ids ?? [],
    )
```

Form fields (in order):
- **Method selector** — radio cards (kind icon, name, instructions, QR image if present).
- **Amount** input — free entry; currency dropdown defaults to page/business currency.
- **Buyer name + contact** (phone or email — same shape as the existing reveal form).
- **Screenshot upload** — required. File-picker / drag-drop. On select → immediate POST to `/api/action-pages/[slug]/payment-proofs` → store `{url, fileId}` in client state, show thumbnail. Validates jpeg/png/webp, ≤5 MB (server re-validates).
- **Note** — optional textarea, ≤500 chars.
- **Submit** — disabled until: method chosen, amount > 0, contact valid, proof uploaded.

Submit posts form-encoded to `/api/action-pages/submit` with:
```
slug
p, g, e, t          (deeplink claims, if present)
data.payment_method_id
data.payment_proof_url
data.payment_proof_file_id
data.payment_amount
data.payment_currency
data.payment_note
data.contact_name
data.contact_phone | data.contact_email
outcome = 'payment_submitted'
```

Success → existing thank-you screen pattern, with copy "We've received your payment proof and will confirm shortly."

### Catalog page — extend existing cart drawer

In `src/app/a/[slug]/_kinds/catalog/Renderer.tsx` cart drawer form (already has method radio + hidden `data.payment_method_id`):

- Add **required screenshot upload** field between method selection and Place-order button. Same upload flow as sales.
- Add optional **note** textarea.
- Place-order button stays disabled until method selected AND proof uploaded.
- When `config.payment?.enabled === false` → hide both method picker and screenshot fields; cart submit goes through as today, `business_orders.payment_status` stays `unpaid`.

### Upload endpoint — `POST /api/action-pages/[slug]/payment-proofs`

Clone of existing `/api/action-pages/[slug]/customer-images`:
- Same MIME allow-list (`image/jpeg`, `image/png`, `image/webp`).
- Same 5 MB cap.
- ImageKit folder: `/action-pages/<page.id>/payment-proofs`.
- Returns `{ url, fileId }`.
- No auth (page must be `published`, matching the sibling route).

### Server-side validation in `/api/action-pages/submit`

- If `data.payment_method_id` is present, `data.payment_proof_url` MUST be present.
- The payment method MUST belong to the page owner AND be enabled AND NOT in `config.payment.excluded_method_ids`.
- Reject otherwise with 400.
- On success: create `action_page_submissions` row (existing path), then insert `order_payments` row with snapshot fields and `status='submitted'`. For catalog, the existing `business_orders` insert continues to run; `business_order_id` is set on the `order_payments` row, and the trigger sets `payment_status='pending'`.

---

## Dashboard UI

### `PaymentSettingsPanel.tsx` (new, shared)

Path: `src/app/(app)/dashboard/action-pages/_components/PaymentSettingsPanel.tsx`.

```ts
interface Props {
  value: { enabled?: boolean; excluded_method_ids?: string[] }
  onChange: (next: NonNullable<Props['value']>) => void
  paymentMethods: PaymentMethod[]  // from loadPaymentMethods() server action
}
```

Layout:
- Header row: "Payment" title + Switch ("Show payment section on this page"). Default ON when `enabled` is `undefined` or `true`.
- When ON:
  - List of all user's payment methods. Each row: kind icon, name, checkbox "Show on this page" (default checked; unchecking adds id to `excluded_method_ids`).
  - Disabled methods (`payment_methods.enabled = false`) appear greyed-out with hint "Disabled in /payment-methods".
  - Empty state when seller has zero enabled methods: inline message + link to `/dashboard/payment-methods`.
- When OFF: panel body collapses; preview hides the checkout block.

### Sales editor (`src/app/(app)/dashboard/action-pages/_kinds/sales/Editor.tsx`)

Insert `<PaymentSettingsPanel>` as its own section. Use existing section grouping conventions. Loads `paymentMethods` server-side from `loadPaymentMethods()`.

### Catalog editor (`src/app/(app)/dashboard/action-pages/_kinds/catalog/Editor.tsx`)

Replace the existing "Payment method picker" UI (include-list) with `<PaymentSettingsPanel>` (exclude-list). Apply the catalog migration shim on read.

### Submissions / Orders viewers

**Catalog — `CatalogOrdersView.tsx` (changed):**
- New "Payment" column: method icon + name, status pill (`submitted` / `verified` / `rejected`), proof thumbnail (clickable lightbox to ImageKit URL).
- Row action menu:
  - **Mark as paid** → `verifyPayment(orderPaymentId)` → status `verified`, sets `verified_at` and `verified_by` to current user; trigger flips `business_orders.payment_status = 'paid'`.
  - **Reject** → opens dialog for `rejection_reason` (required, ≤500 chars) → `rejectPayment(orderPaymentId, reason)` → status `rejected`; trigger flips `business_orders.payment_status = 'failed'`.

**Sales — `SalesPaymentsView.tsx` (new):**
- Rendered on the existing submissions page (`src/app/(app)/dashboard/action-pages/[id]/submissions/page.tsx`) when the page kind is `sales` AND any submission has an `order_payments` row.
- Columns: created_at, contact, amount + currency, method, status, proof thumbnail, note, actions.
- Same Mark paid / Reject actions as catalog.

### Server actions

`src/app/(app)/dashboard/action-pages/[id]/submissions/payment-actions.ts`:

```ts
'use server'
export async function verifyPayment(orderPaymentId: string): Promise<void>
export async function rejectPayment(orderPaymentId: string, reason: string): Promise<void>
```

Both:
- `requireUser()` (existing helper pattern).
- Scope-check `user_id` on the row.
- Update row (status, `verified_at`/`verified_by` or `rejection_reason`).
- `revalidatePath` the submissions / orders viewer route.

---

## Edge cases

| Case | Behavior |
|---|---|
| Seller has zero enabled payment methods | Public block hidden regardless of `config.payment.enabled`. Editor shows empty state with link to payment methods page. |
| Payment method gets disabled after a payment | Existing `order_payments` rows remain (snapshot fields preserve label). Method no longer shown on public page. |
| Payment method ID submitted but the method is excluded or disabled | Submit endpoint rejects with 400. |
| Buyer uploads then abandons | Orphan ImageKit file. Acceptable for v1; ImageKit retention policies handle cleanup later. |
| `business_orders` is created but `order_payments` insert fails | Wrap both in the same submission transaction at the API level; on payment-row failure, rollback the order insert so we don't leave a half-state. |
| Verify/Reject called twice | Idempotent updates — re-applying the same status is a no-op. Trigger fires regardless but writes the same value. |
| Sales page payment used without deeplink claims (cold visitor) | Allowed. `lead_id`, `psid`, `page_id` remain null on the submission, same as existing form submissions. |
| Sales `payment.enabled = false` AND no linked action page | Page still renders; no CTA. Editor warns the seller. |

## Testing

- Unit: `order_payments` create + verify + reject logic, exclude-list filtering, catalog config migration shim.
- Integration: `/api/action-pages/submit` payload variants (with/without payment, with bad method id, with excluded method).
- Schema validation tests for sales + catalog parsers covering `payment` block.
- E2E manual (browser): sales page → submit payment → see in dashboard → mark paid → see status change.

## Rollout

- Single migration, single PR. No feature flag — the per-page default-ON toggle is itself the rollout knob.
- Existing catalog pages auto-migrate the first time their editor is opened (shim).
- Existing sales pages get `payment.enabled = true` implicitly (missing-key default).
