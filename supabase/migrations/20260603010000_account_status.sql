-- =========================================================================
-- Account status: superadmin-controlled lifecycle for user accounts.
-- New signups land as 'pending'. Superadmin flips to 'active' to grant
-- access. 'paused' blocks login AND the Messenger bot (webhook checks).
-- =========================================================================

create type public.account_status as enum ('pending', 'active', 'paused');

alter table public.profiles
  add column status public.account_status not null default 'pending';

-- Backfill: every existing user is already trusted.
update public.profiles set status = 'active' where status = 'pending';

-- Index for the webhook hot path (lookup by page → user → status).
create index if not exists profiles_status_idx on public.profiles (status);

-- New signups should land as 'pending', not auto-active.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'New user'),
    'user',
    'pending'
  );
  return new;
end;
$$;
