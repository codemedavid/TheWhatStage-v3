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
