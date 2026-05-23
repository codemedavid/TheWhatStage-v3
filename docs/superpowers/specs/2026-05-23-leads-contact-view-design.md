# Leads Contact View — Design

**Status:** Draft — awaiting user approval
**Date:** 2026-05-23
**Author:** brainstorm pair (codemedavid + Claude)

## Goal

Add a new "Contact" view to the Leads page that surfaces only leads we can reach outside Messenger — i.e., leads where we have collected at least one phone number or email — and shows the **latest** value we collected for each kind, with provenance (when, from where).

This unblocks the team from manually scanning kanban/table to find callable/emailable leads.

## Scope (in / out)

In scope:
- New `view='contact'` mode on `/dashboard/leads`, sitting alongside `kanban` and `table`.
- New `lead_contact_values` table (per-value record) with timestamp and source.
- Rewrite of the single `appendLeadContacts` chokepoint so every existing collector (action-page form, booking form, catalog checkout, messenger regex extraction) writes per-value rows.
- Backfill from existing `leads.phones[]` / `leads.emails[]` arrays.
- Filters: has phone / has email / has either / has both, plus search + date range.
- Quick actions on each row: `tel:`, `mailto:`, copy-to-clipboard.
- Row click opens the existing `LeadDrawer` (so users can jump into the Conversation tab and see which Messenger customer the lead is).

Out of scope (deferred):
- Phone normalization to E.164.
- Stricter email validation / soft-hiding invalid addresses.
- "Collected via X" / "Fresh in last N days" / "Multiple phones" filters.
- Outbound contact tracking (call/SMS/email logs).
- Channels other than phone + email.

## Data Model

### New table

```sql
create table public.lead_contact_values (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  user_id      uuid not null,                       -- denorm for RLS + per-user queries
  kind         text not null check (kind in ('phone','email')),
  value        text not null,                       -- normalized: lower(trim(email)); trim(phone)
  source       text not null check (source in ('form','booking','catalog','messenger','manual')),
  collected_at timestamptz not null default now(),
  unique (lead_id, kind, value)                     -- per-lead dedup; same value across leads is fine
);

create index lead_contact_values_lead_kind_collected_idx
  on public.lead_contact_values (lead_id, kind, collected_at desc);

create index lead_contact_values_user_kind_idx
  on public.lead_contact_values (user_id, kind);
```

**Why a separate table:** the existing `leads.phones text[]` / `leads.emails text[]` columns are deduplicated via `SELECT DISTINCT` in `append_lead_contacts(...)`, so array order is undefined — "latest" is currently inexpressible. A separate table gives us a real `collected_at`, lets us record the `source`, and supports per-lead dedup without losing history.

**Keep arrays:** `leads.phones[]` / `leads.emails[]` stay as a denormalized cache. Two reasons:
1. The contact view's list-row filter `has phone? has email?` is just `cardinality(phones) > 0` against `leads`, no join needed.
2. Other call sites already read these arrays; we don't want to refactor unrelated code in this PR.

