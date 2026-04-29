# Facebook Connections — Per-User Redesign

**Date:** 2026-04-29
**Status:** Approved (schema + RLS only)

## Background

The previous schema (`supabase/migrations/20260428200000_facebook_connections.sql`) modelled
Facebook as an **admin-owned** resource: a single admin connected Facebook, then assigned
individual pages to users via a `page_assignments` table. Remotely, that migration was
applied and then dropped (`drop_facebook_connections`); locally the original create-only
file is still present, leaving local and remote out of sync.

We are replacing it with a **per-user** model: every authenticated user connects their own
Facebook account and owns the pages associated with that account. Admin assignment is
removed entirely.

## Goals

- Each user can connect one Facebook account.
- A connection can hold many Facebook pages (one FB login → multiple pages).
- Users own and manage their own connection + pages.
- Admin/superadmin retain full read/write access for support and oversight.
- Token health monitoring is preserved (`last_health_status` + `page_health_logs`).

## Non-Goals

This spec covers **schema + RLS only**. Out of scope:

- Facebook OAuth flow / token exchange.
- API routes or server actions for connect/disconnect/refresh.
- UI for "Connect Facebook" / page list.
- Background health-check job.

These will be follow-up specs.

## Schema

### `facebook_connections` (one row per user)

| column            | type        | notes                                                         |
| ----------------- | ----------- | ------------------------------------------------------------- |
| id                | uuid pk     | `default gen_random_uuid()`                                   |
| user_id           | uuid        | `not null unique references profiles(id) on delete cascade`   |
| fb_user_id        | text        | not null                                                      |
| long_lived_token  | text        | not null                                                      |
| token_expires_at  | timestamptz | nullable                                                      |
| created_at        | timestamptz | `not null default now()`                                      |
| updated_at        | timestamptz | `not null default now()`, maintained by `set_updated_at` trigger |

`unique (user_id)` enforces one FB connection per user.

### `facebook_pages` (many per connection)

Unchanged from the previous schema:

| column             | type        | notes                                                          |
| ------------------ | ----------- | -------------------------------------------------------------- |
| id                 | uuid pk     | `default gen_random_uuid()`                                    |
| connection_id      | uuid        | `not null references facebook_connections(id) on delete cascade` |
| fb_page_id         | text        | `not null unique`                                              |
| name               | text        | not null                                                       |
| category           | text        | nullable                                                       |
| page_access_token  | text        | not null                                                       |
| last_health_status | text        | `not null default 'unknown'` check in (`ok`, `error`, `unknown`) |
| last_checked_at    | timestamptz | nullable                                                       |
| created_at         | timestamptz | `not null default now()`                                       |
| updated_at         | timestamptz | `not null default now()`, trigger-maintained                   |

### `page_health_logs`

Unchanged:

| column        | type        | notes                                                |
| ------------- | ----------- | ---------------------------------------------------- |
| id            | uuid pk     | `default gen_random_uuid()`                          |
| page_id       | uuid        | `not null references facebook_pages(id) on delete cascade` |
| status        | text        | check in (`ok`, `error`)                             |
| http_status   | integer     | nullable                                             |
| error_code    | text        | nullable                                             |
| error_message | text        | nullable                                             |
| checked_at    | timestamptz | `not null default now()`                             |

Index: `(page_id, checked_at desc)`.

### Removed

- `page_assignments` is dropped entirely. Ownership is now direct via
  `facebook_connections.user_id`.

## RLS

All three tables have RLS enabled.

### `facebook_connections`

- **Owner full access:** `using (user_id = auth.uid()) with check (user_id = auth.uid())`
- **Admin/superadmin full access:** `using (current_role() in ('admin','superadmin'))
  with check (current_role() in ('admin','superadmin'))`

### `facebook_pages`

- **Owner full access** via join to the parent connection:
  `exists (select 1 from facebook_connections c
           where c.id = facebook_pages.connection_id and c.user_id = auth.uid())`
  for both `using` and `with check`.
- **Admin/superadmin full access.**

### `page_health_logs`

- **Owner read-only** via `page → connection → user_id` chain:
  `exists (select 1 from facebook_pages p
           join facebook_connections c on c.id = p.connection_id
           where p.id = page_health_logs.page_id and c.user_id = auth.uid())`
- **Admin/superadmin full access.** (Background health-check job runs as service role
  and bypasses RLS.)

## Migration Plan

1. **Delete** the stale local file
   `supabase/migrations/20260428200000_facebook_connections.sql`.
2. **Add** a new migration `<new_timestamp>_facebook_connections.sql` containing the
   schema and RLS above. No `drop` statements needed — the remote already ran
   `drop_facebook_connections` and local was never applied past that point.

## Open Questions

None.
