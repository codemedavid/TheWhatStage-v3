# Facebook Connections — Per-User Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin-centric Facebook schema with a per-user one — each authenticated user owns their own `facebook_connections` row and the `facebook_pages` underneath it; admins/superadmins keep full read/write across everyone for support.

**Architecture:** Pure database change. Drop the stale local migration file (the remote already ran a `drop_facebook_connections` migration), then add a single new migration that creates `facebook_connections`, `facebook_pages`, and `page_health_logs` with the new ownership model and RLS policies. No application code changes — the previous schema was unused in `src/`.

**Tech Stack:** Supabase Postgres, SQL migrations under `supabase/migrations/`, Supabase MCP server for remote verification.

**Spec:** `docs/superpowers/specs/2026-04-29-facebook-connections-per-user-design.md`

---

## File Structure

- **Delete:** `supabase/migrations/20260428200000_facebook_connections.sql` — admin-centric schema, never matched remote state.
- **Create:** `supabase/migrations/20260429000000_facebook_connections.sql` — new per-user schema + RLS.

That is the entirety of the change.

---

### Task 1: Remove the stale admin-centric migration

**Files:**
- Delete: `supabase/migrations/20260428200000_facebook_connections.sql`

**Why:** This file was never reflected on remote (remote ran a different timestamp and then dropped it). Keeping it would either re-introduce the admin schema on a fresh `supabase db reset` or conflict with the new migration.

- [ ] **Step 1: Confirm no application code references the old tables**

Run:

```bash
rg -i 'facebook_connections|facebook_pages|page_assignments|page_health_logs' src/ 2>&1 | head -20
```

Expected: no matches. (If any match appears, stop and surface it — the plan assumed no app code touched these tables.)

- [ ] **Step 2: Delete the file**

```bash
rm supabase/migrations/20260428200000_facebook_connections.sql
```

- [ ] **Step 3: Verify deletion**

```bash
ls supabase/migrations/
```

Expected output (only these two files remain from the old set):

```
20260428000000_auth_profiles.sql
20260428100000_leads_pipeline.sql
```

- [ ] **Step 4: Commit**

```bash
git add -A supabase/migrations/
git commit -m "chore(db): remove stale admin-centric facebook migration

Remote already ran drop_facebook_connections; this local file no longer
matches remote state and is being replaced by a per-user schema."
```

---

### Task 2: Create the new per-user migration

**Files:**
- Create: `supabase/migrations/20260429000000_facebook_connections.sql`

**Notes for the engineer:**
- `public.set_updated_at()` is defined in `20260428000000_auth_profiles.sql`. Reuse it.
- `public.current_role()` is also defined there — it returns the JWT-claimed role and is used elsewhere in this codebase for role checks in RLS.
- Pattern for RLS: split owner policy from admin policy as **two separate `create policy` statements** (this matches the style in the existing `leads_pipeline` migration).
- All `not null` columns must have either a default or be required at insert time — keep that in mind for the schema below.

- [ ] **Step 1: Create the migration file with the full contents below**

Create `supabase/migrations/20260429000000_facebook_connections.sql` with **exactly** this content:

```sql
-- =========================================================================
-- Facebook connections, pages, and health logs (per-user ownership)
-- =========================================================================
-- Each authenticated user owns one facebook_connections row and the
-- facebook_pages underneath it. Admins/superadmins retain full access
-- across all users for support and oversight.
-- =========================================================================

create table public.facebook_connections (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  fb_user_id        text not null,
  long_lived_token  text not null,
  token_expires_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id)
);

create trigger facebook_connections_set_updated_at
before update on public.facebook_connections
for each row execute function public.set_updated_at();

create table public.facebook_pages (
  id                  uuid primary key default gen_random_uuid(),
  connection_id       uuid not null references public.facebook_connections(id) on delete cascade,
  fb_page_id          text not null unique,
  name                text not null,
  category            text,
  page_access_token   text not null,
  last_health_status  text not null default 'unknown'
                      check (last_health_status in ('ok','error','unknown')),
  last_checked_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger facebook_pages_set_updated_at
before update on public.facebook_pages
for each row execute function public.set_updated_at();

create index facebook_pages_connection_idx
  on public.facebook_pages (connection_id);

create table public.page_health_logs (
  id             uuid primary key default gen_random_uuid(),
  page_id        uuid not null references public.facebook_pages(id) on delete cascade,
  status         text not null check (status in ('ok','error')),
  http_status    integer,
  error_code     text,
  error_message  text,
  checked_at     timestamptz not null default now()
);

create index page_health_logs_page_idx
  on public.page_health_logs (page_id, checked_at desc);

-- =========================================================================
-- RLS
-- =========================================================================

alter table public.facebook_connections enable row level security;
alter table public.facebook_pages       enable row level security;
alter table public.page_health_logs     enable row level security;

-- facebook_connections -----------------------------------------------------

create policy fb_connections_owner_all on public.facebook_connections
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy fb_connections_admin_all on public.facebook_connections
  for all to authenticated
  using (public.current_role() in ('admin','superadmin'))
  with check (public.current_role() in ('admin','superadmin'));

-- facebook_pages -----------------------------------------------------------

create policy fb_pages_owner_all on public.facebook_pages
  for all to authenticated
  using (
    exists (
      select 1 from public.facebook_connections c
      where c.id = facebook_pages.connection_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.facebook_connections c
      where c.id = facebook_pages.connection_id
        and c.user_id = auth.uid()
    )
  );

create policy fb_pages_admin_all on public.facebook_pages
  for all to authenticated
  using (public.current_role() in ('admin','superadmin'))
  with check (public.current_role() in ('admin','superadmin'));

-- page_health_logs ---------------------------------------------------------

create policy page_health_logs_owner_read on public.page_health_logs
  for select to authenticated
  using (
    exists (
      select 1 from public.facebook_pages p
      join public.facebook_connections c on c.id = p.connection_id
      where p.id = page_health_logs.page_id
        and c.user_id = auth.uid()
    )
  );

create policy page_health_logs_admin_all on public.page_health_logs
  for all to authenticated
  using (public.current_role() in ('admin','superadmin'))
  with check (public.current_role() in ('admin','superadmin'));
```

