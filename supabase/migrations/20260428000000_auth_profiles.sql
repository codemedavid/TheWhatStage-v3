-- =========================================================================
-- Auth & roles foundation
-- =========================================================================

create type public.user_role as enum ('user', 'admin', 'superadmin');

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null check (char_length(full_name) between 1 and 80),
  role        public.user_role not null default 'user',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Helper: current_role() reads role from JWT claim
create or replace function public.current_role()
returns public.user_role
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'role', '')::public.user_role,
    'user'::public.user_role
  );
$$;

-- Auto-create profile when a user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'New user'),
    'user'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Custom access token hook — injects role into JWT app_metadata.role
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims    jsonb := event -> 'claims';
  meta      jsonb;
  user_role public.user_role;
begin
  select role into user_role
  from public.profiles
  where id = (event ->> 'user_id')::uuid;

  if user_role is null then
    user_role := 'user';
  end if;

  meta := coalesce(claims -> 'app_metadata', '{}'::jsonb);
  meta := jsonb_set(meta, '{role}', to_jsonb(user_role::text));
  claims := jsonb_set(claims, '{app_metadata}', meta);

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- Row-Level Security
alter table public.profiles enable row level security;

create policy profiles_select_self_or_superadmin
on public.profiles
for select
to authenticated
using ( id = auth.uid() or public.current_role() = 'superadmin' );

create policy profiles_update_self_no_role_change
on public.profiles
for update
to authenticated
using ( id = auth.uid() )
with check (
  id = auth.uid()
  and role = (select role from public.profiles where id = auth.uid())
);

create policy profiles_update_superadmin
on public.profiles
for update
to authenticated
using ( public.current_role() = 'superadmin' )
with check ( public.current_role() = 'superadmin' );

-- No INSERT or DELETE policies → blocked for authenticated/anon.
-- INSERT happens via security-definer trigger; DELETE via on-delete cascade.