`leads.phone` / `leads.email` scalars also stay untouched. They are independent from `lead_contact_values`; we do not try to keep them in sync with "latest". (If we want that later, it's a follow-up — see Phase 2.)

### RLS

`lead_contact_values` mirrors the leads policy: a row is visible/mutable only when `user_id = auth.uid()`. Service-role insert via the rewritten RPC bypasses RLS as today.

### Rewrite of `append_lead_contacts`

The current RPC's signature: `(p_lead_id uuid, p_phones text[], p_emails text[])`. New signature adds `p_source text`:

```sql
create or replace function public.append_lead_contacts(
  p_lead_id uuid,
  p_phones  text[],
  p_emails  text[],
  p_source  text default 'manual'
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id from public.leads where id = p_lead_id;
  if v_user_id is null then return; end if;

  -- 1) Insert per-value rows (dedup via unique constraint).
  insert into public.lead_contact_values (lead_id, user_id, kind, value, source)
  select p_lead_id, v_user_id, 'phone', trim(v), p_source
  from unnest(coalesce(p_phones, '{}'::text[])) as v
  where trim(v) <> ''
  on conflict (lead_id, kind, value) do nothing;

  insert into public.lead_contact_values (lead_id, user_id, kind, value, source)
  select p_lead_id, v_user_id, 'email', lower(trim(v)), p_source
  from unnest(coalesce(p_emails, '{}'::text[])) as v
  where trim(v) <> ''
  on conflict (lead_id, kind, value) do nothing;

  -- 2) Maintain the denormalized arrays as before (callers still rely on them).
  update public.leads
  set
    phones = array(
      select distinct trim(v)
      from unnest(coalesce(phones, '{}'::text[]) || coalesce(p_phones, '{}'::text[])) as v
      where trim(v) <> ''
    ),
    emails = array(
      select distinct lower(trim(v))
      from unnest(coalesce(emails, '{}'::text[]) || coalesce(p_emails, '{}'::text[])) as v
      where trim(v) <> ''
    )
  where id = p_lead_id;
end;
$$;
```

Lib wrapper `src/lib/leads/contact-append.ts:appendLeadContacts` gains a `source` parameter:

```ts
type ContactSource = 'form' | 'booking' | 'catalog' | 'messenger' | 'manual'
appendLeadContacts(admin, leadId, { phones, emails, source: ContactSource })
```

Call sites updated:
- `src/app/api/action-pages/submit/route.ts:459` — pass `source: kind` (already 'form'/'booking'/'catalog').
- `src/app/api/messenger/process/route.ts:403` — pass `source: 'messenger'`. **This is the path the user called out: messenger-typed phones still flow through here and now get a real `collected_at` + `source='messenger'`.**
- `updateLead` server action (`src/app/(app)/dashboard/leads/actions/leads.ts`) — when the user manually edits scalar `phone`/`email` in the `LeadDrawer`, also call `appendLeadContacts(..., source: 'manual')`. Without this, the contact view would show a stale "latest" after a manual edit. Only call when the value actually changed and is non-empty.

**Value normalization stays at the lib boundary, not in the RPC.** The RPC only trims (and lowercases for email). Messenger regex extraction already strips spaces / dashes / parens via `extractPhones` before calling `appendLeadContacts`. Form/booking/catalog submissions store user-typed values as-is. Manual `updateLead` writes whatever the user typed. This is the existing behavior and we preserve it; deeper normalization is Phase 3.

### Backfill

One-time migration after the table is created:

```sql
insert into public.lead_contact_values (lead_id, user_id, kind, value, source, collected_at)
select l.id, l.user_id, 'phone', p, 'manual', l.created_at
from public.leads l, unnest(l.phones) p
where trim(p) <> ''
on conflict do nothing;

insert into public.lead_contact_values (lead_id, user_id, kind, value, source, collected_at)
select l.id, l.user_id, 'email', e, 'manual', l.created_at
from public.leads l, unnest(l.emails) e
where trim(e) <> ''
on conflict do nothing;
```

Caveats explicitly accepted:
- Backfilled rows get `collected_at = lead.created_at` (we don't have real timestamps for historical values).
- Backfilled rows get `source='manual'` (we no longer know the original source).

## Backend

### Schema additions (`_lib/schemas.ts`)

```ts
export const LeadsQuery = z.object({
  view: z.enum(['kanban', 'table', 'contact']).default('kanban'),
  // ... existing fields ...
  contact_filter: z.enum(['phone', 'email', 'either', 'both']).default('either'),
  contact_sort: z.enum(['recent_contact', 'recent_lead', 'name_asc']).default('recent_contact'),
})
```

`contact_filter` and `contact_sort` are only honored when `view === 'contact'`. They piggyback on the existing URL state.

### New query (`_lib/queries.ts`)

```ts
export type ContactLeadRow = LeadRow & {
  latest_phone: { value: string; source: string; collected_at: string } | null
  latest_email: { value: string; source: string; collected_at: string } | null
  latest_contact_at: string | null  // max(latest_phone.collected_at, latest_email.collected_at)
}

export async function fetchContactLeadsPage(
  supabase: SupabaseClient,
  userId: string,
  params: LeadsQuery,
): Promise<{ rows: ContactLeadRow[]; total: number }>
```

Implementation outline:
1. Base filter on `leads`:
   - `'phone'`  → `cardinality(phones) > 0`
   - `'email'`  → `cardinality(emails) > 0`
   - `'either'` → `cardinality(phones) > 0 OR cardinality(emails) > 0`
   - `'both'`   → `cardinality(phones) > 0 AND cardinality(emails) > 0`
2. Apply existing `q`, `from`, `to` filters (search hits scalar columns only — same as today; array-search deferred).
3. Order:
   - `recent_contact` → join + order by `latest_contact_at desc nulls last`
   - `recent_lead` → `leads.updated_at desc`
   - `name_asc` → `leads.name asc`
4. After paginating leads, batch-load latest `lead_contact_values` per `(lead_id, kind)` using a single `select distinct on (lead_id, kind)` query keyed by `order by lead_id, kind, collected_at desc`. Attach to rows in-memory.

This keeps the hot-path query against `leads` (already indexed, already paginated) and only does one supplemental batch query for the visible page.

### Server action surface

No new server actions for MVP. Quick actions are pure client-side links (`tel:`, `mailto:`, copy). Edits to contact info continue to go through the existing `LeadDrawer` → `updateLead` action.

## Frontend

### View toggle

Extend the view toggle in `LeadsHeaderActions` to add a third option: `Contact`. URL becomes `?view=contact`.

The header's lead count (`LeadsHeader`, currently from `fetchLeadsTotal`) should reflect the **contact-filtered** total when in contact view — otherwise the number is misleading ("1,200 leads" but the list shows 80). Add a `contact_filter`-aware path to `fetchLeadsTotal` (or a thin sibling `fetchContactLeadsTotal`) and select based on `params.view`.

### `ContactList` component (new)

Path: `src/app/(app)/dashboard/leads/_components/ContactList.tsx` (server) + `ContactList.client.tsx` (client interactivity, mirrors the `LeadsTable` / `LeadsTable.client.tsx` split).

Columns:

| Column      | Content                                                                 |
|-------------|-------------------------------------------------------------------------|
| (avatar)    | `messenger_threads.picture_url` if any, else initials                   |
| Name        | Lead name + small stage chip                                            |
| Phone       | Latest phone — click-to-call (`tel:`), copy icon, "Xd ago · source"     |
| Email       | Latest email — `mailto:`, copy icon, "Xd ago · source"                  |
| Last contact| `latest_contact_at` relative time                                       |
| Campaign    | Existing campaign name chip                                             |

Empty cells render `—` (so "has email but no phone" is visible at a glance). Row click opens `LeadDrawer` in `edit` mode with the existing `lead` row — same pattern as `LeadsTable.client.tsx`. Drawer's existing tabs (Details / Conversation / Comments / Orders / etc.) cover the "which Messenger customer is this?" need without changes.

Quick actions are inline on each row, not in a hover menu, so the page reads as a callable worklist. `tel:` and `mailto:` use anchor tags so they work on mobile and Mac handoff. Copy uses `navigator.clipboard.writeText` with a small toast.

### Filter UI

Segmented control above the list with four options: `Has either | Has phone | Has email | Has both`. Lives next to the existing search / date inputs in the toolbar. State syncs to `?contact_filter=…`. Default = `either`.

Sort dropdown: `Most recent contact (default) | Most recent lead activity | Name A–Z`. Syncs to `?contact_sort=…`.

The existing `Toolbar` component is reused; the contact-only controls render conditionally when `view === 'contact'`.

### Data flow

`page.tsx` `LeadsBody` already branches on `params.view`. Add a third branch:

```tsx
{params.view === 'contact' ? (
  <ContactList userId={user.id} stages={stages} fieldDefs={fieldDefs} campaigns={campaigns} params={params} />
) : params.view === 'kanban' ? (
  <KanbanBoard ... />
) : (
  <LeadsTable ... />
)}
```

`ContactList` (server component) calls `fetchContactLeadsPage`, then renders `<ContactListClient rows=… />` for interactivity (drawer open, copy, selection).

## Edge Cases

- **Lead with `phones=[]` but `phone='+639xx'`** (or vice versa): the backfill only seeds `lead_contact_values` from the arrays. If a lead has a scalar phone but no array, we miss it. **Decision:** also backfill from scalar columns:
  ```sql
  insert ... select id, user_id, 'phone', phone, 'manual', created_at from leads
  where phone is not null and trim(phone) <> '' on conflict do nothing;
  ```
- **Same phone in different formats** (`+63 917 …` vs `09171…`): trimmed but not normalized. Per-lead unique constraint will store both as separate rows. UI shows the latest one; the other is reachable via the drawer. Normalization deferred (Phase 3).
- **Junk emails / phones from messenger regex** (e.g., long product IDs): stored as-is, surfaced in the contact view, source pill reads `messenger` so the user can recognize lower-confidence values. Soft-hide deferred.
- **Old contact info** (collected a year ago): shown with relative time so age is obvious. No special hiding.
- **Lead with only Messenger PSID, no phone, no email**: excluded by design. That's the point of the view.
- **Lead deletion**: `on delete cascade` cleans up `lead_contact_values`.
- **Lead with 10+ phones**: list shows the single latest one; the rest are visible by opening the drawer (Details tab already shows the `phones[]` / `emails[]` arrays via the existing form, no change needed). A small `+N` chip is acceptable polish if cheap.
- **Same value re-collected**: unique constraint causes `on conflict do nothing` — no duplicate row, `collected_at` is **not** bumped. (Trade-off: we treat "latest collection of a distinct value" rather than "latest mention". This matches user intent — "which number can I call right now" — better than the alternative.)

## Risks & Trade-offs

- **`cardinality(phones) > 0` is not GIN-indexable.** On the current leads table size this is a fast seq scan; if it becomes hot, add a partial index `create index leads_has_phone_idx on leads (user_id) where cardinality(phones) > 0;` (and the email counterpart). Decision deferred until measured.
- **Backfill loses historical timestamps and sources.** Accepted — see Data Model > Backfill.
- **No phone normalization** means `+639171234567` and `09171234567` can coexist as two latest-rows over time. The latest one wins in the UI, which is acceptable but not perfect. Out of scope for MVP.
- **Existing kanban and table views unchanged.** No regression risk to current flows.
- **Search does not yet hit the arrays.** A lead with a phone only in `phones[]` (not in scalar `phone`) won't be found by the search box. This pre-exists today. We will document it but not fix in MVP.
- **RPC signature change is backwards-incompatible** (added required param? no — `p_source` has a default). Existing callers that don't pass `source` will get `'manual'`. We're rewriting all three known call sites in this PR anyway.

## Suggested Rollout

**MVP — one PR:**
1. Migration: create `lead_contact_values` + indexes + RLS policies.
2. Rewrite `append_lead_contacts` RPC (preserve denormalized arrays, also insert per-value rows).
3. Update `appendLeadContacts` wrapper + all four call sites (action-pages, messenger, updateLead, backfill) to pass `source`.
4. One-time backfill migration (arrays + scalar fallback).
5. Add `view='contact'`, `contact_filter`, `contact_sort` to `LeadsQuery`.
6. Add `fetchContactLeadsPage` query.
7. Add `ContactList` server + client components.
8. Wire third branch in `LeadsBody`.
9. Extend `LeadsHeaderActions` view toggle.
10. Add filter + sort controls to `Toolbar` (conditional on view).
11. Tests:
    - RPC: dedup, source recording, denorm sync, missing-lead guard.
    - `fetchContactLeadsPage`: each filter (`phone`/`email`/`either`/`both`), each sort, pagination, `latest_*` resolution.
    - Backfill idempotency (running twice produces no changes).

**Phase 2 (separate spec):**
- "Collected via X" filter + "Fresh in last N days" filter.
- Array-aware search (`exists (select 1 from unnest(phones) ...)`).
- Bulk export of callable list (CSV).
- Optional: derive scalar `leads.phone` / `leads.email` from latest `lead_contact_values` row via a trigger or generated column, so legacy code paths stay correct as data evolves.

**Phase 3 (separate spec):**
- Phone normalization to E.164 + cross-format dedup.
- Email validity flag + soft-hide of invalid.
- Optional outbound-contact tracking integration (was the lead already called?).

## Open Questions (resolved during brainstorming)

- ✅ Latest definition → new `lead_contact_values` table.
- ✅ Integration → new view + filters, not a tab on existing table.
- ✅ Channels → phone + email only.
- ✅ MVP scope → includes the new table (we did not split into a scalar-first MVP, to avoid throwaway work).
- ✅ Backfill from scalar columns when arrays are empty → yes.
- ✅ Quick actions (tel/mailto/copy) → in MVP.
- ✅ Default sort → most recently collected contact.
- ✅ Drawer integration → row click opens existing `LeadDrawer`; Conversation tab covers "which Messenger customer is this".

No remaining design-blocking questions.
