# Template Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add purpose-based categories (Booking, Offers, Reminders, Support, Notifications, General + user-defined) to messenger templates with multi-tag support, surfaced as filters on the templates dashboard, agent shared-template picker, and booking follow-ups generator.

**Architecture:** Two new tables — `template_categories` (catalog: system rows have `user_id is null`, user rows are scoped) and `messenger_template_categories` (M:N join). System catalog is seeded once; the 28 default templates get pre-tagged in the same migration; `seed_default_message_templates` is extended so new users also get tags. Server actions in the existing templates `actions.ts` handle category CRUD and tag assignment. Three UI surfaces gain a category chip-row.

**Tech Stack:** Next.js 16 App Router server components + server actions, Supabase Postgres with RLS, React 19 client components.

**Spec:** `docs/superpowers/specs/2026-05-10-template-categories-design.md`

---

## File Structure

**New:**
- `supabase/migrations/20260510000000_template_categories.sql` — both tables, RLS, system seed, backfill, updated seeder function

**Modified:**
- `src/lib/messenger-templates/types.ts` — `TemplateCategory`, `TemplateWithCategories`
- `src/app/(app)/dashboard/templates/actions.ts` — `listCategories`, `createCategory`, `deleteCategory`, `setTemplateCategories`; `loadTemplates` returns embedded categories
- `src/app/(app)/dashboard/templates/page.tsx` — load categories, pass to client
- `src/app/(app)/dashboard/templates/_components/TemplatesClient.tsx` — filter chips, editor field, create/delete UI
- `src/app/(app)/dashboard/agent/page.tsx` — load categories per template, pass to client
- `src/app/(app)/dashboard/agent/_components/AgentClient.tsx` — category filter chip-row above template dropdown
- `src/app/(app)/dashboard/action-pages/_kinds/booking/followups-actions.ts` — return categories per template
- `src/app/(app)/dashboard/action-pages/_kinds/booking/FollowupTouchpointsEditor.tsx` — default-to-Booking category preselect

---

## Task 1: Migration — schema, RLS, seeds, backfill

