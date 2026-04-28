# Leads Pipeline — Design

**Date:** 2026-04-28
**Status:** Approved
**Owner:** John Angelo David

## Summary

Add a per-user Leads CRM to WhatStage with a customizable pipeline. Users get
a seeded set of default stages, can add/edit/delete custom stages, and manage
leads (with custom fields) through both a Kanban board and a table view.
Supports search, date-range filtering, sorting, pagination, manual entry,
edit, bulk delete / bulk edit / bulk transfer, and drag-and-drop transfer
between stages.

Scope is a single user's pipeline (no orgs/teams). All persistence is in
Supabase with RLS keyed on `auth.uid()`.

## Goals

- Sidebar entry **Leads** that loads `/dashboard/leads`.
- Pre-templated pipeline seeded on first visit.
- Full CRUD on stages and leads, including custom field definitions.
- Kanban view with smooth drag-and-drop transfer between stages.
- Table view with multi-select and bulk operations.
- Search, date-range filter, sort, paginated stages and leads.

## Non-goals

- Multi-tenant / org-level sharing (deferred — schema includes `user_id`
  only; org migration is future work).
- Email integration, lead enrichment, automations, reports.
- Mobile-first responsive design beyond what default Tailwind gives us.

## Data Model (Supabase Postgres)

All tables live in `public`. RLS enabled. Every policy: `user_id = auth.uid()`
for select/insert/update/delete.

### `pipeline_stages`

| Column        | Type                       | Notes                                        |
|---------------|----------------------------|----------------------------------------------|
| `id`          | `uuid` PK                  | `gen_random_uuid()`                          |
| `user_id`     | `uuid` FK `auth.users.id`  | not null, indexed                            |
| `name`        | `text`                     | not null                                     |
| `description` | `text`                     | nullable                                     |
| `position`    | `int`                      | not null; ordering within user               |
| `is_default`  | `boolean`                  | default false; exactly one per user, used as fallback target on stage delete; cannot be deleted |
| `created_at`  | `timestamptz`              | default `now()`                              |

Index: `(user_id, position)`.

### `leads`

| Column            | Type                          | Notes                                 |
|-------------------|-------------------------------|---------------------------------------|
| `id`              | `uuid` PK                     |                                       |
| `user_id`         | `uuid` FK `auth.users.id`     | not null, indexed                     |
| `stage_id`        | `uuid` FK `pipeline_stages.id`| not null, on stage delete handled in app (move) |
| `name`            | `text`                        | not null                              |
| `email`           | `text`                        | nullable                              |
| `phone`           | `text`                        | nullable                              |
| `company`         | `text`                        | nullable                              |
| `job_title`       | `text`                        | nullable                              |
| `source`          | `text`                        | nullable (free-form)                  |
| `estimated_value` | `numeric(12,2)`               | nullable                              |
| `notes`           | `text`                        | nullable                              |
| `custom_fields`   | `jsonb`                       | default `'{}'::jsonb`; keyed by `lead_field_defs.key` |
| `position`        | `int`                         | not null; ordering within stage       |
| `created_at`      | `timestamptz`                 | default `now()`                       |
| `updated_at`      | `timestamptz`                 | default `now()`; trigger on update    |

Indexes: `(user_id, stage_id, position)`, `(user_id, created_at desc)`,
GIN on `(name gin_trgm_ops, email gin_trgm_ops, company gin_trgm_ops)` for
search (or btree + ILIKE if `pg_trgm` not desired).

### `lead_field_defs`

| Column     | Type                       | Notes                                |
|------------|----------------------------|--------------------------------------|
| `id`       | `uuid` PK                  |                                      |
| `user_id`  | `uuid` FK                  | not null, indexed                    |
| `key`      | `text`                     | not null; slug used as JSON key      |
| `label`    | `text`                     | not null; display label              |
| `type`     | `text`                     | one of `text|number|date|select`     |
| `options`  | `jsonb`                    | nullable; `string[]` when type=select|
| `position` | `int`                      | not null                             |

Unique: `(user_id, key)`.

### Seeding

On first load of `/dashboard/leads`, if the user has zero stages, insert the
seven defaults in order:

1. **New Lead** — `is_default = true`
2. Contacted
3. Qualified
4. Unqualified
5. Proposal
6. Won
7. Lost

Done in a server action triggered from the page (idempotent: only inserts
when count is zero).

## Routes

All under `(app)` group, gated by existing `/dashboard` auth in
`src/app/(app)/layout.tsx`.

- `/dashboard/leads` — main board / table.
- `/dashboard/leads/stages` — stage management page.
- `/dashboard/leads/fields` — custom field definitions.

URL state for `/dashboard/leads`:

