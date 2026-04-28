# Leads Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-user Leads CRM with a customizable pipeline, Kanban + table views, custom fields, search/filter/sort/pagination, bulk operations, and drag-and-drop transfer between stages.

**Architecture:** Next.js 16 App Router server components + server actions. Supabase Postgres with RLS keyed on `auth.uid()`. URL-driven UI state. `@dnd-kit/core` for Kanban drag-and-drop with optimistic UI.

**Tech Stack:** Next.js 16.2.4, React 19.2.4, Supabase (`@supabase/ssr` 0.10.2), Tailwind 4, Zod 4, Vitest 4, `@dnd-kit/core` + `@dnd-kit/sortable` (new).

**Spec:** `docs/superpowers/specs/2026-04-28-leads-pipeline-design.md`

---

## Task 1: Database migration — tables, indexes, RLS

**Files:**
- Create: `supabase/migrations/20260428100000_leads_pipeline.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =========================================================================
-- Leads pipeline: pipeline_stages, leads, lead_field_defs (per-user)
-- =========================================================================

create extension if not exists pg_trgm;

create table public.pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  description text,
  position    integer not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index pipeline_stages_user_position_idx
  on public.pipeline_stages (user_id, position);

create unique index pipeline_stages_one_default_per_user
  on public.pipeline_stages (user_id) where is_default;

create table public.lead_field_defs (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  key       text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label     text not null check (char_length(label) between 1 and 60),
  type      text not null check (type in ('text','number','date','select')),
  options   jsonb,
  position  integer not null,
  created_at timestamptz not null default now(),
  unique (user_id, key)
);

create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  stage_id        uuid not null references public.pipeline_stages(id) on delete restrict,
  name            text not null check (char_length(name) between 1 and 120),
  email           text,
  phone           text,
  company         text,
  job_title       text,
  source          text,
  estimated_value numeric(12,2),
  notes           text,
  custom_fields   jsonb not null default '{}'::jsonb,
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index leads_user_stage_position_idx
  on public.leads (user_id, stage_id, position);
create index leads_user_created_at_idx
  on public.leads (user_id, created_at desc);
create index leads_search_trgm_idx
  on public.leads using gin (
    (coalesce(name,'') || ' ' || coalesce(email,'') || ' ' ||
     coalesce(phone,'') || ' ' || coalesce(company,'')) gin_trgm_ops
  );

-- updated_at trigger (reuse existing public.set_updated_at)
create trigger leads_set_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

-- RLS
alter table public.pipeline_stages enable row level security;
alter table public.lead_field_defs enable row level security;
alter table public.leads           enable row level security;

create policy pipeline_stages_owner_all on public.pipeline_stages
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy lead_field_defs_owner_all on public.lead_field_defs
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy leads_owner_all on public.leads
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 2: Apply locally**

Run: `npx supabase db reset` (or `db push` if preferred).
Expected: migration applies clean, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260428100000_leads_pipeline.sql
git commit -m "feat(db): add leads pipeline tables, indexes, and RLS"
```

---

## Task 2: Add `@dnd-kit` dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

Run: `npm install @dnd-kit/core @dnd-kit/sortable`
Expected: both packages added to `dependencies` in `package.json`.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @dnd-kit/core and @dnd-kit/sortable"
```

---

## Task 3: Add "Leads" entry to sidebar

**Files:**
- Modify: `src/app/(app)/_components/sidebar.tsx`

- [ ] **Step 1: Add entry**

Replace the `items` array:

```tsx
const items = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/leads', label: 'Leads' },
  { href: '/dashboard/activity', label: 'Activity' },
  { href: '/dashboard/settings', label: 'Settings' },
]
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/_components/sidebar.tsx
git commit -m "feat(sidebar): add Leads entry"
```

---

## Task 4: Zod schemas + shared types

**Files:**
- Create: `src/app/(app)/dashboard/leads/_lib/schemas.ts`

- [ ] **Step 1: Write schemas**

```ts
import { z } from 'zod'

export const StageInput = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(500).optional().nullable(),
})
export type StageInput = z.infer<typeof StageInput>

export const FieldDefInput = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().min(1).max(60),
  type: z.enum(['text', 'number', 'date', 'select']),
  options: z.array(z.string().min(1)).optional().nullable(),
})
export type FieldDefInput = z.infer<typeof FieldDefInput>

export const LeadInput = z.object({
  stage_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().max(40).optional().nullable(),
  company: z.string().max(120).optional().nullable(),
  job_title: z.string().max(120).optional().nullable(),
  source: z.string().max(60).optional().nullable(),
  estimated_value: z.number().nonnegative().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  custom_fields: z.record(z.string(), z.unknown()).default({}),
})
export type LeadInput = z.infer<typeof LeadInput>

export const BulkUpdateInput = LeadInput.partial().omit({ stage_id: true })
export type BulkUpdateInput = z.infer<typeof BulkUpdateInput>

export const LeadsQuery = z.object({
  view: z.enum(['kanban', 'table']).default('kanban'),
  stage: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().trim().max(120).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sort: z.enum(['recent', 'oldest', 'name_asc', 'value_desc']).default('recent'),
})
export type LeadsQuery = z.infer<typeof LeadsQuery>

export const PAGE_SIZE = 25
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/dashboard/leads/_lib/schemas.ts
git commit -m "feat(leads): add zod schemas and shared types"
```

---

## Task 5: Default stages constant + seeding helper

**Files:**
- Create: `src/app/(app)/dashboard/leads/_lib/defaults.ts`
- Create: `src/app/(app)/dashboard/leads/_lib/seed.ts`

- [ ] **Step 1: Defaults**

```ts
// defaults.ts
export const DEFAULT_STAGES: { name: string; description: string; isDefault: boolean }[] = [
  { name: 'New Lead',    description: 'Freshly captured leads.',     isDefault: true  },
  { name: 'Contacted',   description: 'Initial outreach sent.',      isDefault: false },
  { name: 'Qualified',   description: 'Confirmed fit and interest.', isDefault: false },
  { name: 'Unqualified', description: 'Not a fit right now.',        isDefault: false },
  { name: 'Proposal',    description: 'Proposal or quote sent.',     isDefault: false },
  { name: 'Won',         description: 'Closed-won deals.',           isDefault: false },
  { name: 'Lost',        description: 'Closed-lost deals.',          isDefault: false },
]
```

- [ ] **Step 2: Seed helper**

```ts
// seed.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_STAGES } from './defaults'

