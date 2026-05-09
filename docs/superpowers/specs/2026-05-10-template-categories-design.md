# Template Categories — Design

**Date:** 2026-05-10
**Status:** Approved, ready for implementation plan

## Problem

`messenger_message_templates` has no purpose-based grouping. Users browsing the
template library, picking a shared template for an agent campaign, or selecting
a template for booking follow-ups have to scan all 28+ templates with no way
to narrow by intent (booking, offer, reminder, etc.).

The existing `category` column on `messenger_message_templates` is reserved for
Meta's API category (`'utility'`) and cannot be repurposed.

## Goals

- Tag every template with one or more **purpose categories** (Booking, Offers,
  Reminders, Support, Notifications, General).
- Ship a fixed system catalog out of the box; let users add their own
  categories on top.
- Surface categories as filters on three screens: Templates dashboard, agent
  campaign shared-template picker, and booking-follow-ups generator.

## Non-goals

- Meta-side category changes — `messenger_message_templates.category` stays
  `'utility'` and continues to mean Meta's product category.
- Per-page or per-team category scoping — categories are user-global.
- Bulk re-tagging UI — single-template editing is enough for v1.

## Schema

### `template_categories`

The category catalog. System rows have `user_id is null`; user rows are scoped
to a single user.

| column        | type          | notes |
|---------------|---------------|-------|
| `id`          | uuid pk       | `gen_random_uuid()` |
| `user_id`     | uuid null     | null = system, references `auth.users(id) on delete cascade` |
| `slug`        | text not null | stable identifier (`booking`, `offers`, …) |
| `label`       | text not null | display name |
| `is_system`   | bool not null | mirrors `user_id is null`; convenient for filtering |
| `sort_order`  | int not null default 0 | for predictable system display order |
| `created_at`  | timestamptz   | default `now()` |
| `updated_at`  | timestamptz   | maintained by trigger |

Constraints:

- Unique `(user_id, slug)` — system rows uniquely keyed by slug since
  `user_id` is null. Use a partial unique index for the system half:
  `unique index template_categories_system_slug_uniq on template_categories(slug) where user_id is null`
  and `unique index template_categories_user_slug_uniq on template_categories(user_id, slug) where user_id is not null`.

RLS:

- Read: `user_id is null OR user_id = auth.uid()`
- Insert/Update/Delete: `user_id = auth.uid()` only — system rows are immutable
  to clients (changes happen via migration).

### `messenger_template_categories`

Many-to-many join.

| column         | type    | notes |
|----------------|---------|-------|
| `template_id`  | uuid    | fk → `messenger_message_templates(id) on delete cascade` |
| `category_id`  | uuid    | fk → `template_categories(id) on delete cascade` |

Primary key `(template_id, category_id)`. Index on `category_id` for reverse
lookups.

RLS: gated through ownership of the parent template — read/write allowed when
the caller owns the `template_id` row.

## Seed data

### System categories (one-time insert in migration)

| slug            | label         | sort_order |
|-----------------|---------------|------------|
| `booking`       | Booking       | 10 |
| `offers`        | Offers        | 20 |
| `reminders`     | Reminders     | 30 |
| `support`       | Support       | 40 |
| `notifications` | Notifications | 50 |
| `general`       | General       | 60 |

### Default tag mapping for the 28 seeded templates

Backfilled in the same migration by joining on template `name`:

| Category        | Templates |
|-----------------|-----------|
| **Booking**     | `booking_confirmation_buttons`, `booking_update_changes`, `booking_with_action_page` |
| **Offers**      | *(none — users add their own)* |
| **Reminders**   | `quick_reminder`, `team_friendly_reminder`, `casual_heads_up`, `quick_heads_up_thanks` |
| **Support**     | `support_request_update`, `support_signed`, `support_signed_alt`, `team_message` |
| **Notifications** | `order_status_update`, `order_update_details`, `order_notification`, `payment_notification`, `account_update_details`, `account_update_reply`, `account_activity_notice`, `important_notice`, `system_notification_optout` |
| **General**     | `notification_with_note`, `in_the_loop`, `quick_update_friendly`, `casual_with_reply_invite`, `good_day_update`, `valued_customer_update`, `general_help_offer`, `request_update_short` |

### `seed_default_message_templates(p_user_id)` extension

After inserting the 28 default templates, the function also inserts the
matching `messenger_template_categories` join rows (system categories are
shared, so the join just references the system category ids). Idempotent —
`on conflict (template_id, category_id) do nothing`.

## Server actions

All in `src/app/(app)/dashboard/templates/actions.ts`.

- `listCategories(): Promise<TemplateCategory[]>` — returns system rows + the
  caller's user-scoped rows, sorted: system first by `sort_order`, then user
  rows alphabetically.
- `createCategory(label: string): Promise<string>` — auto-slugs the label,
  inserts a user-scoped row. Errors if the slug collides with an existing
  user row.
- `deleteCategory(id: string): Promise<void>` — deletes a user-owned category
  (system rows rejected by RLS). Cascades to join rows.
- `setTemplateCategories(templateId: string, categoryIds: string[]): Promise<void>`
  — replaces the join rows for the template in a single transaction:
  delete existing → insert new set.
- `loadTemplates()` extended to embed
  `categories:template_categories(category:template_categories(id, slug, label, is_system))`
  via PostgREST so each template arrives with its tag list pre-joined.

## UI

### Templates dashboard (`/dashboard/templates`)

**List column**

- New "Categories" chip-row above the existing status-filter dropdown.
- Each system category renders as a chip; user-created categories follow.
  Trailing "+ New category" chip opens an inline text input → calls
  `createCategory`.
- User chips have a small "×" affordance that calls `deleteCategory` after a
  confirm dialog (warns about un-tagging affected templates).
- Selection is multi-select. Filter semantics: a template is shown if it has
  **any** of the selected categories (OR). Combines with the existing status
  filter (AND across the two filter dimensions).

**Editor column**

- New "Categories" field directly below "Display name".
- Shows current tags as removable chips; a dropdown lets the user add more
  (excludes already-attached categories).
- Save serialization: editor builds the desired `categoryIds[]` and calls
  `setTemplateCategories(templateId, categoryIds)` after the
  create/update of the template itself.

### Agent campaign — shared template picker (`AgentClient`)

- A category chip-row above the approved-template dropdown.
- Selecting one or more chips narrows the dropdown to templates tagged with
  any of them; clearing all chips restores the full list.

### Booking-follow-ups generator (Phase 2)

- The generator's template picker pre-selects the **Booking** category chip on
  mount.
- User can clear or change the selection like any other surface.

## Files touched

- **New migration:** `supabase/migrations/2026051X000000_template_categories.sql`
  — both new tables, RLS, system seed, backfill of existing 28 templates, and
  the updated `seed_default_message_templates` function body.
- `src/lib/messenger-templates/types.ts` — add `TemplateCategory`,
  `TemplateWithCategories`.
- `src/app/(app)/dashboard/templates/actions.ts` — new actions listed above;
  `loadTemplates` returns categories.
- `src/app/(app)/dashboard/templates/_components/TemplatesClient.tsx` —
  filter chip-row, editor field, create/delete category UI.
- `src/app/(app)/dashboard/agent/_components/AgentClient.tsx` (or wherever
  the shared-template picker lives) — category filter chip-row.
- Booking-follow-ups generator template picker (Phase 2 surface) — default
  Booking category preselect.

## Out of scope

- Renaming system categories.
- Reordering user categories (sort alphabetically).
- Sharing categories across users / teams.
- Tag analytics ("most-used category" dashboards).