**Files:**
- Create: `supabase/migrations/20260510000000_template_categories.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =========================================================================
-- Template categories: purpose-based grouping for messenger templates.
-- System rows (user_id IS NULL) are shared across all users and immutable
-- to clients. User rows are scoped to their owner.
-- =========================================================================

create table public.template_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  slug        text not null,
  label       text not null,
  is_system   boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check ((user_id is null) = is_system)
);

create unique index template_categories_system_slug_uniq
  on public.template_categories (slug)
  where user_id is null;

create unique index template_categories_user_slug_uniq
  on public.template_categories (user_id, slug)
  where user_id is not null;

create or replace function public.touch_template_categories()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger template_categories_touch
  before update on public.template_categories
  for each row execute function public.touch_template_categories();

alter table public.template_categories enable row level security;

create policy "template_categories_read"
  on public.template_categories for select
  using (user_id is null or user_id = auth.uid());

create policy "template_categories_user_write"
  on public.template_categories for insert
  with check (user_id = auth.uid() and is_system = false);

create policy "template_categories_user_update"
  on public.template_categories for update
  using (user_id = auth.uid() and is_system = false)
  with check (user_id = auth.uid() and is_system = false);

create policy "template_categories_user_delete"
  on public.template_categories for delete
  using (user_id = auth.uid() and is_system = false);

-- Join table.
create table public.messenger_template_categories (
  template_id uuid not null references public.messenger_message_templates(id) on delete cascade,
  category_id uuid not null references public.template_categories(id) on delete cascade,
  primary key (template_id, category_id)
);

create index messenger_template_categories_category_idx
  on public.messenger_template_categories (category_id);

alter table public.messenger_template_categories enable row level security;

-- Read/write gated through ownership of the parent template.
create policy "messenger_template_categories_owner_rw"
  on public.messenger_template_categories for all
  using (
    exists (
      select 1 from public.messenger_message_templates t
      where t.id = template_id and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.messenger_message_templates t
      where t.id = template_id and t.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------ system catalog
insert into public.template_categories (user_id, slug, label, is_system, sort_order) values
  (null, 'booking',       'Booking',       true, 10),
  (null, 'offers',        'Offers',        true, 20),
  (null, 'reminders',     'Reminders',     true, 30),
  (null, 'support',       'Support',       true, 40),
  (null, 'notifications', 'Notifications', true, 50),
  (null, 'general',       'General',       true, 60)
on conflict do nothing;

-- ------------------------------------------------------------------ default tag mapping
-- Map each of the 28 seeded template names to its default category slug(s).
-- Backfill applies to every existing user; the seeder function below applies
-- the same mapping for new users.
create or replace function public.apply_default_template_category_tags(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.messenger_template_categories (template_id, category_id)
  select t.id, c.id
  from public.messenger_message_templates t
  join (values
    ('booking_confirmation_buttons',  'booking'),
    ('booking_update_changes',        'booking'),
    ('booking_with_action_page',      'booking'),
    ('quick_reminder',                'reminders'),
    ('team_friendly_reminder',        'reminders'),
    ('casual_heads_up',               'reminders'),
    ('quick_heads_up_thanks',         'reminders'),
    ('support_request_update',        'support'),
    ('support_signed',                'support'),
    ('support_signed_alt',            'support'),
    ('team_message',                  'support'),
    ('order_status_update',           'notifications'),
    ('order_update_details',          'notifications'),
    ('order_notification',            'notifications'),
    ('payment_notification',          'notifications'),
    ('account_update_details',        'notifications'),
    ('account_update_reply',          'notifications'),
    ('account_activity_notice',       'notifications'),
    ('important_notice',              'notifications'),
    ('system_notification_optout',    'notifications'),
    ('notification_with_note',        'general'),
    ('in_the_loop',                   'general'),
    ('quick_update_friendly',         'general'),
    ('casual_with_reply_invite',      'general'),
    ('good_day_update',               'general'),
    ('valued_customer_update',        'general'),
    ('general_help_offer',            'general'),
    ('request_update_short',          'general')
  ) as m(name, slug) on m.name = t.name
  join public.template_categories c
    on c.slug = m.slug and c.user_id is null
  where t.user_id = p_user_id
  on conflict do nothing;
end;
$$;

revoke all   on function public.apply_default_template_category_tags(uuid) from public;
grant execute on function public.apply_default_template_category_tags(uuid) to authenticated, service_role;

-- Backfill every existing user so they immediately get default tags.
do $$
declare u record;
begin
  for u in select distinct user_id from public.messenger_message_templates loop
    perform public.apply_default_template_category_tags(u.user_id);
  end loop;
end;
$$;

-- ------------------------------------------------------------------ extend seeder
-- Re-create seed_default_message_templates so that after inserting the 28
-- defaults it also applies the default category tags. Body of the original
-- function is preserved verbatim and an extra call is appended.
create or replace function public.seed_default_message_templates(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.messenger_message_templates
    (user_id, name, display_name, body_text, variable_count, sample_values, buttons)
  values
    (p_user_id, 'booking_confirmation_buttons',
     'Booking confirmation (with buttons)',
     'Booking confirmation: {{1}}. Use the buttons below to manage your booking.',
     1, array['Your appointment on Dec 15, 2:00 PM']::text[],
     '[{"type":"postback","text":"Manage booking","payload":"manage_booking"},{"type":"postback","text":"Cancel","payload":"cancel_booking"}]'::jsonb),
    (p_user_id, 'order_status_update',
     'Order status update',
     'Your order has been updated. {{1}}. Track your order below.',
     1, array['Your order #12345 has shipped']::text[],
     '[{"type":"postback","text":"Track order","payload":"track_order"}]'::jsonb),
    (p_user_id, 'account_update_details',
     'Account update with details button',
     'Account update: {{1}}. Tap below for more details.',
     1, array['Your subscription renews on Jan 1']::text[],
     '[{"type":"postback","text":"View details","payload":"view_account"}]'::jsonb),
    (p_user_id, 'notification_with_note',
     'Notification with note',
     'Notification: {{1}}. Note: {{2}}. Reply for assistance.',
     2, array['Your appointment is tomorrow','Please arrive 10 minutes early']::text[],
     '[]'::jsonb),
    (p_user_id, 'order_update_details',
     'Order update with details',
     'Order update: {{1}}. Details: {{2}}. Contact us if you need help.',
     2, array['Your order is delayed','New delivery date is Dec 20']::text[],
     '[]'::jsonb),
    (p_user_id, 'quick_reminder',
     'Quick reminder',
     'Quick reminder — {{1}}. Talk soon!',
     1, array['your appointment is at 3 PM today']::text[],
     '[]'::jsonb),
    (p_user_id, 'casual_heads_up',
     'Casual heads-up',
     'Hey, just thought you should know: {{1}}.',
     1, array['your order arrives tomorrow']::text[],
     '[]'::jsonb),
    (p_user_id, 'in_the_loop',
     'In-the-loop update',
     '{{1}} — just keeping you in the loop!',
     1, array['Your request is being processed']::text[],
     '[]'::jsonb),
    (p_user_id, 'quick_update_friendly',
     'Quick friendly update',
     'Hi! Quick update for you — {{1}}. Hope this helps!',
     1, array['your refund has been approved']::text[],
     '[]'::jsonb),
    (p_user_id, 'quick_heads_up_thanks',
     'Quick heads up (thanks)',
     'Just a quick heads up: {{1}}. Thanks!',
     1, array['your invoice is ready']::text[],
     '[]'::jsonb),
    (p_user_id, 'general_help_offer',
     'General update with help offer',
     'Hi there! {{1}}. Let us know if there is anything else we can help with.',
     1, array['Your booking has been confirmed']::text[],
     '[]'::jsonb),
    (p_user_id, 'casual_with_reply_invite',
     'Casual update with reply invite',
     'Hey! Just wanted to let you know — {{1}}. Feel free to reply if you have any questions!',
     1, array['your appointment has been rescheduled']::text[],
     '[]'::jsonb),
    (p_user_id, 'good_day_update',
     'Good day update',
     'Good day! Here is an update for you: {{1}}. Thank you for choosing our services.',
     1, array['Your service request has been completed']::text[],
     '[]'::jsonb),
    (p_user_id, 'valued_customer_update',
     'Valued customer update',
     'Hello! We have an update for you. {{1}}. Thank you for being a valued customer.',
     1, array['Your loyalty points have been credited']::text[],
     '[]'::jsonb),
    (p_user_id, 'important_notice',
     'Important notice',
     'Important notice: {{1}}. Please review this information at your earliest convenience.',
     1, array['Your account requires verification']::text[],
     '[]'::jsonb),
    (p_user_id, 'team_message',
     'Message from team',
     'Message from our team: {{1}}.',
     1, array['Your support ticket has been resolved']::text[],
     '[]'::jsonb),
    (p_user_id, 'team_friendly_reminder',
     'Friendly team reminder',
     'Friendly reminder from our team: {{1}}.',
     1, array['your subscription expires next week']::text[],
     '[]'::jsonb),
    (p_user_id, 'system_notification_optout',
     'System notification with opt-out',
     '{{1}}. This is an automated notification from our system. Reply STOP to opt out.',
     1, array['Your weekly report is ready']::text[],
     '[]'::jsonb),
    (p_user_id, 'support_request_update',
     'Support request update',
     'Update on your support request: {{1}}. Reply to this message if you need further assistance.',
     1, array['We have escalated your issue to engineering']::text[],
     '[]'::jsonb),
    (p_user_id, 'booking_update_changes',
     'Booking update (changes)',
     'Booking update: {{1}}. If you need to make changes, please reply to this message or contact us.',
     1, array['Your booking has been confirmed for Dec 20']::text[],
     '[]'::jsonb),
    (p_user_id, 'payment_notification',
     'Payment notification',
     'Payment notification: {{1}}. View your complete billing history in your account.',
     1, array['Your payment of $99 has been processed']::text[],
     '[]'::jsonb),
    (p_user_id, 'order_notification',
     'Order notification',
     'Order notification: {{1}}. Track your order status in your account at any time.',
     1, array['Your order has been shipped']::text[],
     '[]'::jsonb),
    (p_user_id, 'account_activity_notice',
     'Account activity notice',
     'Notice: {{1}}. This message was sent to keep you informed about your account activity.',
     1, array['A new device signed in to your account']::text[],
     '[]'::jsonb),
    (p_user_id, 'account_update_reply',
     'Account update with reply invite',
     'Important update regarding your account: {{1}}. If you have any questions, please reply to this message.',
     1, array['Your password was changed']::text[],
     '[]'::jsonb),
    (p_user_id, 'request_update_short',
     'Short request update',
     'Update on your request: {{1}}',
     1, array['Approved']::text[],
     '[]'::jsonb),
    (p_user_id, 'support_signed',
     'Support signed message',
     '{{1}} - from Ares Media support team - {{2}}',
     2, array['Thanks for reaching out','We will follow up shortly']::text[],
     '[]'::jsonb),
    (p_user_id, 'support_signed_alt',
     'Support signed message (alt)',
     '{{1}} — Message from Ares Media support team. {{2}}',
     2, array['We received your inquiry','A specialist will contact you within 24 hours']::text[],
     '[]'::jsonb),
    (p_user_id, 'booking_with_action_page',
     'Booking with action page button',
     'Booking confirmation: {{1}}. Tap below to view or manage your booking.',
     1, array['Your appointment is confirmed for Dec 15, 2:00 PM']::text[],
     '[{"type":"url","text":"View booking","url":"https://example.com/booking"}]'::jsonb)
  on conflict (user_id, name) do nothing;

  -- Apply default category tags after seeding rows.
  perform public.apply_default_template_category_tags(p_user_id);
end;
$$;
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use the `mcp__supabase__apply_migration` tool with `name: 'template_categories'` and the SQL above.
Expected: migration applied without error.

- [ ] **Step 3: Verify with `mcp__supabase__execute_sql`**

```sql
-- Should return 6 system rows.
select slug, label, sort_order from public.template_categories where user_id is null order by sort_order;

