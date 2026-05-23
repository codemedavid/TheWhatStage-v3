# Leads Contact View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Contact" view to `/dashboard/leads` that lists only leads with a phone or email we can reach outside Messenger, showing the latest collected value with source + timestamp.

**Architecture:** Introduce a normalized `lead_contact_values` table behind the existing single chokepoint (`append_lead_contacts` RPC + `appendLeadContacts` lib wrapper). Keep `leads.phones[]` / `leads.emails[]` arrays as a denormalized "has any?" cache so list filtering stays on the indexed leads table. New view branch reuses existing pagination/sort/search/drawer infrastructure.

**Tech Stack:** Next.js App Router (v16.2.4), TypeScript, Supabase (Postgres + RLS + RPC), Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-05-23-leads-contact-view-design.md`

---

## File Structure

**Migrations (new):**
- `supabase/migrations/20260524000000_lead_contact_values.sql` — create table, indexes, RLS, rewrite RPC.
- `supabase/migrations/20260524000100_backfill_lead_contact_values.sql` — seed from existing arrays + scalars.

**Lib (modify):**
- `src/lib/leads/contact-append.ts` — add `source` param to wrapper.
- `src/lib/leads/contact-append.test.ts` — **new**, unit-test the wrapper.

**Leads page internals (modify):**
- `src/app/(app)/dashboard/leads/_lib/schemas.ts` — extend `LeadsQuery` (view enum, `contact_filter`, `contact_sort`).
- `src/app/(app)/dashboard/leads/_lib/schemas.test.ts` — **new**, schema parser tests.
- `src/app/(app)/dashboard/leads/_lib/queries.ts` — add `fetchContactLeadsPage`, `fetchContactLeadsTotal`, `ContactLeadRow` type.
- `src/app/(app)/dashboard/leads/actions/leads.ts` — `updateLead` also calls `appendLeadContacts` with `source: 'manual'` when phone/email changed.
- `src/app/(app)/dashboard/leads/page.tsx` — third branch for `view === 'contact'`; use contact-aware total.

**UI (modify + new):**
- `src/app/(app)/dashboard/leads/_components/LeadsHeader.tsx` — type update only (`view: 'kanban' | 'table' | 'contact'`).
- `src/app/(app)/dashboard/leads/_components/LeadsHeaderActions.tsx` — view toggle adds `Contact`.
- `src/app/(app)/dashboard/leads/_components/Toolbar.tsx` — render contact filter + sort controls when `view === 'contact'`.
- `src/app/(app)/dashboard/leads/_components/ContactList.tsx` — **new** server component, fetches and renders.
- `src/app/(app)/dashboard/leads/_components/ContactList.client.tsx` — **new** client component, drawer + quick actions.

**External call sites (modify):**
- `src/app/api/action-pages/submit/route.ts` — pass `source: kind`.
- `src/app/api/messenger/process/route.ts` — pass `source: 'messenger'`.

---

## Task 1: Create `lead_contact_values` table + rewrite RPC

**Files:**
- Create: `supabase/migrations/20260524000000_lead_contact_values.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Per-value contact log: gives us a real `collected_at` and `source` for every
-- phone/email we've ever captured for a lead. The denormalized `leads.phones[]`
-- and `leads.emails[]` arrays are still maintained by append_lead_contacts as a
-- cheap "has any?" cache for list filtering.

create table if not exists public.lead_contact_values (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  user_id      uuid not null,
  kind         text not null check (kind in ('phone','email')),
  value        text not null,
  source       text not null check (source in ('form','booking','catalog','messenger','manual')),
  collected_at timestamptz not null default now(),
  unique (lead_id, kind, value)
);

create index if not exists lead_contact_values_lead_kind_collected_idx
  on public.lead_contact_values (lead_id, kind, collected_at desc);

create index if not exists lead_contact_values_user_kind_idx
  on public.lead_contact_values (user_id, kind);

alter table public.lead_contact_values enable row level security;

create policy "lead_contact_values_select_own"
  on public.lead_contact_values for select
  using (user_id = auth.uid());

create policy "lead_contact_values_modify_own"
  on public.lead_contact_values for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Rewrite of append_lead_contacts:
--  * Inserts a per-value row into lead_contact_values (dedup via unique).
--  * Continues to maintain the denormalized arrays on leads.
--  * Adds p_source (default 'manual') so legacy callers stay correct.
create or replace function public.append_lead_contacts(
  p_lead_id uuid,
  p_phones  text[],
  p_emails  text[],
  p_source  text default 'manual'
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id from public.leads where id = p_lead_id;
  if v_user_id is null then return; end if;

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

grant execute on function public.append_lead_contacts(uuid, text[], text[], text) to service_role;
```

- [ ] **Step 2: Apply the migration locally**

Run: `npx supabase migration up` (or your project's equivalent — `supabase db push` against a local stack).
Expected: migration applies cleanly; `\d lead_contact_values` shows the table.

- [ ] **Step 3: Smoke-test the RPC**

Run in `psql` (against a local seed lead):
```sql
select append_lead_contacts(
  (select id from leads limit 1),
  array['+639171234567'],
  array['Jane@Example.com'],
  'messenger'
);
select kind, value, source, collected_at
from lead_contact_values
where lead_id = (select id from leads limit 1)
order by collected_at desc limit 5;
```
Expected: one phone row with `source='messenger'`, one email row with lowercased value.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260524000000_lead_contact_values.sql
git commit -m "feat(leads): add lead_contact_values table + source-aware append RPC"
```

---

## Task 2: Backfill from arrays + scalar columns

**Files:**
- Create: `supabase/migrations/20260524000100_backfill_lead_contact_values.sql`

- [ ] **Step 1: Write the migration**

```sql
-- One-time backfill. Historical values lose true timestamp + source — they get
-- the lead's created_at and source='manual'. Idempotent: re-running is a no-op
-- because of the unique constraint.

insert into public.lead_contact_values (lead_id, user_id, kind, value, source, collected_at)
select l.id, l.user_id, 'phone', trim(p), 'manual', l.created_at
from public.leads l, unnest(l.phones) p
where trim(p) <> ''
on conflict (lead_id, kind, value) do nothing;

insert into public.lead_contact_values (lead_id, user_id, kind, value, source, collected_at)
select l.id, l.user_id, 'email', lower(trim(e)), 'manual', l.created_at
from public.leads l, unnest(l.emails) e
where trim(e) <> ''
on conflict (lead_id, kind, value) do nothing;

-- Scalar fallbacks: leads whose array is empty but scalar phone/email is set.
insert into public.lead_contact_values (lead_id, user_id, kind, value, source, collected_at)
select l.id, l.user_id, 'phone', trim(l.phone), 'manual', l.created_at
from public.leads l
where l.phone is not null and trim(l.phone) <> ''
on conflict (lead_id, kind, value) do nothing;

insert into public.lead_contact_values (lead_id, user_id, kind, value, source, collected_at)
select l.id, l.user_id, 'email', lower(trim(l.email)), 'manual', l.created_at
from public.leads l
where l.email is not null and trim(l.email) <> ''
on conflict (lead_id, kind, value) do nothing;
```

- [ ] **Step 2: Apply and verify**

Run: `npx supabase migration up`.
Then in `psql`:
```sql
select count(*) from lead_contact_values;
select count(distinct lead_id) from lead_contact_values;
```
Expected: counts match roughly the count of leads that have phone/email data.

- [ ] **Step 3: Verify idempotency**

Re-run the SQL body of the backfill migration manually in `psql`. Expected: zero rows changed (`INSERT 0 0` for each statement) — the unique constraint plus `on conflict do nothing` makes it safe.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260524000100_backfill_lead_contact_values.sql
git commit -m "feat(leads): backfill lead_contact_values from existing arrays and scalars"
```

---

## Task 3: Update `appendLeadContacts` lib wrapper to accept `source`

**Files:**
- Modify: `src/lib/leads/contact-append.ts`
- Test: `src/lib/leads/contact-append.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/lib/leads/contact-append.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { appendLeadContacts } from './contact-append'

function makeAdmin() {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
  return { rpc } as unknown as Parameters<typeof appendLeadContacts>[0]
}

describe('appendLeadContacts', () => {
  it('forwards phones, emails, and source to the RPC', async () => {
    const admin = makeAdmin()
    await appendLeadContacts(admin, 'lead-1', {
      phones: ['+639171234567'],
      emails: ['Jane@Example.com'],
      source: 'messenger',
    })
    const rpc = admin.rpc as ReturnType<typeof vi.fn>
    expect(rpc).toHaveBeenCalledWith('append_lead_contacts', {
      p_lead_id: 'lead-1',
      p_phones: ['+639171234567'],
      p_emails: ['Jane@Example.com'],
      p_source: 'messenger',
    })
  })

  it('defaults source to "manual" when omitted', async () => {
    const admin = makeAdmin()
    await appendLeadContacts(admin, 'lead-1', { phones: ['+639171234567'] })
    const rpc = admin.rpc as ReturnType<typeof vi.fn>
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_source: 'manual' })
  })

  it('skips the RPC when both arrays are empty', async () => {
    const admin = makeAdmin()
    await appendLeadContacts(admin, 'lead-1', { phones: [], emails: [], source: 'manual' })
    expect((admin.rpc as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/leads/contact-append.test.ts`
Expected: FAIL — `source` is not part of the current signature.

- [ ] **Step 3: Update the wrapper to accept source**

In `src/lib/leads/contact-append.ts`, replace the `appendLeadContacts` function (lines 22-43) with:

```ts
export type ContactSource = 'form' | 'booking' | 'catalog' | 'messenger' | 'manual'

/**
 * Atomically append contact values to a lead's phones/emails arrays and to the
 * normalized lead_contact_values table. Best-effort: logs but never throws.
 */
export async function appendLeadContacts(
  admin: SupabaseClient,
  leadId: string,
  contacts: { phones?: string[]; emails?: string[]; source?: ContactSource },
): Promise<void> {
  const phones = (contacts.phones ?? []).filter(Boolean)
  const emails = (contacts.emails ?? []).filter(Boolean)
  if (!phones.length && !emails.length) return

  const { error } = await admin.rpc('append_lead_contacts', {
    p_lead_id: leadId,
    p_phones: phones,
    p_emails: emails,
    p_source: contacts.source ?? 'manual',
  })
  if (error) {
    console.warn('[lead.contacts] append failed', { leadId, error: error.message })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/leads/contact-append.test.ts`
Expected: PASS — all three tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/leads/contact-append.ts src/lib/leads/contact-append.test.ts
git commit -m "feat(leads): add source param to appendLeadContacts wrapper"
```

---

## Task 4: Pass `source` from action-pages submit handler

**Files:**
- Modify: `src/app/api/action-pages/submit/route.ts:459`

- [ ] **Step 1: Read the current call site**

Run: `sed -n '450,465p' src/app/api/action-pages/submit/route.ts`
Note the variable name for the submission kind in scope (likely `kind`, value is `'form' | 'booking' | 'catalog'`).

- [ ] **Step 2: Update the call**

Replace:
```ts
await appendLeadContacts(admin, leadId, contacts)
```
With:
```ts
await appendLeadContacts(admin, leadId, {
  ...contacts,
  source: kind as 'form' | 'booking' | 'catalog',
})
```

(If the in-scope variable is not literally named `kind`, use whatever variable holds the submission kind. Confirm by reading the surrounding 30 lines.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors related to this file.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/action-pages/submit/route.ts
git commit -m "feat(leads): tag action-page contact captures with their submission kind"
```

---

## Task 5: Pass `source: 'messenger'` from messenger worker

**Files:**
- Modify: `src/app/api/messenger/process/route.ts:403`

- [ ] **Step 1: Update the call**

Replace the existing fire-and-forget call (around line 403):
```ts
void appendLeadContacts(admin, leadIdForContacts, {
  phones: detectedPhones,
  emails: detectedEmails,
}).catch((e) => console.warn('[messenger.worker] appendLeadContacts failed', e))
```
With:
```ts
void appendLeadContacts(admin, leadIdForContacts, {
  phones: detectedPhones,
  emails: detectedEmails,
  source: 'messenger',
}).catch((e) => console.warn('[messenger.worker] appendLeadContacts failed', e))
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/messenger/process/route.ts
git commit -m "feat(leads): tag messenger-extracted contacts with source"
```

---

## Task 6: Wire `appendLeadContacts` into `updateLead` (manual edits)

**Files:**
- Modify: `src/app/(app)/dashboard/leads/actions/leads.ts:69`

Without this, manually editing phone/email in the `LeadDrawer` leaves the contact view showing a stale "latest" value.

- [ ] **Step 1: Read the existing function**

Run: `sed -n '60,85p' src/app/(app)/dashboard/leads/actions/leads.ts`
Confirm the current shape: parses `LeadInput`, updates the row, revalidates.

- [ ] **Step 2: Update `updateLead` to also write per-value rows**

Add the import at the top of the file (if not already present):
```ts
import { appendLeadContacts } from '@/lib/leads/contact-append'
import { createAdminClient } from '@/lib/supabase/admin'
```

Replace the body of `updateLead` with:
```ts
export async function updateLead(id: string, raw: unknown) {
  const input = normalize(LeadInput.parse(raw))
  const { supabase } = await requireUser()

  // Read the prior values so we only log per-value rows when phone/email actually changed.
  const { data: prior } = await supabase
    .from('leads').select('phone, email').eq('id', id).maybeSingle()

  const { error } = await supabase.from('leads').update(input).eq('id', id)
  if (error) throw error

  const phoneChanged =
    typeof input.phone === 'string' && input.phone.trim() !== '' && input.phone !== prior?.phone
  const emailChanged =
    typeof input.email === 'string' && input.email.trim() !== '' && input.email !== prior?.email

  if (phoneChanged || emailChanged) {
    const admin = createAdminClient()
    await appendLeadContacts(admin, id, {
      phones: phoneChanged ? [input.phone as string] : [],
      emails: emailChanged ? [input.email as string] : [],
      source: 'manual',
    })
  }

  revalidatePath('/dashboard/leads', 'layout')
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Manual smoke test**

Start the dev server (`npm run dev`), open a lead in the drawer, change the phone, save. In `psql`:
```sql
select kind, value, source, collected_at
from lead_contact_values
where lead_id = '<the lead id>' and kind = 'phone'
order by collected_at desc limit 3;
```
Expected: a new row with `source='manual'` and `collected_at = now()`.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/actions/leads.ts
git commit -m "feat(leads): log manual phone/email edits to lead_contact_values"
```

---

## Task 7: Extend `LeadsQuery` schema

**Files:**
- Modify: `src/app/(app)/dashboard/leads/_lib/schemas.ts:39-47`
- Test: `src/app/(app)/dashboard/leads/_lib/schemas.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/app/(app)/dashboard/leads/_lib/schemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { LeadsQuery } from './schemas'

describe('LeadsQuery', () => {
  it('accepts view=contact', () => {
    const parsed = LeadsQuery.parse({ view: 'contact' })
    expect(parsed.view).toBe('contact')
  })

  it('defaults contact_filter to "either" and contact_sort to "recent_contact"', () => {
    const parsed = LeadsQuery.parse({ view: 'contact' })
    expect(parsed.contact_filter).toBe('either')
    expect(parsed.contact_sort).toBe('recent_contact')
  })

  it('rejects unknown contact_filter values', () => {
    expect(() => LeadsQuery.parse({ view: 'contact', contact_filter: 'nope' })).toThrow()
  })

  it('accepts each valid contact_filter', () => {
    for (const f of ['phone', 'email', 'either', 'both'] as const) {
      const parsed = LeadsQuery.parse({ view: 'contact', contact_filter: f })
      expect(parsed.contact_filter).toBe(f)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/\(app\)/dashboard/leads/_lib/schemas.test.ts`
Expected: FAIL — `view='contact'` not in the enum.

- [ ] **Step 3: Extend the schema**

Replace `LeadsQuery` in `src/app/(app)/dashboard/leads/_lib/schemas.ts`:

```ts
export const LeadsQuery = z.object({
  view: z.enum(['kanban', 'table', 'contact']).default('kanban'),
  stage: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().trim().max(120).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sort: z.enum(['recent', 'oldest', 'name_asc', 'value_desc']).default('recent'),
  contact_filter: z.enum(['phone', 'email', 'either', 'both']).default('either'),
  contact_sort: z.enum(['recent_contact', 'recent_lead', 'name_asc']).default('recent_contact'),
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/\(app\)/dashboard/leads/_lib/schemas.test.ts`
Expected: PASS — all four tests green.

- [ ] **Step 5: Update the page parser to forward the new fields**

In `src/app/(app)/dashboard/leads/page.tsx`, update the `LeadsQuery.parse({...})` call to include the new fields:

```ts
const params = LeadsQuery.parse({
  view: sp.view, stage: sp.stage, page: sp.page,
  q: sp.q, from: sp.from, to: sp.to, sort: sp.sort,
  contact_filter: sp.contact_filter,
  contact_sort: sp.contact_sort,
})
```

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/_lib/schemas.ts src/app/\(app\)/dashboard/leads/_lib/schemas.test.ts src/app/\(app\)/dashboard/leads/page.tsx
git commit -m "feat(leads): extend LeadsQuery schema with view=contact and filters"
```

---

## Task 8: Add `fetchContactLeadsPage` + `fetchContactLeadsTotal`

**Files:**
- Modify: `src/app/(app)/dashboard/leads/_lib/queries.ts`

- [ ] **Step 1: Add the `ContactLeadRow` type**

Append to `src/app/(app)/dashboard/leads/_lib/queries.ts` near the existing `LeadRow` type:

```ts
export type ContactValueRef = {
  value: string
  source: 'form' | 'booking' | 'catalog' | 'messenger' | 'manual'
  collected_at: string
}

export type ContactLeadRow = LeadRow & {
  latest_phone: ContactValueRef | null
  latest_email: ContactValueRef | null
  latest_contact_at: string | null
}
```

- [ ] **Step 2: Add `fetchContactLeadsTotal`**

Append below `fetchLeadsTotal`:

```ts
// Filter expression shared by total + page. GIN indexes don't help here;
// a partial index can be added later if this becomes hot.
//   either → at least one array non-empty
//   phone  → phones non-empty
//   email  → emails non-empty
//   both   → both arrays non-empty
// PostgREST: `cardinality(phones) > 0` is expressed as `phones.neq.{}`.

export async function fetchContactLeadsTotal(
  supabase: SupabaseClient,
  userId: string,
  params: LeadsQuery,
): Promise<number> {
  let query = supabase
    .from('leads').select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (params.contact_filter === 'phone') query = query.not('phones', 'eq', '{}')
  else if (params.contact_filter === 'email') query = query.not('emails', 'eq', '{}')
  else if (params.contact_filter === 'both') query = query.not('phones', 'eq', '{}').not('emails', 'eq', '{}')
  else query = query.or('phones.neq.{},emails.neq.{}')

  if (params.q) {
    const term = `%${params.q}%`
    query = query.or(
      `name.ilike.${term},email.ilike.${term},phone.ilike.${term},company.ilike.${term}`,
    )
  }
  if (params.from) query = query.gte('created_at', `${params.from}T00:00:00Z`)
  if (params.to)   query = query.lte('created_at', `${params.to}T23:59:59Z`)
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}
```

- [ ] **Step 3: Add `fetchContactLeadsPage`**

Append below `fetchLeadsPage`:

```ts
export async function fetchContactLeadsPage(
  supabase: SupabaseClient,
  userId: string,
  params: LeadsQuery,
): Promise<{ rows: ContactLeadRow[]; total: number }> {
  let query = supabase
    .from('leads')
    .select('*, messenger_threads(picture_url), campaigns(name)', { count: 'exact' })
    .eq('user_id', userId)

  if (params.contact_filter === 'phone') query = query.not('phones', 'eq', '{}')
  else if (params.contact_filter === 'email') query = query.not('emails', 'eq', '{}')
  else if (params.contact_filter === 'both') query = query.not('phones', 'eq', '{}').not('emails', 'eq', '{}')
  else query = query.or('phones.neq.{},emails.neq.{}')

  if (params.q) {
    const term = `%${params.q}%`
    query = query.or(
      `name.ilike.${term},email.ilike.${term},phone.ilike.${term},company.ilike.${term}`,
    )
  }
  if (params.from) query = query.gte('created_at', `${params.from}T00:00:00Z`)
  if (params.to)   query = query.lte('created_at', `${params.to}T23:59:59Z`)

  // Sort: latest-contact sort happens client-side after we attach the join,
  // because we can't easily order on a lateral subquery via PostgREST. Use
  // updated_at as the SQL-side fallback for stable pagination.
  if (params.contact_sort === 'name_asc') {
    query = query.order('name', { ascending: true })
  } else {
    query = query.order('updated_at', { ascending: false })
  }

  const from = (params.page - 1) * PAGE_SIZE
  const to   = from + PAGE_SIZE - 1
  const { data, error, count } = await query.range(from, to)
  if (error) throw error
  const baseRows = ((data ?? []) as LeadRowWithJoins[]).map(flattenLead)

  const leadIds = baseRows.map((l) => l.id)
  type RawContact = {
    lead_id: string
    kind: 'phone' | 'email'
    value: string
    source: ContactValueRef['source']
    collected_at: string
  }
  const latestByLead = new Map<string, { phone: ContactValueRef | null; email: ContactValueRef | null }>()
  if (leadIds.length > 0) {
    const { data: cv } = await supabase
      .from('lead_contact_values')
      .select('lead_id, kind, value, source, collected_at')
      .in('lead_id', leadIds)
      .order('collected_at', { ascending: false })
    for (const row of (cv ?? []) as RawContact[]) {
      let bucket = latestByLead.get(row.lead_id)
      if (!bucket) {
        bucket = { phone: null, email: null }
        latestByLead.set(row.lead_id, bucket)
      }
      if (row.kind === 'phone' && !bucket.phone) {
        bucket.phone = { value: row.value, source: row.source, collected_at: row.collected_at }
      } else if (row.kind === 'email' && !bucket.email) {
        bucket.email = { value: row.value, source: row.source, collected_at: row.collected_at }
      }
    }
  }

  let rows: ContactLeadRow[] = baseRows.map((l) => {
    const bucket = latestByLead.get(l.id) ?? { phone: null, email: null }
    const latest_contact_at =
      bucket.phone && bucket.email
        ? (bucket.phone.collected_at > bucket.email.collected_at ? bucket.phone.collected_at : bucket.email.collected_at)
        : (bucket.phone?.collected_at ?? bucket.email?.collected_at ?? null)
    return { ...l, latest_phone: bucket.phone, latest_email: bucket.email, latest_contact_at }
  })

  if (params.contact_sort === 'recent_contact') {
    rows = rows.sort((a, b) => {
      if (a.latest_contact_at === b.latest_contact_at) return 0
      if (a.latest_contact_at === null) return 1
      if (b.latest_contact_at === null) return -1
      return a.latest_contact_at < b.latest_contact_at ? 1 : -1
    })
  }

  return { rows, total: count ?? 0 }
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/_lib/queries.ts
git commit -m "feat(leads): add fetchContactLeadsPage + Total with latest-value join"
```

---

## Task 9: Wire view branching in the page

**Files:**
- Modify: `src/app/(app)/dashboard/leads/page.tsx`
- Modify: `src/app/(app)/dashboard/leads/_components/LeadsHeader.tsx:7-14`

- [ ] **Step 1: Widen `LeadsHeader`'s view type**

In `src/app/(app)/dashboard/leads/_components/LeadsHeader.tsx`, change the prop:
```ts
view: 'kanban' | 'table'
```
to:
```ts
view: 'kanban' | 'table' | 'contact'
```

Do the same in the `LeadsBodyFallback` prop type in `src/app/(app)/dashboard/leads/page.tsx`.

- [ ] **Step 2: Switch the total fetch and render branch**

In `src/app/(app)/dashboard/leads/page.tsx`, import the new query:
```ts
import { fetchStages, fetchStagesCached, fetchFieldDefsCached, fetchLeadsTotal, fetchContactLeadsTotal, fetchCampaignOptions } from './_lib/queries'
```
And the new component (created in Task 10):
```ts
import { ContactList } from './_components/ContactList'
```

In `LeadsBody`, replace the `fetchLeadsTotal` call with a view-aware version:
```ts
const totalPromise =
  params.view === 'contact'
    ? fetchContactLeadsTotal(supabase, user.id, params)
    : fetchLeadsTotal(supabase, user.id, params)

const [stages, fieldDefs, total, campaigns, chatbotConfig] = await Promise.all([
  justSeeded ? fetchStages(supabase, user.id) : fetchStagesCached(user.id),
  fetchFieldDefsCached(user.id),
  totalPromise,
  fetchCampaignOptions(supabase, user.id),
  getChatbotConfig(supabase, user.id),
])
```

Replace the body rendering branch:
```tsx
<div className="mt-5">
  {params.view === 'kanban' ? (
    <KanbanBoard userId={user.id} stages={stages} fieldDefs={fieldDefs} campaigns={campaigns} params={params} />
  ) : params.view === 'contact' ? (
    <ContactList userId={user.id} stages={stages} fieldDefs={fieldDefs} campaigns={campaigns} params={params} />
  ) : (
    <LeadsTable userId={user.id} stages={stages} fieldDefs={fieldDefs} campaigns={campaigns} params={params} />
  )}
</div>
```

Also keep the `StageRulesTip` only on kanban (already true via `params.view === 'kanban'`).

- [ ] **Step 3: Typecheck — expect ContactList missing**

Run: `npx tsc --noEmit`
Expected: error — `ContactList` not found. This is fine; we create it in Task 10.

- [ ] **Step 4: Do not commit yet**

We'll commit at the end of Task 10 once `ContactList` exists. Move on.

---

## Task 10: Create `ContactList` server component

**Files:**
- Create: `src/app/(app)/dashboard/leads/_components/ContactList.tsx`

- [ ] **Step 1: Write the server component**

Create the file:

```tsx
import { createClient } from '@/lib/supabase/server'
import { fetchContactLeadsPage } from '../_lib/queries'
import type { LeadsQuery } from '../_lib/schemas'
import type { StageRow, FieldDefRow, CampaignOption } from '../_lib/queries'
import { ContactListClient } from './ContactList.client'

export async function ContactList({
  userId, stages, fieldDefs, campaigns, params,
}: {
  userId: string
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
  campaigns: CampaignOption[]
  params: LeadsQuery
}) {
  const supabase = await createClient()
  const { rows, total } = await fetchContactLeadsPage(supabase, userId, params)

  return (
    <ContactListClient
      rows={rows}
      total={total}
      stages={stages}
      fieldDefs={fieldDefs}
      campaigns={campaigns}
      page={params.page}
    />
  )
}
```

- [ ] **Step 2: Typecheck — expect ContactListClient missing**

Run: `npx tsc --noEmit`
Expected: error — `ContactListClient` not found. Move to Task 11.

---

## Task 11: Create `ContactList.client.tsx` with drawer + quick actions

**Files:**
- Create: `src/app/(app)/dashboard/leads/_components/ContactList.client.tsx`

- [ ] **Step 1: Write the client component**

```tsx
'use client'
import { useState } from 'react'
import { LeadDrawer } from './LeadDrawer'
import type { ContactLeadRow, StageRow, FieldDefRow, CampaignOption } from '../_lib/queries'

function relativeAge(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return '1d ago'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

function sourceLabel(s: string): string {
  switch (s) {
    case 'messenger': return 'Messenger'
    case 'form':      return 'Form'
    case 'booking':   return 'Booking'
    case 'catalog':   return 'Catalog'
    case 'manual':    return 'Manual'
    default:          return s
  }
}

export function ContactListClient({
  rows, total, stages, fieldDefs, campaigns, page,
}: {
  rows: ContactLeadRow[]
  total: number
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
  campaigns: CampaignOption[]
  page: number
}) {
  const [editing, setEditing] = useState<ContactLeadRow | null>(null)

  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? '—'

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value) } catch { /* clipboard unavailable */ }
  }

  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        background: 'var(--lead-surface)',
        border: '1px solid var(--lead-line)',
        boxShadow: 'var(--lead-shadow-sm)',
      }}
    >
      <div className="overflow-x-auto lead-scroll">
        <table className="w-full text-[13px]">
          <thead
            className="sticky top-0 z-[1]"
            style={{ background: 'var(--lead-surface-2)', borderBottom: '1px solid var(--lead-line)' }}
          >
            <tr style={{ color: 'var(--lead-muted)' }}>
              <th className="px-3 py-2.5 text-left">Name</th>
              <th className="px-3 py-2.5 text-left">Phone</th>
              <th className="px-3 py-2.5 text-left">Email</th>
              <th className="px-3 py-2.5 text-left">Last contact</th>
              <th className="px-3 py-2.5 text-left">Campaign</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center" style={{ color: 'var(--lead-muted)' }}>
                  <div className="text-[14px] font-medium" style={{ color: 'var(--lead-ink)' }}>
                    No reachable leads
                  </div>
                  <div className="mt-1 text-[12px]">
                    No leads match the current contact filter.
                  </div>
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer hover:bg-[color:var(--lead-surface-2)]"
                style={{ borderTop: '1px solid var(--lead-line)' }}
                onClick={() => setEditing(r)}
              >
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    {r.picture_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.picture_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                    ) : (
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--lead-surface-2)] text-[10px]" style={{ color: 'var(--lead-muted)' }}>
                        {r.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="flex flex-col">
                      <span style={{ color: 'var(--lead-ink)' }}>{r.name}</span>
                      <span className="text-[11px]" style={{ color: 'var(--lead-muted)' }}>{stageName(r.stage_id)}</span>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {r.latest_phone ? (
                    <div className="flex flex-col" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <a href={`tel:${r.latest_phone.value}`} className="hover:underline" style={{ color: 'var(--lead-ink)' }}>
                          {r.latest_phone.value}
                        </a>
                        <button
                          type="button"
                          onClick={() => copy(r.latest_phone!.value)}
                          className="text-[11px] underline"
                          style={{ color: 'var(--lead-muted)' }}
                        >
                          copy
                        </button>
                      </div>
                      <span className="text-[11px]" style={{ color: 'var(--lead-muted)' }}>
                        {relativeAge(r.latest_phone.collected_at)} · {sourceLabel(r.latest_phone.source)}
                      </span>
                    </div>
                  ) : (
                    <span style={{ color: 'var(--lead-faint)' }}>—</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {r.latest_email ? (
                    <div className="flex flex-col" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <a href={`mailto:${r.latest_email.value}`} className="hover:underline" style={{ color: 'var(--lead-ink)' }}>
                          {r.latest_email.value}
                        </a>
                        <button
                          type="button"
                          onClick={() => copy(r.latest_email!.value)}
                          className="text-[11px] underline"
                          style={{ color: 'var(--lead-muted)' }}
                        >
                          copy
                        </button>
                      </div>
                      <span className="text-[11px]" style={{ color: 'var(--lead-muted)' }}>
                        {relativeAge(r.latest_email.collected_at)} · {sourceLabel(r.latest_email.source)}
                      </span>
                    </div>
                  ) : (
                    <span style={{ color: 'var(--lead-faint)' }}>—</span>
                  )}
                </td>
                <td className="px-3 py-2.5" style={{ color: 'var(--lead-muted)' }}>
                  {relativeAge(r.latest_contact_at)}
                </td>
                <td className="px-3 py-2.5" style={{ color: 'var(--lead-muted)' }}>
                  {r.campaign_name ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-3 py-2 text-[12px]" style={{ color: 'var(--lead-muted)', borderTop: '1px solid var(--lead-line)' }}>
        <span>Page {page} · {total} {total === 1 ? 'lead' : 'leads'}</span>
      </div>

      {editing && (
        <LeadDrawer
          mode="edit"
          lead={editing}
          stages={stages}
          fieldDefs={fieldDefs}
          campaigns={campaigns}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit Tasks 9–11 together**

```bash
git add src/app/\(app\)/dashboard/leads/page.tsx src/app/\(app\)/dashboard/leads/_components/LeadsHeader.tsx src/app/\(app\)/dashboard/leads/_components/ContactList.tsx src/app/\(app\)/dashboard/leads/_components/ContactList.client.tsx
git commit -m "feat(leads): contact view list with drawer + quick actions"
```

---

## Task 12: View toggle (Kanban / Table / Contact)

**Files:**
- Modify: `src/app/(app)/dashboard/leads/_components/LeadsHeaderActions.tsx`

- [ ] **Step 1: Widen the prop type**

Change:
```ts
view: 'kanban' | 'table'
```
to:
```ts
view: 'kanban' | 'table' | 'contact'
```

Both in the `LeadsHeaderActions` props and the `ViewSwitch` props.

- [ ] **Step 2: Add `contact` to the toggle**

In `ViewSwitch`, change the iterated tuple:
```ts
{(['kanban', 'table'] as const).map((v) => {
```
to:
```ts
{(['kanban', 'table', 'contact'] as const).map((v) => {
```

The existing button rendering picks up the label from `v`; if the existing code uses a switch/map for labels, add a `contact` entry that renders the word `"Contact"`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Manual smoke test**

`npm run dev`, visit `/dashboard/leads`. Confirm the toggle shows three pills. Click "Contact". URL becomes `?view=contact`. The contact list renders.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/_components/LeadsHeaderActions.tsx
git commit -m "feat(leads): add Contact option to view toggle"
```

---

## Task 13: Filter + sort controls in the toolbar

**Files:**
- Modify: `src/app/(app)/dashboard/leads/_components/Toolbar.tsx`

- [ ] **Step 1: Render filter + sort controls when `view === 'contact'`**

At the bottom of the existing `Toolbar` JSX (inside the same flex container, after the search + date filters), conditionally render:

```tsx
{params.view === 'contact' && (
  <>
    <div
      className="inline-flex h-8 items-center rounded-full p-0.5"
      style={{ background: 'var(--lead-surface-2)', border: '1px solid var(--lead-line)' }}
    >
      {(['either', 'phone', 'email', 'both'] as const).map((f) => {
        const active = params.contact_filter === f
        return (
          <button
            key={f}
            type="button"
            onClick={() => set({ contact_filter: f, page: undefined })}
            className="lead-focus h-7 rounded-full px-3 text-[12px] transition-colors"
            style={{
              background: active ? 'var(--lead-accent)' : 'transparent',
              color: active ? '#fff' : 'var(--lead-ink)',
            }}
          >
            {f === 'either' ? 'Has either' : f === 'phone' ? 'Has phone' : f === 'email' ? 'Has email' : 'Has both'}
          </button>
        )
      })}
    </div>

    <select
      value={params.contact_sort}
      onChange={(e) => set({ contact_sort: e.target.value, page: undefined })}
      className="lead-focus h-8 rounded-full px-3 text-[12px]"
      style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)', color: 'var(--lead-ink)' }}
    >
      <option value="recent_contact">Sort: most recent contact</option>
      <option value="recent_lead">Sort: most recent lead activity</option>
      <option value="name_asc">Sort: name A–Z</option>
    </select>
  </>
)}
```

The `useUrlState` hook used in the toolbar (`set({...})`) already serializes query params; make sure `contact_filter` and `contact_sort` are not stripped by any allow-list inside `_useUrlState` (read the file first; if there's a list, add the two keys).

- [ ] **Step 2: Confirm `_useUrlState` accepts the new keys**

Run: `grep -n "contact_filter\|allow\|whitelist" src/app/\(app\)/dashboard/leads/_components/_useUrlState.ts`
If there's an explicit allow-list, add `'contact_filter'` and `'contact_sort'`. Otherwise (passthrough), no change needed.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Manual smoke test**

`npm run dev`. Visit `/dashboard/leads?view=contact`. Click each filter pill — the URL updates, the list reloads, the count in the header updates. Change the sort — order changes. Click a row — the existing `LeadDrawer` opens; switch to the Conversation tab and confirm the Messenger thread renders.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/_components/Toolbar.tsx src/app/\(app\)/dashboard/leads/_components/_useUrlState.ts
git commit -m "feat(leads): contact view filters and sort in toolbar"
```

---

## Task 14: Full verification pass

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `contact-append.test.ts` and `schemas.test.ts`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Manual end-to-end smoke test**

`npm run dev`. Walk through:
1. Visit `/dashboard/leads` — kanban renders unchanged.
2. Click `Table` toggle — table renders unchanged.
3. Click `Contact` toggle — URL becomes `?view=contact`, contact list renders with the right header count.
4. Each filter pill (`Has either | phone | email | both`) updates the list and the count.
5. Each sort option reorders the list.
6. Click a row — `LeadDrawer` opens in edit mode.
7. In the drawer, change the phone, save. Re-open the row. The new phone is the "latest" in the contact view (the row should jump to the top when sorted by recent_contact).
8. In `psql`: confirm a new row in `lead_contact_values` with `source='manual'`.
9. Trigger a messenger reply that contains a phone number (or use the regex helpers directly in a Node REPL against a local lead). Confirm a row appears with `source='messenger'`.

- [ ] **Step 4: Final tag commit**

```bash
git commit --allow-empty -m "feat(leads): contact view rollout complete"
```

---

## Out of Scope (deferred — separate plans)

- Phone normalization to E.164 + cross-format dedup.
- Stricter email validity filter / soft-hide.
- "Collected via X" filter; "Fresh in last N days" filter.
- Array-aware search (search box hitting `phones[]` / `emails[]`).
- Bulk export (CSV) of callable list.
- Outbound-contact tracking integration.