- [ ] **Step 2: Sanity-check the SQL parses (lint via Supabase CLI dry-run)**

If the Supabase CLI is installed locally:

```bash
supabase db lint --schema public 2>&1 | tail -20
```

Expected: no errors referencing the new file. If `supabase` is not installed, skip this step — Step 3 will surface SQL errors.

- [ ] **Step 3: Apply the migration to the remote project via MCP**

Use the Supabase MCP tool `mcp__supabase__apply_migration` with:

- `name`: `facebook_connections_per_user`
- `query`: the **entire SQL body from Step 1** (everything between the file's first `--` comment and the final `;`)

Expected: success response, no error. If it errors, fix the SQL and re-apply (the same migration name is idempotent on retry only if no partial objects were created — if objects were partially created, drop them manually with `mcp__supabase__execute_sql` before retrying).

- [ ] **Step 4: Verify tables and RLS via MCP**

Use `mcp__supabase__list_tables` with `schemas: ["public"]`, `verbose: false`.

Expected: the returned `tables` array includes all of:

- `public.facebook_connections` with `rls_enabled: true`
- `public.facebook_pages` with `rls_enabled: true`
- `public.page_health_logs` with `rls_enabled: true`
- `public.page_assignments` is **NOT** present.

- [ ] **Step 5: Verify policies via MCP**

Use `mcp__supabase__execute_sql` with:

```sql
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('facebook_connections','facebook_pages','page_health_logs')
order by tablename, policyname;
```

Expected exactly these 6 rows:

| tablename             | policyname                         |
| --------------------- | ---------------------------------- |
| facebook_connections  | fb_connections_admin_all           |
| facebook_connections  | fb_connections_owner_all           |
| facebook_pages        | fb_pages_admin_all                 |
| facebook_pages        | fb_pages_owner_all                 |
| page_health_logs      | page_health_logs_admin_all         |
| page_health_logs      | page_health_logs_owner_read        |

If any are missing or extra, stop and reconcile before committing.

- [ ] **Step 6: Verify the migration is recorded remotely**

Use `mcp__supabase__list_migrations`.

Expected: the list now includes a migration named `facebook_connections_per_user` (timestamp will be the apply time, that's fine).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260429000000_facebook_connections.sql
git commit -m "feat(db): per-user facebook connections schema + RLS

Each user owns one facebook_connections row and the facebook_pages
underneath it. Admin/superadmin retain full access for support.
page_assignments is removed; ownership is now direct via user_id."
```

---

### Task 3: Final cross-check

- [ ] **Step 1: Confirm git is clean and the branch state is correct**

Run:

```bash
git status
git log --oneline -5
```

Expected: working tree clean; the last two commits are the chore (Task 1) and feat (Task 2) above, in that order.

- [ ] **Step 2: Spot-check that no other migration references the dropped `page_assignments` table**

Run:

```bash
rg 'page_assignments' supabase/ docs/ src/ 2>&1 | head -20
```

Expected: matches only inside `docs/superpowers/specs/2026-04-29-facebook-connections-per-user-design.md` (where it's referenced as "removed"). No matches in `supabase/` or `src/`. If anything else turns up, investigate.

---

## Done When

- The stale `20260428200000_facebook_connections.sql` is gone from the repo.
- `20260429000000_facebook_connections.sql` exists locally and has been applied remotely.
- Remote `list_tables` shows the three new tables with RLS on, and no `page_assignments`.
- `pg_policies` shows the six expected policies.
- Both commits are on `main` (or the active branch) with a clean working tree.