-- Should be > 0 if any user has the seeded templates.
select count(*) from public.messenger_template_categories;
```

Expected: 6 system categories listed; tag count > 0 (matches existing users × ~25 mappable templates).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260510000000_template_categories.sql
git commit -m "feat(db): template_categories tables, system seed, default tag backfill"
```

---

## Task 2: Types

**Files:**
- Modify: `src/lib/messenger-templates/types.ts`

- [ ] **Step 1: Append types**

Append to `src/lib/messenger-templates/types.ts`:

```ts
export interface TemplateCategory {
  id: string
  slug: string
  label: string
  is_system: boolean
  sort_order: number
}

export interface MessengerMessageTemplateWithCategories extends MessengerMessageTemplate {
  categories: TemplateCategory[]
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/messenger-templates/types.ts
git commit -m "feat(types): TemplateCategory + MessengerMessageTemplateWithCategories"
```

---

## Task 3: Server actions — categories CRUD + embed in loadTemplates

**Files:**
- Modify: `src/app/(app)/dashboard/templates/actions.ts`

- [ ] **Step 1: Add imports + actions**

Add to the import block at top:

```ts
import type { TemplateCategory, MessengerMessageTemplateWithCategories } from '@/lib/messenger-templates/types'
```

Replace the existing `loadTemplates` function with:

```ts
export async function loadTemplates(): Promise<MessengerMessageTemplateWithCategories[]> {
  const { supabase, userId } = await requireUser()

  const { count } = await supabase
    .from('messenger_message_templates')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if ((count ?? 0) === 0) {
    await supabase.rpc('seed_default_message_templates', { p_user_id: userId })
  }

  const { data, error } = await supabase
    .from('messenger_message_templates')
    .select('*, messenger_template_categories(category:template_categories(id, slug, label, is_system, sort_order))')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`loadTemplates: ${error.message}`)

  return (data ?? []).map((row: Record<string, unknown>) => {
    const joins = (row.messenger_template_categories as Array<{ category: TemplateCategory }> | null) ?? []
    const { messenger_template_categories: _drop, ...rest } = row as Record<string, unknown>
    void _drop
    return {
      ...(rest as MessengerMessageTemplate),
      categories: joins
        .map((j) => j.category)
        .filter(Boolean)
        .sort((a, b) =>
          a.is_system === b.is_system
            ? (a.is_system ? a.sort_order - b.sort_order : a.label.localeCompare(b.label))
            : (a.is_system ? -1 : 1),
        ),
    }
  })
}
```

Append at the bottom of the file:

```ts
/* ── categories ── */

export async function listCategories(): Promise<TemplateCategory[]> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase
    .from('template_categories')
    .select('id, slug, label, is_system, sort_order')
    .order('is_system', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })
  if (error) throw new Error(`listCategories: ${error.message}`)
  return (data ?? []) as TemplateCategory[]
}

function slugify(label: string): string {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48)
}

export async function createCategory(label: string): Promise<string> {
  const { supabase, userId } = await requireUser()
  const trimmed = label.trim()
  if (!trimmed) throw new Error('Category label is required.')
  const slug = slugify(trimmed)
  if (!slug) throw new Error('Category label must contain at least one letter or digit.')
  const { data, error } = await supabase
    .from('template_categories')
    .insert({ user_id: userId, slug, label: trimmed, is_system: false })
    .select('id')
    .single<{ id: string }>()
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new Error(`A category named "${trimmed}" already exists.`)
    }
    throw new Error(`createCategory: ${error.message}`)
  }
  revalidatePath('/dashboard/templates')
  return data.id
}

export async function deleteCategory(id: string): Promise<void> {
  const { supabase } = await requireUser()
  // RLS rejects attempts to delete system rows; we surface a clearer error.
  const { data: row } = await supabase
    .from('template_categories')
    .select('is_system')
    .eq('id', id)
    .maybeSingle<{ is_system: boolean }>()
  if (!row) throw new Error('Category not found.')
  if (row.is_system) throw new Error('System categories cannot be deleted.')
  const { error } = await supabase.from('template_categories').delete().eq('id', id)
  if (error) throw new Error(`deleteCategory: ${error.message}`)
  revalidatePath('/dashboard/templates')
}

export async function setTemplateCategories(
  templateId: string,
  categoryIds: string[],
): Promise<void> {
  const { supabase, userId } = await requireUser()
  // Make sure the caller owns the template — RLS on the join table enforces
  // this too, but a clean error message beats a constraint violation.
  const { data: tpl } = await supabase
    .from('messenger_message_templates')
    .select('id')
    .eq('id', templateId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!tpl) throw new Error('Template not found.')

  const { error: delErr } = await supabase
    .from('messenger_template_categories')
    .delete()
    .eq('template_id', templateId)
  if (delErr) throw new Error(`setTemplateCategories (clear): ${delErr.message}`)

  const unique = Array.from(new Set(categoryIds))
  if (unique.length === 0) {
    revalidatePath('/dashboard/templates')
    return
  }

  const rows = unique.map((category_id) => ({ template_id: templateId, category_id }))
  const { error: insErr } = await supabase
    .from('messenger_template_categories')
    .insert(rows)
  if (insErr) throw new Error(`setTemplateCategories (insert): ${insErr.message}`)
  revalidatePath('/dashboard/templates')
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no new errors. (`MessengerMessageTemplate` is already imported in this file.)

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/dashboard/templates/actions.ts
git commit -m "feat(templates): listCategories/createCategory/deleteCategory/setTemplateCategories actions"
```