export async function seedDefaultStagesIfEmpty(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { count, error: countErr } = await supabase
    .from('pipeline_stages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (countErr) throw countErr
  if ((count ?? 0) > 0) return

  const rows = DEFAULT_STAGES.map((s, i) => ({
    user_id:     userId,
    name:        s.name,
    description: s.description,
    position:    i,
    is_default:  s.isDefault,
  }))

  const { error } = await supabase.from('pipeline_stages').insert(rows)
  if (error) throw error
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/dashboard/leads/_lib/defaults.ts src/app/(app)/dashboard/leads/_lib/seed.ts
git commit -m "feat(leads): add default stages and seeding helper"
```

---

## Task 6: Server actions — stages

**Files:**
- Create: `src/app/(app)/dashboard/leads/actions/stages.ts`

- [ ] **Step 1: Write actions**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { StageInput } from '../_lib/schemas'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function createStage(raw: unknown) {
  const input = StageInput.parse(raw)
  const { supabase, userId } = await requireUser()

  const { data: maxRow } = await supabase
    .from('pipeline_stages')
    .select('position')
    .eq('user_id', userId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextPos = (maxRow?.position ?? -1) + 1
  const { error } = await supabase.from('pipeline_stages').insert({
    user_id: userId, ...input, position: nextPos, is_default: false,
  })
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function updateStage(id: string, raw: unknown) {
  const input = StageInput.parse(raw)
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from('pipeline_stages')
    .update(input)
    .eq('id', id)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function deleteStage(id: string) {
  const { supabase, userId } = await requireUser()

  const { data: target } = await supabase
    .from('pipeline_stages')
    .select('id, is_default')
    .eq('id', id).single()

  if (!target) throw new Error('Stage not found')
  if (target.is_default) throw new Error('Cannot delete the default stage')

  const { data: def } = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('user_id', userId).eq('is_default', true).single()
  if (!def) throw new Error('No default stage to receive leads')

  const { error: moveErr } = await supabase
    .from('leads').update({ stage_id: def.id }).eq('stage_id', id)
  if (moveErr) throw moveErr

  const { error } = await supabase.from('pipeline_stages').delete().eq('id', id)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function reorderStages(orderedIds: string[]) {
  const { supabase, userId } = await requireUser()
  const updates = orderedIds.map((id, position) =>
    supabase.from('pipeline_stages')
      .update({ position }).eq('id', id).eq('user_id', userId)
  )
  const results = await Promise.all(updates)
  for (const r of results) if (r.error) throw r.error
  revalidatePath('/dashboard/leads', 'layout')
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/dashboard/leads/actions/stages.ts
git commit -m "feat(leads): add stage server actions"
```

---

## Task 7: Server actions — leads CRUD + bulk + move

**Files:**
- Create: `src/app/(app)/dashboard/leads/actions/leads.ts`

- [ ] **Step 1: Write actions**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { LeadInput, BulkUpdateInput } from '../_lib/schemas'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

function normalize(input: z.infer<typeof LeadInput>) {
  return {
    ...input,
    email: input.email || null,
  }
}

export async function createLead(raw: unknown) {
  const input = normalize(LeadInput.parse(raw))
  const { supabase, userId } = await requireUser()

  const { data: maxRow } = await supabase
    .from('leads').select('position')
    .eq('user_id', userId).eq('stage_id', input.stage_id)
    .order('position', { ascending: false }).limit(1).maybeSingle()

  const nextPos = (maxRow?.position ?? -1) + 1
  const { error } = await supabase.from('leads').insert({
    user_id: userId, ...input, position: nextPos,
  })
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function updateLead(id: string, raw: unknown) {
  const input = normalize(LeadInput.parse(raw))
  const { supabase } = await requireUser()
  const { error } = await supabase.from('leads').update(input).eq('id', id)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function deleteLead(id: string) {
  const { supabase } = await requireUser()
  const { error } = await supabase.from('leads').delete().eq('id', id)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function bulkDeleteLeads(ids: string[]) {
  if (ids.length === 0) return
  const { supabase } = await requireUser()
  const { error } = await supabase.from('leads').delete().in('id', ids)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function bulkUpdateLeads(ids: string[], raw: unknown) {
  if (ids.length === 0) return
  const partial = BulkUpdateInput.parse(raw)
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(partial)) {
    if (v !== undefined) patch[k] = v
  }
  if (Object.keys(patch).length === 0) return
  const { supabase } = await requireUser()
  const { error } = await supabase.from('leads').update(patch).in('id', ids)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function moveLead(id: string, toStageId: string, toPosition: number) {
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from('leads')
    .update({ stage_id: toStageId, position: toPosition })
    .eq('id', id)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function bulkMoveLeads(ids: string[], toStageId: string) {
  if (ids.length === 0) return
  const { supabase, userId } = await requireUser()

  const { data: maxRow } = await supabase
    .from('leads').select('position')
    .eq('user_id', userId).eq('stage_id', toStageId)
    .order('position', { ascending: false }).limit(1).maybeSingle()

  let pos = (maxRow?.position ?? -1) + 1
  const updates = ids.map((id) => {
    const p = pos++
    return supabase.from('leads')
      .update({ stage_id: toStageId, position: p })
      .eq('id', id)
  })
  const results = await Promise.all(updates)
  for (const r of results) if (r.error) throw r.error
  revalidatePath('/dashboard/leads', 'layout')
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/dashboard/leads/actions/leads.ts
git commit -m "feat(leads): add lead CRUD, bulk, and move server actions"
```

---

## Task 8: Server actions — custom field defs

**Files:**
- Create: `src/app/(app)/dashboard/leads/actions/fields.ts`

- [ ] **Step 1: Write actions**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FieldDefInput } from '../_lib/schemas'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function createFieldDef(raw: unknown) {
  const input = FieldDefInput.parse(raw)
  const { supabase, userId } = await requireUser()

  const { data: maxRow } = await supabase
    .from('lead_field_defs').select('position')
    .eq('user_id', userId).order('position', { ascending: false })
    .limit(1).maybeSingle()

  const nextPos = (maxRow?.position ?? -1) + 1
  const { error } = await supabase.from('lead_field_defs').insert({
    user_id: userId, ...input, position: nextPos,
  })
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function updateFieldDef(id: string, raw: unknown) {
  const input = FieldDefInput.parse(raw)
  const { supabase } = await requireUser()
  const { error } = await supabase.from('lead_field_defs').update(input).eq('id', id)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function deleteFieldDef(id: string) {
  const { supabase, userId } = await requireUser()

  const { data: def } = await supabase
    .from('lead_field_defs').select('key').eq('id', id).single()
  if (!def) throw new Error('Field not found')

  // Strip key from existing leads.custom_fields
  const { error: stripErr } = await supabase.rpc('jsonb_strip_lead_field', {
    p_user_id: userId,
    p_key:     def.key,
  })
  // Fallback if RPC not present: do it client-side
  if (stripErr && stripErr.code === '42883') {
    const { data: rows } = await supabase
      .from('leads').select('id, custom_fields').eq('user_id', userId)
    for (const row of rows ?? []) {
      const cf = { ...(row.custom_fields as Record<string, unknown>) }
      if (def.key in cf) {
        delete cf[def.key]
        await supabase.from('leads').update({ custom_fields: cf }).eq('id', row.id)
      }
    }
  } else if (stripErr) {
    throw stripErr
  }

  const { error } = await supabase.from('lead_field_defs').delete().eq('id', id)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/dashboard/leads/actions/fields.ts
git commit -m "feat(leads): add custom field def server actions"
```

---

## Task 9: Query helpers — fetch leads with filters/sort/pagination

**Files:**
- Create: `src/app/(app)/dashboard/leads/_lib/queries.ts`

- [ ] **Step 1: Write helpers**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { LeadsQuery, PAGE_SIZE } from './schemas'

const SORT_MAP: Record<LeadsQuery['sort'], { col: string; asc: boolean; nullsLast?: boolean }> = {
  recent:     { col: 'created_at',      asc: false },
  oldest:     { col: 'created_at',      asc: true  },
  name_asc:   { col: 'name',            asc: true  },
  value_desc: { col: 'estimated_value', asc: false, nullsLast: true },
}

export type LeadRow = {
  id: string; stage_id: string; name: string; email: string | null;
  phone: string | null; company: string | null; job_title: string | null;
  source: string | null; estimated_value: number | null; notes: string | null;
  custom_fields: Record<string, unknown>; position: number;
  created_at: string; updated_at: string;
}

export async function fetchStages(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from('pipeline_stages').select('*')
    .eq('user_id', userId).order('position', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function fetchFieldDefs(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from('lead_field_defs').select('*')
    .eq('user_id', userId).order('position', { ascending: true })
  if (error) throw error
  return data ?? []
}

function applyFilters(q: ReturnType<SupabaseClient['from']>, params: LeadsQuery) {
  let query = q
  if (params.q) {
    const term = `%${params.q}%`
    query = query.or(
      `name.ilike.${term},email.ilike.${term},phone.ilike.${term},company.ilike.${term}`,
    )
  }
  if (params.from) query = query.gte('created_at', `${params.from}T00:00:00Z`)
  if (params.to)   query = query.lte('created_at', `${params.to}T23:59:59Z`)
  return query
}

export async function fetchLeadsPage(
  supabase: SupabaseClient,
  userId: string,
  params: LeadsQuery,
  stageId?: string,
): Promise<{ rows: LeadRow[]; total: number }> {
  const sort = SORT_MAP[params.sort]
  let query = supabase
    .from('leads').select('*', { count: 'exact' })
    .eq('user_id', userId)
  if (stageId) query = query.eq('stage_id', stageId)

  query = applyFilters(query, params)
    .order(sort.col, { ascending: sort.asc, nullsFirst: !sort.nullsLast })

  const from = (params.page - 1) * PAGE_SIZE
  const to   = from + PAGE_SIZE - 1
  const { data, error, count } = await query.range(from, to)
  if (error) throw error
  return { rows: (data ?? []) as LeadRow[], total: count ?? 0 }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/dashboard/leads/_lib/queries.ts
git commit -m "feat(leads): add query helpers for filters/sort/pagination"
```

---

## Task 10: Page shell — `/dashboard/leads`

**Files:**
- Create: `src/app/(app)/dashboard/leads/page.tsx`
- Create: `src/app/(app)/dashboard/leads/_components/Pagination.tsx`

- [ ] **Step 1: Pagination component**

```tsx
// Pagination.tsx
import Link from 'next/link'
import { PAGE_SIZE } from '../_lib/schemas'

export function Pagination({
  total, page, makeHref,
}: {
  total: number; page: number; makeHref: (p: number) => string
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  if (pages <= 1) return null
  const window = Array.from({ length: pages }, (_, i) => i + 1).slice(
    Math.max(0, page - 3), Math.max(0, page - 3) + 5,
  )
  return (
    <nav className="flex items-center gap-2 text-sm">
      <Link href={makeHref(Math.max(1, page - 1))}
        className="px-2 py-1 border rounded disabled:opacity-50"
        aria-disabled={page === 1}>Prev</Link>
      {window.map((p) => (
        <Link key={p} href={makeHref(p)}
          className={`px-2 py-1 border rounded ${p === page ? 'bg-emerald-600 text-white' : ''}`}>
          {p}
        </Link>
      ))}
      <Link href={makeHref(Math.min(pages, page + 1))}
        className="px-2 py-1 border rounded"
        aria-disabled={page === pages}>Next</Link>
    </nav>
  )
}
```

- [ ] **Step 2: Page shell**

```tsx
// page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { LeadsQuery } from './_lib/schemas'
import { seedDefaultStagesIfEmpty } from './_lib/seed'
import { fetchStages, fetchFieldDefs, fetchLeadsPage } from './_lib/queries'
import { Toolbar } from './_components/Toolbar'
import { ViewToggle } from './_components/ViewToggle'
import { KanbanBoard } from './_components/KanbanBoard'
import { LeadsTable } from './_components/LeadsTable'

export default async function LeadsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const params = LeadsQuery.parse({
    view: sp.view, stage: sp.stage, page: sp.page,
    q: sp.q, from: sp.from, to: sp.to, sort: sp.sort,
  })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  await seedDefaultStagesIfEmpty(supabase, user.id)

  const [stages, fieldDefs] = await Promise.all([
    fetchStages(supabase, user.id),
    fetchFieldDefs(supabase, user.id),
  ])

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[#111827]">Leads</h1>
        <ViewToggle view={params.view} />
      </header>

      <Toolbar params={params} stages={stages} fieldDefs={fieldDefs} />

      {params.view === 'kanban' ? (
        <KanbanBoard
          userId={user.id}
          stages={stages}
          fieldDefs={fieldDefs}
          params={params}
        />
      ) : (
        <LeadsTable
          userId={user.id}
          stages={stages}
          fieldDefs={fieldDefs}
          params={params}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/dashboard/leads/page.tsx src/app/(app)/dashboard/leads/_components/Pagination.tsx
git commit -m "feat(leads): add page shell and pagination"
```

---

## Task 11: ViewToggle + Toolbar (URL-driven)

**Files:**
- Create: `src/app/(app)/dashboard/leads/_components/ViewToggle.tsx`
- Create: `src/app/(app)/dashboard/leads/_components/Toolbar.tsx`
- Create: `src/app/(app)/dashboard/leads/_components/_useUrlState.ts`

- [ ] **Step 1: useUrlState helper**

```ts
'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useTransition, useCallback } from 'react'

export function useUrlState() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [, start] = useTransition()

  const set = useCallback((patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k)
      else next.set(k, v)
    }
    next.delete('page') // reset on filter change
    start(() => router.replace(`${pathname}?${next.toString()}`))
  }, [router, pathname, sp])

  return { sp, set }
}
```

- [ ] **Step 2: ViewToggle**

```tsx
'use client'
import { useUrlState } from './_useUrlState'

export function ViewToggle({ view }: { view: 'kanban' | 'table' }) {
  const { set } = useUrlState()
  return (
    <div className="inline-flex rounded-md border border-[#E5E7EB] overflow-hidden">
      {(['kanban', 'table'] as const).map((v) => (
        <button key={v}
          onClick={() => set({ view: v })}
          className={`px-3 py-1.5 text-sm ${view === v ? 'bg-[#059669] text-white' : 'bg-white text-[#374151]'}`}>
          {v === 'kanban' ? 'Kanban' : 'Table'}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Toolbar**

```tsx
'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useUrlState } from './_useUrlState'
import { LeadDrawer } from './LeadDrawer'
import type { LeadsQuery } from '../_lib/schemas'

type Stage = { id: string; name: string }
type FieldDef = { id: string; key: string; label: string; type: string; options: string[] | null }

export function Toolbar({
  params, stages, fieldDefs,
}: { params: LeadsQuery; stages: Stage[]; fieldDefs: FieldDef[] }) {
  const { set } = useUrlState()
  const [q, setQ] = useState(params.q ?? '')
  const [openAdd, setOpenAdd] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => set({ q: q || undefined }), 300)
    return () => clearTimeout(t)
  }, [q, set])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Search name, email, phone, company"
        className="border border-[#E5E7EB] rounded-md px-3 py-1.5 text-sm w-72"
      />
      <input type="date" value={params.from ?? ''}
        onChange={(e) => set({ from: e.target.value || undefined })}
        className="border rounded-md px-2 py-1.5 text-sm" />
      <span className="text-sm text-[#6B7280]">to</span>
      <input type="date" value={params.to ?? ''}
        onChange={(e) => set({ to: e.target.value || undefined })}
        className="border rounded-md px-2 py-1.5 text-sm" />
      <select value={params.sort}
        onChange={(e) => set({ sort: e.target.value })}
        className="border rounded-md px-2 py-1.5 text-sm">
        <option value="recent">Recent</option>
        <option value="oldest">Oldest</option>
        <option value="name_asc">Name A–Z</option>
        <option value="value_desc">Value high–low</option>
      </select>
      <div className="ml-auto flex items-center gap-2">
        <Link href="/dashboard/leads/stages"
          className="px-3 py-1.5 text-sm border rounded-md">Manage stages</Link>
        <Link href="/dashboard/leads/fields"
          className="px-3 py-1.5 text-sm border rounded-md">Custom fields</Link>
        <button onClick={() => setOpenAdd(true)}
          className="px-3 py-1.5 text-sm bg-[#059669] text-white rounded-md">
          Add Lead
        </button>
      </div>
      {openAdd && (
        <LeadDrawer
          mode="create"
          stages={stages}
          fieldDefs={fieldDefs}
          onClose={() => setOpenAdd(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/dashboard/leads/_components/ViewToggle.tsx src/app/(app)/dashboard/leads/_components/Toolbar.tsx src/app/(app)/dashboard/leads/_components/_useUrlState.ts
git commit -m "feat(leads): add ViewToggle and Toolbar with URL state"
```

---

## Task 12: LeadDrawer (create/edit)

**Files:**
- Create: `src/app/(app)/dashboard/leads/_components/LeadDrawer.tsx`

- [ ] **Step 1: Component**

```tsx
'use client'
import { useState, useTransition } from 'react'
import { createLead, updateLead } from '../actions/leads'

type Stage = { id: string; name: string }
type FieldDef = { id: string; key: string; label: string; type: string; options: string[] | null }
type Lead = {
  id: string; stage_id: string; name: string; email: string | null;
  phone: string | null; company: string | null; job_title: string | null;
  source: string | null; estimated_value: number | null; notes: string | null;
  custom_fields: Record<string, unknown>;
}

export function LeadDrawer({
  mode, lead, stages, fieldDefs, onClose,
}: {
  mode: 'create' | 'edit'
  lead?: Lead
  stages: Stage[]
  fieldDefs: FieldDef[]
  onClose: () => void
}) {
  const [pending, start] = useTransition()
  const [form, setForm] = useState<Lead>(lead ?? {
    id: '',
    stage_id: stages[0]?.id ?? '',
    name: '', email: '', phone: '', company: '', job_title: '',
    source: '', estimated_value: null, notes: '', custom_fields: {},
  })

  const set = <K extends keyof Lead>(k: K, v: Lead[K]) =>
    setForm((f) => ({ ...f, [k]: v }))
  const setCF = (key: string, v: unknown) =>
    setForm((f) => ({ ...f, custom_fields: { ...f.custom_fields, [key]: v } }))

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    start(async () => {
      const payload = {
        stage_id: form.stage_id,
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        company: form.company || null,
        job_title: form.job_title || null,
        source: form.source || null,
        estimated_value: form.estimated_value === null || form.estimated_value === undefined
          ? null : Number(form.estimated_value),
        notes: form.notes || null,
        custom_fields: form.custom_fields,
      }
      if (mode === 'create') await createLead(payload)
      else await updateLead(form.id, payload)
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex justify-end" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="w-[420px] h-full bg-white p-5 overflow-y-auto space-y-3"
      >
        <h2 className="text-lg font-semibold">
          {mode === 'create' ? 'Add Lead' : 'Edit Lead'}
        </h2>

        <Field label="Stage">
          <select value={form.stage_id} onChange={(e) => set('stage_id', e.target.value)}
            className="w-full border rounded-md px-2 py-1.5 text-sm">
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Name *"><Input value={form.name} onChange={(v) => set('name', v)} required /></Field>
        <Field label="Email"><Input value={form.email ?? ''} onChange={(v) => set('email', v)} type="email" /></Field>
        <Field label="Phone"><Input value={form.phone ?? ''} onChange={(v) => set('phone', v)} /></Field>
        <Field label="Company"><Input value={form.company ?? ''} onChange={(v) => set('company', v)} /></Field>
        <Field label="Job title"><Input value={form.job_title ?? ''} onChange={(v) => set('job_title', v)} /></Field>
        <Field label="Source"><Input value={form.source ?? ''} onChange={(v) => set('source', v)} /></Field>
        <Field label="Estimated value">
          <Input
            type="number"
            value={form.estimated_value === null ? '' : String(form.estimated_value)}
            onChange={(v) => set('estimated_value', v === '' ? null : Number(v))}
          />
        </Field>
        <Field label="Notes">
          <textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)}
            className="w-full border rounded-md px-2 py-1.5 text-sm h-24" />
        </Field>

        {fieldDefs.length > 0 && (
          <div className="border-t pt-3 space-y-3">
            <div className="text-xs font-semibold text-[#6B7280] uppercase">Custom fields</div>
            {fieldDefs.map((fd) => (
              <Field key={fd.id} label={fd.label}>
                {fd.type === 'select' && fd.options ? (
                  <select
                    value={String(form.custom_fields[fd.key] ?? '')}
                    onChange={(e) => setCF(fd.key, e.target.value)}
                    className="w-full border rounded-md px-2 py-1.5 text-sm"
                  >
                    <option value="">—</option>
                    {fd.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <Input
                    type={fd.type === 'number' ? 'number' : fd.type === 'date' ? 'date' : 'text'}
                    value={String(form.custom_fields[fd.key] ?? '')}
                    onChange={(v) => setCF(fd.key, fd.type === 'number' ? Number(v) : v)}
                  />
                )}
              </Field>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border rounded-md">Cancel</button>
          <button type="submit" disabled={pending}
            className="px-3 py-1.5 text-sm bg-[#059669] text-white rounded-md disabled:opacity-50">
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-[#374151] mb-1">{label}</div>
      {children}
    </label>
  )
}

function Input({
  value, onChange, type = 'text', required,
}: { value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <input
      type={type} value={value} required={required}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border rounded-md px-2 py-1.5 text-sm"
    />
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/dashboard/leads/_components/LeadDrawer.tsx
git commit -m "feat(leads): add LeadDrawer with core + custom fields"
```

---

## Task 13: LeadsTable + BulkActionBar

**Files:**
- Create: `src/app/(app)/dashboard/leads/_components/LeadsTable.tsx`
- Create: `src/app/(app)/dashboard/leads/_components/BulkActionBar.tsx`

- [ ] **Step 1: Server-side rows wrapper (server component)**

```tsx
// LeadsTable.tsx — server component that fetches + renders client table
import { createClient } from '@/lib/supabase/server'
import { fetchLeadsPage, type LeadRow } from '../_lib/queries'
import type { LeadsQuery } from '../_lib/schemas'
import { LeadsTableClient } from './LeadsTable.client'
import { Pagination } from './Pagination'

type Stage = { id: string; name: string }
type FieldDef = { id: string; key: string; label: string; type: string; options: string[] | null }

export async function LeadsTable({
  userId, stages, fieldDefs, params,
}: { userId: string; stages: Stage[]; fieldDefs: FieldDef[]; params: LeadsQuery }) {
  const supabase = await createClient()
  const stageId = params.stage
  const { rows, total } = await fetchLeadsPage(supabase, userId, params, stageId)

  return (
    <div className="space-y-3">
      <StageTabs stages={stages} active={stageId} />
      <LeadsTableClient rows={rows} stages={stages} fieldDefs={fieldDefs} />
      <Pagination
        total={total} page={params.page}
        makeHref={(p) => buildHref(params, p)}
      />
    </div>
  )
}

function StageTabs({ stages, active }: { stages: Stage[]; active?: string }) {
  return (
    <div className="flex gap-1 flex-wrap">
      <TabLink label="All" stageId={undefined} active={!active} />
      {stages.map((s) => (
        <TabLink key={s.id} label={s.name} stageId={s.id} active={active === s.id} />
      ))}
    </div>
  )
}
function TabLink({ label, stageId, active }: { label: string; stageId?: string; active: boolean }) {
  const url = new URLSearchParams()
  url.set('view', 'table')
  if (stageId) url.set('stage', stageId)
  return (
    <a href={`/dashboard/leads?${url.toString()}`}
       className={`px-3 py-1.5 text-sm rounded-md border ${active ? 'bg-emerald-50 border-emerald-600 text-emerald-700' : 'bg-white'}`}>
      {label}
    </a>
  )
}

function buildHref(params: LeadsQuery, page: number) {
  const u = new URLSearchParams()
  u.set('view', 'table')
  if (params.stage) u.set('stage', params.stage)
  if (params.q) u.set('q', params.q)
  if (params.from) u.set('from', params.from)
  if (params.to) u.set('to', params.to)
  u.set('sort', params.sort)
  u.set('page', String(page))
  return `/dashboard/leads?${u.toString()}`
}
```

- [ ] **Step 2: Client table**

```tsx
// LeadsTable.client.tsx
'use client'
import { useState } from 'react'
import { LeadDrawer } from './LeadDrawer'
import { BulkActionBar } from './BulkActionBar'
import type { LeadRow } from '../_lib/queries'

type Stage = { id: string; name: string }
type FieldDef = { id: string; key: string; label: string; type: string; options: string[] | null }

export function LeadsTableClient({
  rows, stages, fieldDefs,
}: { rows: LeadRow[]; stages: Stage[]; fieldDefs: FieldDef[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<LeadRow | null>(null)

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
    })
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggleAll = () =>
    setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))

  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? '—'

  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[#F9FAFB] text-[#6B7280]">
          <tr>
            <th className="w-10 p-2"><input type="checkbox" checked={allChecked} onChange={toggleAll} /></th>
            <th className="text-left p-2">Name</th>
            <th className="text-left p-2">Email</th>
            <th className="text-left p-2">Company</th>
            <th className="text-left p-2">Stage</th>
            <th className="text-left p-2">Value</th>
            <th className="text-left p-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={7} className="p-6 text-center text-[#6B7280]">No leads.</td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.id} className="border-t hover:bg-[#F9FAFB] cursor-pointer"
                onClick={() => setEditing(r)}>
              <td className="p-2" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
              </td>
              <td className="p-2 font-medium">{r.name}</td>
              <td className="p-2">{r.email ?? '—'}</td>
              <td className="p-2">{r.company ?? '—'}</td>
              <td className="p-2">{stageName(r.stage_id)}</td>
              <td className="p-2">{r.estimated_value ?? '—'}</td>
              <td className="p-2">{new Date(r.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected.size > 0 && (
        <BulkActionBar
          ids={Array.from(selected)}
          stages={stages}
          fieldDefs={fieldDefs}
          onDone={() => setSelected(new Set())}
        />
      )}

      {editing && (
        <LeadDrawer
          mode="edit"
          lead={editing}
          stages={stages}
          fieldDefs={fieldDefs}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: BulkActionBar**

```tsx
'use client'
import { useState, useTransition } from 'react'
import { bulkDeleteLeads, bulkMoveLeads, bulkUpdateLeads } from '../actions/leads'

type Stage = { id: string; name: string }
type FieldDef = { id: string; key: string; label: string; type: string; options: string[] | null }

export function BulkActionBar({
  ids, stages, fieldDefs, onDone,
}: { ids: string[]; stages: Stage[]; fieldDefs: FieldDef[]; onDone: () => void }) {
  const [pending, start] = useTransition()
  const [editOpen, setEditOpen] = useState(false)

  const onMove = (toStageId: string) =>
    start(async () => { await bulkMoveLeads(ids, toStageId); onDone() })

  const onDelete = () => {
    if (!confirm(`Delete ${ids.length} lead(s)?`)) return
    start(async () => { await bulkDeleteLeads(ids); onDone() })
  }

  return (
    <div className="sticky bottom-0 bg-white border-t p-3 flex items-center gap-2">
      <span className="text-sm text-[#374151]">{ids.length} selected</span>
      <select onChange={(e) => e.target.value && onMove(e.target.value)}
        defaultValue=""
        className="border rounded-md px-2 py-1.5 text-sm">
        <option value="" disabled>Move to stage…</option>
        {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <button onClick={() => setEditOpen(true)}
        className="px-3 py-1.5 text-sm border rounded-md">Edit selected</button>
      <button onClick={onDelete} disabled={pending}
        className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md disabled:opacity-50">
        Delete
      </button>

      {editOpen && (
        <BulkEditModal
          ids={ids} fieldDefs={fieldDefs}
          onClose={() => setEditOpen(false)}
          onDone={() => { setEditOpen(false); onDone() }}
        />
      )}
    </div>
  )
}

function BulkEditModal({
  ids, fieldDefs, onClose, onDone,
}: {
  ids: string[]; fieldDefs: FieldDef[]; onClose: () => void; onDone: () => void
}) {
  const [pending, start] = useTransition()
  const [patch, setPatch] = useState<Record<string, unknown>>({})
  const set = (k: string, v: unknown) => setPatch((p) => ({ ...p, [k]: v }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    start(async () => {
      const cf: Record<string, unknown> = {}
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(patch)) {
        if (k.startsWith('cf:')) cf[k.slice(3)] = v
        else if (v !== '' && v !== undefined) out[k] = v
      }
      if (Object.keys(cf).length) out.custom_fields = cf
      await bulkUpdateLeads(ids, out)
      onDone()
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit}
        className="bg-white rounded-md p-5 w-[420px] space-y-3">
        <h3 className="font-semibold">Edit {ids.length} leads — only fields you fill are applied</h3>
        <Row label="Company"><input className="border rounded px-2 py-1 text-sm w-full"
          onChange={(e) => set('company', e.target.value)} /></Row>
        <Row label="Source"><input className="border rounded px-2 py-1 text-sm w-full"
          onChange={(e) => set('source', e.target.value)} /></Row>
        <Row label="Estimated value"><input type="number" className="border rounded px-2 py-1 text-sm w-full"
          onChange={(e) => set('estimated_value', e.target.value === '' ? '' : Number(e.target.value))} /></Row>
        {fieldDefs.map((fd) => (
          <Row key={fd.id} label={fd.label}>
            <input className="border rounded px-2 py-1 text-sm w-full"
              type={fd.type === 'number' ? 'number' : fd.type === 'date' ? 'date' : 'text'}
              onChange={(e) => set(`cf:${fd.key}`,
                fd.type === 'number' ? Number(e.target.value) : e.target.value)} />
          </Row>
        ))}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border rounded-md">Cancel</button>
          <button disabled={pending} type="submit"
            className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-md">Apply</button>
        </div>
      </form>
    </div>
  )
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs text-[#374151] mb-1">{label}</div>{children}
    </label>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/dashboard/leads/_components/LeadsTable.tsx src/app/(app)/dashboard/leads/_components/LeadsTable.client.tsx src/app/(app)/dashboard/leads/_components/BulkActionBar.tsx
git commit -m "feat(leads): add table view with bulk select and bulk actions"
```

---

## Task 14: KanbanBoard + StageColumn + LeadCard with DnD

**Files:**
- Create: `src/app/(app)/dashboard/leads/_components/KanbanBoard.tsx`
- Create: `src/app/(app)/dashboard/leads/_components/KanbanBoard.client.tsx`
- Create: `src/app/(app)/dashboard/leads/_components/StageColumn.tsx`
- Create: `src/app/(app)/dashboard/leads/_components/LeadCard.tsx`

- [ ] **Step 1: Server wrapper that fetches all stages' leads (paginated per stage)**

```tsx
// KanbanBoard.tsx
import { createClient } from '@/lib/supabase/server'
import { fetchLeadsPage } from '../_lib/queries'
import type { LeadsQuery } from '../_lib/schemas'
import { KanbanBoardClient } from './KanbanBoard.client'

type Stage = { id: string; name: string; description: string | null }
type FieldDef = { id: string; key: string; label: string; type: string; options: string[] | null }

export async function KanbanBoard({
  userId, stages, fieldDefs, params,
}: { userId: string; stages: Stage[]; fieldDefs: FieldDef[]; params: LeadsQuery }) {
  const supabase = await createClient()
  const columns = await Promise.all(
    stages.map(async (s) => {
      const { rows, total } = await fetchLeadsPage(supabase, userId, params, s.id)
      return { stage: s, leads: rows, total }
    }),
  )
  return <KanbanBoardClient columns={columns} stages={stages} fieldDefs={fieldDefs} params={params} />
}
```

- [ ] **Step 2: Client board with DnD**

```tsx
// KanbanBoard.client.tsx
'use client'
import { useOptimistic, startTransition } from 'react'
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { moveLead } from '../actions/leads'
import { StageColumn } from './StageColumn'
import type { LeadRow } from '../_lib/queries'
import type { LeadsQuery } from '../_lib/schemas'

type Stage = { id: string; name: string; description: string | null }
type FieldDef = { id: string; key: string; label: string; type: string; options: string[] | null }
type Column = { stage: Stage; leads: LeadRow[]; total: number }

export function KanbanBoardClient({
  columns, stages, fieldDefs, params,
}: { columns: Column[]; stages: Stage[]; fieldDefs: FieldDef[]; params: LeadsQuery }) {
  const [optimistic, setOptimistic] = useOptimistic(
    columns,
    (state, action: { id: string; toStageId: string; toIndex: number }) => {
      const next = state.map((c) => ({ ...c, leads: [...c.leads] }))
      let moved: LeadRow | undefined
      for (const c of next) {
        const i = c.leads.findIndex((l) => l.id === action.id)
        if (i >= 0) { moved = c.leads.splice(i, 1)[0]; break }
      }
      if (!moved) return state
      const target = next.find((c) => c.stage.id === action.toStageId)
      if (!target) return state
      target.leads.splice(action.toIndex, 0, { ...moved, stage_id: action.toStageId })
      return next
    },
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    const overId   = String(over.id)

    // over can be a stage id (empty column) or a lead id
    let toStageId: string | undefined
    let toIndex = 0
    const overCol = optimistic.find((c) => c.stage.id === overId)
    if (overCol) {
      toStageId = overCol.stage.id
      toIndex   = overCol.leads.length
    } else {
      for (const c of optimistic) {
        const i = c.leads.findIndex((l) => l.id === overId)
        if (i >= 0) { toStageId = c.stage.id; toIndex = i; break }
      }
    }
    if (!toStageId) return

    startTransition(async () => {
      setOptimistic({ id: activeId, toStageId: toStageId!, toIndex })
      await moveLead(activeId, toStageId!, toIndex)
    })
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-3">
        {optimistic.map((c) => (
          <SortableContext key={c.stage.id}
            items={c.leads.map((l) => l.id)}
            strategy={verticalListSortingStrategy}>
            <StageColumn
              stage={c.stage}
              leads={c.leads}
              total={c.total}
              page={params.page}
              params={params}
              stages={stages}
              fieldDefs={fieldDefs}
            />
          </SortableContext>
        ))}
      </div>
    </DndContext>
  )
}
```

- [ ] **Step 3: StageColumn**

```tsx
// StageColumn.tsx
'use client'
import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { LeadCard } from './LeadCard'
import { LeadDrawer } from './LeadDrawer'
import { Pagination } from './Pagination'
import type { LeadRow } from '../_lib/queries'
import type { LeadsQuery } from '../_lib/schemas'

type Stage = { id: string; name: string; description: string | null }
type FieldDef = { id: string; key: string; label: string; type: string; options: string[] | null }

export function StageColumn({
  stage, leads, total, page, params, stages, fieldDefs,
}: {
  stage: Stage; leads: LeadRow[]; total: number; page: number;
  params: LeadsQuery; stages: Stage[]; fieldDefs: FieldDef[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const [openAdd, setOpenAdd] = useState(false)
  const [editing, setEditing] = useState<LeadRow | null>(null)

  return (
    <div ref={setNodeRef}
      className={`w-72 shrink-0 bg-[#F9FAFB] rounded-md p-2 ${isOver ? 'ring-2 ring-emerald-500' : ''}`}>
      <div className="flex items-center justify-between px-1 py-1">
        <div>
          <div className="text-sm font-semibold text-[#111827]">{stage.name}</div>
          <div className="text-xs text-[#6B7280]">{total}</div>
        </div>
        <button onClick={() => setOpenAdd(true)}
          className="text-emerald-600 text-sm">+ Add</button>
      </div>
      <div className="space-y-2 min-h-[40px]">
        {leads.map((l) => (
          <LeadCard key={l.id} lead={l} onClick={() => setEditing(l)} />
        ))}
      </div>
      <div className="pt-2">
        <Pagination total={total} page={page}
          makeHref={(p) => buildHref(params, stage.id, p)} />
      </div>

      {openAdd && (
        <LeadDrawer mode="create" stages={stages} fieldDefs={fieldDefs}
          onClose={() => setOpenAdd(false)} />
      )}
      {editing && (
        <LeadDrawer mode="edit" lead={editing} stages={stages} fieldDefs={fieldDefs}
          onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function buildHref(params: LeadsQuery, _stageId: string, page: number) {
  const u = new URLSearchParams()
  u.set('view', 'kanban')
  if (params.q) u.set('q', params.q)
  if (params.from) u.set('from', params.from)
  if (params.to) u.set('to', params.to)
  u.set('sort', params.sort)
  u.set('page', String(page))
  return `/dashboard/leads?${u.toString()}`
}
```

- [ ] **Step 4: LeadCard**

```tsx
// LeadCard.tsx
'use client'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { LeadRow } from '../_lib/queries'

export function LeadCard({ lead, onClick }: { lead: LeadRow; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lead.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef} style={style}
      className="bg-white border rounded-md p-2 cursor-grab"
      onClick={onClick}
      {...attributes} {...listeners}
    >
      <div className="text-sm font-medium text-[#111827]">{lead.name}</div>
      {lead.company && <div className="text-xs text-[#6B7280]">{lead.company}</div>}
      {lead.estimated_value !== null && (
        <div className="text-xs text-emerald-700 mt-1">${lead.estimated_value}</div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Add `@dnd-kit/utilities`**

Run: `npm install @dnd-kit/utilities`

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/dashboard/leads/_components/KanbanBoard.tsx src/app/(app)/dashboard/leads/_components/KanbanBoard.client.tsx src/app/(app)/dashboard/leads/_components/StageColumn.tsx src/app/(app)/dashboard/leads/_components/LeadCard.tsx package.json package-lock.json
git commit -m "feat(leads): add Kanban board with drag-and-drop and pagination"
```

---

## Task 15: Stage management page

**Files:**
- Create: `src/app/(app)/dashboard/leads/stages/page.tsx`
- Create: `src/app/(app)/dashboard/leads/_components/StageManager.tsx`

- [ ] **Step 1: Page**

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { fetchStages } from '../_lib/queries'
import { seedDefaultStagesIfEmpty } from '../_lib/seed'
import { StageManager } from '../_components/StageManager'

export default async function StagesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  await seedDefaultStagesIfEmpty(supabase, user.id)
  const stages = await fetchStages(supabase, user.id)
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Pipeline stages</h1>
      <StageManager stages={stages} />
    </div>
  )
}
```

- [ ] **Step 2: StageManager (no DnD reorder in MVP — explicit up/down buttons)**

```tsx
'use client'
import { useState, useTransition } from 'react'
import { createStage, updateStage, deleteStage, reorderStages } from '../actions/stages'

type Stage = { id: string; name: string; description: string | null; position: number; is_default: boolean }

export function StageManager({ stages }: { stages: Stage[] }) {
  const [pending, start] = useTransition()
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    start(async () => {
      await createStage({ name, description: desc || null })
      setName(''); setDesc('')
    })
  }

  const move = (idx: number, dir: -1 | 1) => {
    const newOrder = stages.map((s) => s.id)
    const j = idx + dir
    if (j < 0 || j >= newOrder.length) return
    ;[newOrder[idx], newOrder[j]] = [newOrder[j], newOrder[idx]]
    start(async () => { await reorderStages(newOrder) })
  }

  const remove = (s: Stage) => {
    if (s.is_default) return alert('Cannot delete the default stage.')
    if (!confirm(`Delete "${s.name}"? Its leads will move to the default stage.`)) return
    start(async () => { await deleteStage(s.id) })
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex items-end gap-2 border p-3 rounded-md">
        <label className="flex-1">
          <div className="text-xs">Name</div>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm" />
        </label>
        <label className="flex-1">
          <div className="text-xs">Description</div>
          <input value={desc} onChange={(e) => setDesc(e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm" />
        </label>
        <button disabled={pending} className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-md">
          Add stage
        </button>
      </form>

      <ul className="border rounded-md divide-y">
        {stages.map((s, i) => (
          <StageRow key={s.id} stage={s} index={i} count={stages.length}
            onMove={move} onDelete={remove} pending={pending} />
        ))}
      </ul>
    </div>
  )
}

function StageRow({
  stage, index, count, onMove, onDelete, pending,
}: {
  stage: Stage; index: number; count: number;
  onMove: (i: number, d: -1 | 1) => void; onDelete: (s: Stage) => void; pending: boolean;
}) {
  const [edit, setEdit] = useState(false)
  const [name, setName] = useState(stage.name)
  const [desc, setDesc] = useState(stage.description ?? '')
  const [, start] = useTransition()

  const save = () => start(async () => {
    await updateStage(stage.id, { name, description: desc || null })
    setEdit(false)
  })

  return (
    <li className="p-3 flex items-center gap-3">
      <div className="flex flex-col">
        <button disabled={index === 0 || pending} onClick={() => onMove(index, -1)} className="text-xs">▲</button>
        <button disabled={index === count - 1 || pending} onClick={() => onMove(index, 1)} className="text-xs">▼</button>
      </div>
      {edit ? (
        <>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="border rounded px-2 py-1 text-sm" />
          <input value={desc} onChange={(e) => setDesc(e.target.value)}
            className="flex-1 border rounded px-2 py-1 text-sm" />
          <button onClick={save} className="px-2 py-1 text-sm bg-emerald-600 text-white rounded">Save</button>
          <button onClick={() => setEdit(false)} className="px-2 py-1 text-sm border rounded">Cancel</button>
        </>
      ) : (
        <>
          <div className="flex-1">
            <div className="text-sm font-medium">{stage.name} {stage.is_default && <span className="text-xs text-emerald-700">(default)</span>}</div>
            <div className="text-xs text-[#6B7280]">{stage.description}</div>
          </div>
          <button onClick={() => setEdit(true)} className="px-2 py-1 text-sm border rounded">Edit</button>
          <button disabled={stage.is_default} onClick={() => onDelete(stage)}
            className="px-2 py-1 text-sm border border-red-300 text-red-700 rounded disabled:opacity-50">
            Delete
          </button>
        </>
      )}
    </li>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/dashboard/leads/stages/page.tsx src/app/(app)/dashboard/leads/_components/StageManager.tsx
git commit -m "feat(leads): add stage management page"
```

---

## Task 16: Custom fields management page

**Files:**
- Create: `src/app/(app)/dashboard/leads/fields/page.tsx`
- Create: `src/app/(app)/dashboard/leads/_components/FieldDefManager.tsx`

- [ ] **Step 1: Page**

```tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { fetchFieldDefs } from '../_lib/queries'
import { FieldDefManager } from '../_components/FieldDefManager'

export default async function FieldsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const defs = await fetchFieldDefs(supabase, user.id)
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Custom lead fields</h1>
      <FieldDefManager defs={defs} />
    </div>
  )
}
```

- [ ] **Step 2: Manager**

```tsx
'use client'
import { useState, useTransition } from 'react'
import { createFieldDef, updateFieldDef, deleteFieldDef } from '../actions/fields'

type Def = { id: string; key: string; label: string; type: string; options: string[] | null }

export function FieldDefManager({ defs }: { defs: Def[] }) {
  const [pending, start] = useTransition()
  const [form, setForm] = useState({ key: '', label: '', type: 'text', options: '' })

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    start(async () => {
      await createFieldDef({
        key: form.key,
        label: form.label,
        type: form.type as 'text' | 'number' | 'date' | 'select',
        options: form.type === 'select'
          ? form.options.split(',').map((s) => s.trim()).filter(Boolean)
          : null,
      })
      setForm({ key: '', label: '', type: 'text', options: '' })
    })
  }

  const remove = (d: Def) => {
    if (!confirm(`Delete field "${d.label}"? Existing values for this key will be removed.`)) return
    start(async () => { await deleteFieldDef(d.id) })
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="border p-3 rounded-md grid grid-cols-4 gap-2 items-end">
        <Field label="Key (slug)"><input value={form.key}
          onChange={(e) => setForm({ ...form, key: e.target.value })}
          className="border rounded px-2 py-1 text-sm w-full" placeholder="industry" /></Field>
        <Field label="Label"><input value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          className="border rounded px-2 py-1 text-sm w-full" /></Field>
        <Field label="Type">
          <select value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="border rounded px-2 py-1 text-sm w-full">
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="select">Select</option>
          </select>
        </Field>
        {form.type === 'select' && (
          <Field label="Options (comma sep)"><input value={form.options}
            onChange={(e) => setForm({ ...form, options: e.target.value })}
            className="border rounded px-2 py-1 text-sm w-full" /></Field>
        )}
        <button disabled={pending}
          className="col-span-4 justify-self-end px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-md">
          Add field
        </button>
      </form>

      <ul className="border rounded-md divide-y">
        {defs.length === 0 && <li className="p-3 text-sm text-[#6B7280]">No custom fields yet.</li>}
        {defs.map((d) => (
          <li key={d.id} className="p-3 flex items-center gap-3">
            <div className="flex-1">
              <div className="text-sm font-medium">{d.label}
                <span className="text-xs text-[#6B7280] ml-2">({d.type}, key: {d.key})</span>
              </div>
              {d.options && <div className="text-xs">Options: {d.options.join(', ')}</div>}
            </div>
            <button onClick={() => remove(d)}
              className="px-2 py-1 text-sm border border-red-300 text-red-700 rounded">Delete</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs mb-1">{label}</div>{children}
    </label>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/dashboard/leads/fields/page.tsx src/app/(app)/dashboard/leads/_components/FieldDefManager.tsx
git commit -m "feat(leads): add custom fields management page"
```

---

## Task 17: Tests — schemas + query helpers

**Files:**
- Create: `src/app/(app)/dashboard/leads/_lib/schemas.test.ts`
- Create: `src/app/(app)/dashboard/leads/_lib/queries.test.ts`

- [ ] **Step 1: schemas.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { LeadInput, StageInput, FieldDefInput, LeadsQuery } from './schemas'

describe('schemas', () => {
  it('accepts a minimal lead', () => {
    const r = LeadInput.parse({ stage_id: '00000000-0000-0000-0000-000000000000', name: 'Jane' })
    expect(r.name).toBe('Jane')
  })
  it('rejects empty lead name', () => {
    expect(() => LeadInput.parse({ stage_id: '00000000-0000-0000-0000-000000000000', name: '' })).toThrow()
  })
  it('rejects bad field def key', () => {
    expect(() => FieldDefInput.parse({ key: 'Bad-Key', label: 'x', type: 'text' })).toThrow()
  })
  it('parses leads query defaults', () => {
    const q = LeadsQuery.parse({})
    expect(q.view).toBe('kanban'); expect(q.page).toBe(1); expect(q.sort).toBe('recent')
  })
  it('rejects bad date', () => {
    expect(() => LeadsQuery.parse({ from: '2025/01/01' })).toThrow()
  })
  it('stage name length bound', () => {
    expect(() => StageInput.parse({ name: '' })).toThrow()
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npm test -- src/app/(app)/dashboard/leads/_lib/schemas.test.ts`
Expected: all pass.

- [ ] **Step 3: queries.test.ts (mock supabase)**

```ts
import { describe, it, expect, vi } from 'vitest'
import { fetchLeadsPage } from './queries'

function mockClient(rows: unknown[], count: number) {
  const chain: any = {}
  const builder = (): any => ({
    select: vi.fn(() => builder()),
    eq:     vi.fn(() => builder()),
    or:     vi.fn(() => builder()),
    gte:    vi.fn(() => builder()),
    lte:    vi.fn(() => builder()),
    order:  vi.fn(() => builder()),
    range:  vi.fn(async () => ({ data: rows, count, error: null })),
  })
  chain.from = vi.fn(() => builder())
  return chain
}

describe('fetchLeadsPage', () => {
  it('returns rows and total', async () => {
    const c = mockClient([{ id: '1' }], 1) as any
    const r = await fetchLeadsPage(c, 'u', {
      view: 'kanban', page: 1, sort: 'recent',
    } as any)
    expect(r.total).toBe(1)
    expect(r.rows).toHaveLength(1)
  })
})
```

- [ ] **Step 4: Run + commit**

Run: `npm test`
Expected: all pass.

```bash
git add src/app/(app)/dashboard/leads/_lib/schemas.test.ts src/app/(app)/dashboard/leads/_lib/queries.test.ts
git commit -m "test(leads): add unit tests for schemas and query helpers"
```

---

## Task 18: Manual smoke test + docs

**Files:** none (manual)

- [ ] **Step 1: Run dev**

Run: `npm run dev`

- [ ] **Step 2: Smoke checklist (sign in as a test user)**

Verify each:
- Sidebar shows **Leads** and links to `/dashboard/leads`.
- Default 7 stages appear in Kanban order.
- Add a lead via "Add Lead" — appears in chosen stage.
- Search by name — filters update via URL.
- Date range filter — filters by created date.
- Sort dropdown changes order.
- Drag a card from one column to another — persists on reload.
- Switch to Table view; select 2 leads; bulk delete; bulk move to a stage.
- Bulk Edit: set Company on selected — applies only that field.
- Stages page: add a new stage, edit, reorder, delete (non-default) — leads move to default.
- Custom fields page: add a select field; edit a lead and set the field; verify it persists.

- [ ] **Step 3: Commit any tweaks discovered**

```bash
git add -A
git commit -m "chore(leads): smoke-test fixes" || echo "nothing to commit"
```

---

## Self-Review Notes

**Spec coverage:**
- Sidebar entry → Task 3 ✓
- Pre-templated pipeline + custom stages + descriptions → Tasks 1, 5, 6, 15 ✓
- Delete stage (with reassignment) → Task 6 (`deleteStage`) ✓
- Pagination per stage column and table → Tasks 9, 10, 13, 14 ✓
- Search by lead details → Tasks 9, 11 ✓
- Bulk delete / bulk edit → Task 13 ✓
- Edit lead details → Task 12 (LeadDrawer) ✓
- Date-range calendar filter → Task 11 ✓
- Manual lead input → Tasks 11, 12, 14 (per-column add) ✓
- Drag-and-drop between stages → Task 14 ✓
- Bulk transfer between stages → Task 13 (`bulkMoveLeads`) ✓
- Sorting → Tasks 9, 11 ✓
- Custom fields → Tasks 1, 8, 12, 16 ✓

**Notes:**
- `deleteFieldDef` includes a JS fallback if no SQL RPC exists — safe default.
- DnD position math is gap-based (uses target index as new `position`); simple but adequate for MVP. Future improvement: fractional indexing.
- Bulk select scoped to table view per spec (5d=a).