| Param   | Meaning                                            |
|---------|----------------------------------------------------|
| `view`  | `kanban` (default) or `table`                      |
| `stage` | (table view) selected stage id; omit = all         |
| `page`  | (table view + per-column kanban) page number, 1-based |
| `q`     | search query (ILIKE across name/email/phone/company)|
| `from`  | inclusive `created_at` lower bound (`YYYY-MM-DD`)  |
| `to`    | inclusive `created_at` upper bound                 |
| `sort`  | `recent` (default) `oldest` `name_asc` `value_desc`|

## Server Actions

File: `src/app/(app)/dashboard/leads/actions.ts`

- `seedDefaultStagesIfEmpty()`
- `createStage(input)` / `updateStage(id, input)` / `deleteStage(id)` —
  delete moves child leads to the user's `is_default` stage in a single tx.
- `reorderStages(orderedIds[])`
- `createLead(input)` / `updateLead(id, input)` / `deleteLead(id)`
- `bulkDeleteLeads(ids[])`
- `bulkUpdateLeads(ids[], partial)` — only fields present in `partial`
  are written.
- `moveLead(id, toStageId, toPosition)` — used by DnD and single-row "Move".
- `bulkMoveLeads(ids[], toStageId)` — used by table bulk transfer.
- `createFieldDef(input)` / `updateFieldDef(id, input)` / `deleteFieldDef(id)` —
  delete also strips the key from existing `leads.custom_fields`.

All inputs validated with Zod. All write actions call `revalidatePath`.

## Components

Path: `src/app/(app)/dashboard/leads/_components/`

- `ViewToggle.tsx` — Kanban/Table switch.
- `Toolbar.tsx` — debounced search, date-range inputs, sort `<select>`,
  "Add Lead" button. Writes URL params via `router.replace`.
- `KanbanBoard.tsx` — wraps `@dnd-kit/core` `DndContext`; renders one
  `StageColumn` per stage; handles `onDragEnd` → `moveLead`.
- `StageColumn.tsx` — header (name, count), paginated `LeadCard` list,
  per-column "+" button, "Load page N" pagination.
- `LeadCard.tsx` — sortable card; click opens `LeadDrawer`.
- `LeadsTable.tsx` — checkbox column, sortable headers, paginated rows,
  sticky `BulkActionBar` when rows selected.
- `BulkActionBar.tsx` — Delete / Move to stage… / Edit selected.
- `LeadDrawer.tsx` — slide-over for create/edit; renders core fields and
  iterates `lead_field_defs` for custom fields.
- `StageManager.tsx` (on `/stages`) — list with drag-to-reorder, inline
  edit, delete confirm modal.
- `Pagination.tsx` — Prev / 1…N / Next; `pageSize = 25`.

## Behaviors

- **Search:** server-side ILIKE across `name, email, phone, company`.
- **Date filter:** `created_at >= from AND created_at <= to` (either side
  optional).
- **Sort options:**
  - `recent` → `created_at desc`
  - `oldest` → `created_at asc`
  - `name_asc` → `name asc`
  - `value_desc` → `estimated_value desc nulls last`
- **Pagination:** 25 per page; numbered Prev/Next + page numbers, derived
  from a `count` query.
- **Drag-and-drop:** `@dnd-kit/core` + `@dnd-kit/sortable`. Optimistic
  update via `useOptimistic`; server persists `stage_id` and gap-based
  `position`. Keyboard sensors enabled for accessibility.
- **Bulk select:** table view only. Selection state local to table; cleared
  on filter / page change.
- **Stage delete:** confirm modal warns leads will be moved to the default
  stage; default stage cannot be deleted.

## Sidebar Change

`src/app/(app)/_components/sidebar.tsx` — add
`{ href: '/dashboard/leads', label: 'Leads' }` between Activity and Settings.

## Dependencies

Add to `package.json`:

- `@dnd-kit/core`
- `@dnd-kit/sortable`

No calendar dependency — two native `<input type="date">` controls for the
date range.

## Testing (Vitest)

- **Server actions:** stage CRUD, lead CRUD, bulk delete, bulk move,
  `deleteStage` reassigns leads to default, `deleteFieldDef` strips key
  from `custom_fields`, RLS scope (queries cannot see other users' rows).
- **Components:**
  - `Toolbar` — debounce + URL param sync.
  - `LeadDrawer` — renders custom field defs by type.
  - `KanbanBoard` — DnD `onDragEnd` produces correct `moveLead` args.
  - `LeadsTable` — bulk select state, bulk-action bar visibility.

## Migration Order

1. Create `pipeline_stages`, `leads`, `lead_field_defs` tables + indexes.
2. Enable RLS, attach policies.
3. Add `updated_at` trigger on `leads`.
4. (Optional) enable `pg_trgm` for search index.

## Open Risks

- Reorder/position semantics under concurrent DnD — mitigated by gap-based
  integer positions and re-fetch on settle.
- Custom fields schema drift if a `key` is renamed — define rename as
  `delete + create` in MVP; explicit rename is future work.