---

## Task 4: Templates dashboard page — load categories

**Files:**
- Modify: `src/app/(app)/dashboard/templates/page.tsx`

- [ ] **Step 1: Read the file to confirm shape**

Read `src/app/(app)/dashboard/templates/page.tsx`. It currently calls `loadTemplates()` and renders `<TemplatesClient initialTemplates={...} />`.

- [ ] **Step 2: Add a parallel `listCategories()` call and pass to client**

Edit so the server component fetches both in parallel:

```tsx
import { loadTemplates, listCategories } from './actions'
import { TemplatesClient } from './_components/TemplatesClient'

export default async function TemplatesPage() {
  const [initialTemplates, initialCategories] = await Promise.all([
    loadTemplates(),
    listCategories(),
  ])
  return (
    <TemplatesClient
      initialTemplates={initialTemplates}
      initialCategories={initialCategories}
    />
  )
}
```

(Preserve any existing imports / metadata exports; only the body and the client invocation change.)

- [ ] **Step 3: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: errors only for `initialCategories` not yet accepted by `TemplatesClient` — fixed in Task 5.

- [ ] **Step 4: Commit (deferred to Task 5)**

Don't commit yet; Task 5 lands the matching client change.

---

## Task 5: Templates dashboard — filter chips, editor field, create/delete UI

**Files:**
- Modify: `src/app/(app)/dashboard/templates/_components/TemplatesClient.tsx`

- [ ] **Step 1: Update imports**

Replace the import block at the top:

```tsx
'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  countVariables,
  renderTemplate,
  type TemplateButton,
  type TemplateFormInput,
  type TemplateMetaStatus,
  type TemplateCategory,
  type MessengerMessageTemplateWithCategories,
} from '@/lib/messenger-templates/types'
import {
  createCategory,
  createTemplate,
  deleteCategory,
  deleteTemplate,
  duplicateTemplate,
  listCategories,
  refreshTemplateStatus,
  setTemplateCategories,
  submitTemplateForReview,
  updateTemplate,
} from '../actions'
```

- [ ] **Step 2: Update `Props` and constructor signature**

Replace:

```tsx
interface Props {
  initialTemplates: MessengerMessageTemplate[]
}
```

with:

```tsx
interface Props {
  initialTemplates: MessengerMessageTemplateWithCategories[]
  initialCategories: TemplateCategory[]
}
```

And the function signature:

```tsx
export function TemplatesClient({ initialTemplates, initialCategories }: Props) {
```

Update every reference to `MessengerMessageTemplate` inside this file to `MessengerMessageTemplateWithCategories` (the local `templates` state, the `selected` memo, `selectTemplate`'s parameter, etc.).

- [ ] **Step 3: Add category state + draft category ids**

Right after the existing `templates`/`statusFilter` state, add:

```tsx
const [categories, setCategories] = useState<TemplateCategory[]>(initialCategories)
const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
const [draftCategoryIds, setDraftCategoryIds] = useState<string[]>([])
const [newCategoryLabel, setNewCategoryLabel] = useState('')
const [showNewCategory, setShowNewCategory] = useState(false)
```

Update `visibleTemplates` to also filter by selected categories (OR within categories, AND with status):

```tsx
const visibleTemplates = useMemo(() => {
  return templates.filter((t) => {
    if (statusFilter !== 'all' && t.meta_status !== statusFilter) return false
    if (selectedCategoryIds.length === 0) return true
    return t.categories.some((c) => selectedCategoryIds.includes(c.id))
  })
}, [templates, statusFilter, selectedCategoryIds])
```

- [ ] **Step 4: Wire draft category state to selection lifecycle**

Update `selectTemplate` to seed the draft category ids:

```tsx
function selectTemplate(t: MessengerMessageTemplateWithCategories) {
  setIsCreating(false)
  setSelectedId(t.id)
  setDraft(fromTemplate(t))
  setDraftCategoryIds(t.categories.map((c) => c.id))
  setError(null)
}
```

Update `startCreate`:

```tsx
function startCreate() {
  setIsCreating(true)
  setSelectedId(null)
  setDraft(emptyDraft())
  setDraftCategoryIds([])
  setError(null)
}
```

- [ ] **Step 5: Save handler persists category assignment**

In `handleSave`, after the existing create/update branches but BEFORE the page reload, persist the categories. Replace the `try` block body of the transition with:

```tsx
try {
  let id: string
  if (draft.id) {
    await updateTemplate(draft.id, input)
    id = draft.id
  } else {
    id = await createTemplate(input)
  }
  await setTemplateCategories(id, draftCategoryIds)
  if (draft.id) {
    window.location.reload()
  } else {
    window.location.href = `/dashboard/templates?selected=${id}`
  }
} catch (e) {
  setError(e instanceof Error ? e.message : String(e))
}
```

- [ ] **Step 6: Add filter chip-row + new-category input above the template list**

Inside the `<aside>` block, immediately above the existing status `<select>` row, insert:

```tsx
<div style={{ marginBottom: 12 }}>
  <div style={{ fontSize: 11, color: S.ink3, marginBottom: 6 }}>Categories</div>
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
    {categories.map((c) => {
      const active = selectedCategoryIds.includes(c.id)
      return (
        <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
          <button
            onClick={() =>
              setSelectedCategoryIds((prev) =>
                prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
              )
            }
            style={{
              border: `1px solid ${active ? S.accent : S.border}`,
              background: active ? S.accentSoft : S.surface,
              color: active ? S.accent : S.ink2,
              padding: '4px 8px',
              borderRadius: 999,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {c.label}
          </button>
          {!c.is_system && (
            <button
              title="Delete category"
              onClick={async () => {
                if (!confirm(`Delete category "${c.label}"? Templates tagged with it will be untagged.`)) return
                try {
                  await deleteCategory(c.id)
                  setCategories((prev) => prev.filter((x) => x.id !== c.id))
                  setSelectedCategoryIds((prev) => prev.filter((x) => x !== c.id))
                  setDraftCategoryIds((prev) => prev.filter((x) => x !== c.id))
                  setTemplates((prev) =>
                    prev.map((t) => ({ ...t, categories: t.categories.filter((x) => x.id !== c.id) })),
                  )
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                }
              }}
              style={{
                border: 'none', background: 'transparent', color: S.ink4,
                fontSize: 12, cursor: 'pointer', padding: '0 2px 0 4px',
              }}
            >
              ×
            </button>
          )}
        </span>
      )
    })}
    {showNewCategory ? (
      <span style={{ display: 'inline-flex', gap: 4 }}>
        <input
          autoFocus
          value={newCategoryLabel}
          onChange={(e) => setNewCategoryLabel(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Escape') { setShowNewCategory(false); setNewCategoryLabel('') }
            if (e.key === 'Enter') {
              try {
                const id = await createCategory(newCategoryLabel)
                const next = await listCategories()
                setCategories(next)
                setShowNewCategory(false)
                setNewCategoryLabel('')
                setSelectedCategoryIds((prev) => [...prev, id])
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              }
            }
          }}
          placeholder="New category"
          style={{ ...inputStyle, padding: '2px 6px', fontSize: 11, width: 110 }}
        />
      </span>
    ) : (
      <button
        onClick={() => setShowNewCategory(true)}
        style={{
          border: `1px dashed ${S.border}`, background: 'transparent', color: S.ink3,
          padding: '4px 8px', borderRadius: 999, fontSize: 11, cursor: 'pointer',
        }}
      >
        + New
      </button>
    )}
  </div>
</div>
```

- [ ] **Step 7: Add "Categories" field in the editor column**

Inside the `<main>` editor block, directly after the "Display name" `<Field>` and before the "Internal name" field, insert:

```tsx
<Field label="Categories" hint="Tag this template so it appears under those filters across the app.">
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
    {categories.map((c) => {
      const on = draftCategoryIds.includes(c.id)
      return (
        <button
          key={c.id}
          type="button"
          onClick={() =>
            setDraftCategoryIds((prev) =>
              prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
            )
          }
          style={{
            border: `1px solid ${on ? S.accent : S.border}`,
            background: on ? S.accentSoft : S.surface,
            color: on ? S.accent : S.ink2,
            padding: '4px 10px',
            borderRadius: 999,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {c.label}
        </button>
      )
    })}
  </div>
</Field>
```

- [ ] **Step 8: Typecheck + dev smoke**

Run: `pnpm tsc --noEmit`
Expected: no errors.

Then run `pnpm dev`, open `/dashboard/templates`, and confirm:
1. Six system category chips render.
2. Selecting "Booking" filters the list to the three booking templates.
3. Opening a template shows category chips selected in the editor.
4. Toggling chips + saving persists across reload.
5. "+ New" creates a user category that can be deleted with the `×`.

- [ ] **Step 9: Commit (Tasks 4 + 5 together)**

```bash
git add src/app/\(app\)/dashboard/templates/page.tsx \
        src/app/\(app\)/dashboard/templates/_components/TemplatesClient.tsx
git commit -m "feat(templates): category filter chips, editor tagging, user category CRUD"
```

---

## Task 6: Agent campaign — load categories per template

**Files:**
- Modify: `src/app/(app)/dashboard/agent/page.tsx`
- Modify: `src/app/(app)/dashboard/agent/_components/AgentClient.tsx`

- [ ] **Step 1: Extend the page query**

Edit `src/app/(app)/dashboard/agent/page.tsx`. Replace the templates query block:

```tsx
const { data: tplData } = await supabase
  .from('messenger_message_templates')
  .select('id, display_name, name, language, body_text, variable_count, buttons, messenger_template_categories(category:template_categories(id, slug, label, is_system, sort_order))')
  .eq('user_id', user.id)
  .eq('meta_status', 'approved')
  .order('display_name', { ascending: true })

const templates = (tplData ?? []).map((t) => ({
  id: t.id as string,
  display_name: t.display_name as string,
  name: t.name as string,
  language: t.language as string,
  body_text: t.body_text as string,
  variable_count: t.variable_count as number,
  buttons: (t.buttons as TemplateButton[]) ?? [],
  categories: (((t as { messenger_template_categories?: Array<{ category: { id: string; slug: string; label: string; is_system: boolean; sort_order: number } | null } | null> }).messenger_template_categories) ?? [])
    .map((j) => j?.category)
    .filter((c): c is { id: string; slug: string; label: string; is_system: boolean; sort_order: number } => !!c),
}))

const { data: catData } = await supabase
  .from('template_categories')
  .select('id, slug, label, is_system, sort_order')
  .order('is_system', { ascending: false })
  .order('sort_order', { ascending: true })
  .order('label', { ascending: true })
const categories = (catData ?? []) as Array<{ id: string; slug: string; label: string; is_system: boolean; sort_order: number }>
```

Update the JSX to pass `categories`:

```tsx
return <AgentClient stages={stages} templates={templates} actionPages={actionPages} categories={categories} />
```

- [ ] **Step 2: Extend AgentClient props + UI**

Edit `src/app/(app)/dashboard/agent/_components/AgentClient.tsx`.

Add to the imports near the top (next to `TemplateButton`):

```tsx
import type { TemplateButton, TemplateCategory } from '@/lib/messenger-templates/types'
```

(Replace the existing import line for `TemplateButton` accordingly.)

Update `ApprovedTemplate`:

```tsx
interface ApprovedTemplate {
  id: string
  display_name: string
  name: string
  language: string
  body_text: string
  variable_count: number
  buttons: TemplateButton[]
  categories: TemplateCategory[]
}
```

Update `AgentClientProps`:

```tsx
interface AgentClientProps {
  stages: Stage[]
  templates: ApprovedTemplate[]
  actionPages: ActionPageOption[]
  categories: TemplateCategory[]
}
```

Update the function signature:

```tsx
export function AgentClient({ stages, templates, actionPages, categories }: AgentClientProps) {
```

Inside the component, after the existing `templateId` state, add:

```tsx
const [filterCategoryIds, setFilterCategoryIds] = useState<string[]>([])
const filteredTemplates = useMemo(() => {
  if (filterCategoryIds.length === 0) return templates
  return templates.filter((t) => t.categories.some((c) => filterCategoryIds.includes(c.id)))
}, [templates, filterCategoryIds])
```

If the currently-selected `templateId` is filtered out, fall back to the first visible one — add this effect:

```tsx
useEffect(() => {
  if (!filteredTemplates.find((t) => t.id === templateId)) {
    setTemplateId(filteredTemplates[0]?.id ?? '')
  }
}, [filteredTemplates, templateId])
```

(Add `useEffect` to the React import at the top if missing.)

Replace the dropdown's options source. Find the `<select value={templateId}` block (around line 496) and change the option list to iterate `filteredTemplates` instead of `templates`. Immediately above that `<select>`, insert a chip-row:

```tsx
<div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
  {categories.map((c) => {
    const on = filterCategoryIds.includes(c.id)
    return (
      <button
        key={c.id}
        type="button"
        onClick={() =>
          setFilterCategoryIds((prev) =>
            prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
          )
        }
        style={{
          border: `1px solid ${on ? S.accent : S.border}`,
          background: on ? S.accentSoft : S.surface,
          color: on ? S.accent : S.ink2,
          padding: '3px 9px',
          borderRadius: 999,
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        {c.label}
      </button>
    )
  })}
</div>
```

(Read the file around line 485–500 first to find the exact insertion point and adapt the surrounding `<div>` if needed.)

- [ ] **Step 3: Typecheck + dev smoke**

Run: `pnpm tsc --noEmit`
Expected: no errors.

Then load `/dashboard/agent`, switch to "Shared template" mode, confirm:
1. Category chips render above the template dropdown.
2. Selecting "Booking" narrows the dropdown to templates tagged Booking.
3. The current selection auto-falls-back to the first visible option when filters change.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/dashboard/agent/page.tsx \
        src/app/\(app\)/dashboard/agent/_components/AgentClient.tsx
git commit -m "feat(agent): category filter for shared-template picker"
```

---

## Task 7: Booking follow-ups generator — default Booking preselect

**Files:**
- Modify: `src/app/(app)/dashboard/action-pages/_kinds/booking/followups-actions.ts`
- Modify: `src/app/(app)/dashboard/action-pages/_kinds/booking/FollowupTouchpointsEditor.tsx`

- [ ] **Step 1: Read both files**

Open both files to locate the `ApprovedTemplateOption` shape and the loader. Confirm that `loadFollowupsForPage` returns `{ managed, approvedTemplates }`.

- [ ] **Step 2: Add categories to the option type and loader**

In `followups-actions.ts`, extend `ApprovedTemplateOption`:

```ts
export interface ApprovedTemplateOption {
  // ...existing fields...
  categories: { id: string; slug: string; label: string }[]
}
```

Update the supabase select inside `loadFollowupsForPage` to include the join:

```ts
.from('messenger_message_templates')
.select('id, display_name, name, language, body_text, variable_count, buttons, messenger_template_categories(category:template_categories(id, slug, label))')
```

(Adapt to whatever fields the existing select already lists.)

Update the mapping that builds `approvedTemplates` to populate `categories`:

```ts
categories: ((t as { messenger_template_categories?: Array<{ category: { id: string; slug: string; label: string } | null } | null> }).messenger_template_categories ?? [])
  .map((j) => j?.category)
  .filter((c): c is { id: string; slug: string; label: string } => !!c),
```

- [ ] **Step 3: Default-filter to Booking in the editor**

In `FollowupTouchpointsEditor.tsx`, after the existing `templates` state, add:

```tsx
const [categoryFilter, setCategoryFilter] = useState<string>('booking')

const visibleTemplates = useMemo(() => {
  if (categoryFilter === 'all') return templates
  return templates.filter((t) => t.categories.some((c) => c.slug === categoryFilter))
}, [templates, categoryFilter])
```

Find the existing template `<select>` (or however the picker renders templates) and change its option list source from `templates` to `visibleTemplates`. Immediately above it, add a small filter row:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12 }}>
  <span style={{ color: '#6B6960' }}>Filter:</span>
  <select
    value={categoryFilter}
    onChange={(e) => setCategoryFilter(e.target.value)}
    style={{ padding: '2px 6px', fontSize: 12 }}
  >
    <option value="booking">Booking (default)</option>
    <option value="reminders">Reminders</option>
    <option value="notifications">Notifications</option>
    <option value="general">General</option>
    <option value="all">All categories</option>
  </select>
</div>
```

If `useMemo`/`useState` aren't already imported, add them.

- [ ] **Step 4: Typecheck + dev smoke**

Run: `pnpm tsc --noEmit`
Expected: no errors.

Open a booking action page editor, scroll to the Follow-ups Touchpoints section, confirm:
1. Default filter is "Booking".
2. Template dropdown lists only templates tagged Booking.
3. Switching to "All categories" shows everything.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/_kinds/booking/followups-actions.ts \
        src/app/\(app\)/dashboard/action-pages/_kinds/booking/FollowupTouchpointsEditor.tsx
git commit -m "feat(booking-followups): default template picker to Booking category"
```

---

## Task 8: Final verification + push

- [ ] **Step 1: Full typecheck + lint**

```bash
pnpm tsc --noEmit
pnpm lint
```

Expected: clean.

- [ ] **Step 2: End-to-end manual smoke**

Walk through the three surfaces:
1. `/dashboard/templates` — filter chips work, create/delete category, tag a template, refresh.
2. `/dashboard/agent` (Shared template mode) — chip filter narrows dropdown.
3. Action page → booking → Follow-ups Touchpoints — defaults to Booking.

- [ ] **Step 3: Push**

```bash
git push origin main
```
