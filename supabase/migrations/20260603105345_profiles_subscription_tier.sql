-- =========================================================================
-- WhatStage University — subscription tier on profiles
--
-- Adds a forward-compatible `subscription_tier` ('free' | 'pro') to profiles.
-- Today it is toggled manually by a superadmin (see /api/superadmin/users/[id]/tier);
-- when real billing ships it writes this same column — no rework.
--
-- "Subscriber" (the University access tier) == subscription_tier = 'pro'
--   OR role in ('admin','superadmin). See public.is_subscriber() below and
--   src/lib/university/access.ts (the two MUST agree — pinned by a vitest test).
-- =========================================================================

create type public.subscription_tier as enum ('free', 'pro');

alter table public.profiles
  add column subscription_tier public.subscription_tier not null default 'free';

create index if not exists profiles_subscription_tier_idx
  on public.profiles (subscription_tier);

-- -------------------------------------------------------------------------
-- Re-create the self-update lock so a user CANNOT self-grant 'pro'.
-- The current policy (20260605000000_profiles_lock_self_update.sql) pins
-- id/email/role/status. We must additionally pin subscription_tier.
-- -------------------------------------------------------------------------
drop policy if exists profiles_update_self_safe_fields on public.profiles;

create policy profiles_update_self_safe_fields
on public.profiles
for update
to authenticated
using ( id = auth.uid() )
with check (
  id = auth.uid()
  and id                = (select id                from public.profiles where id = auth.uid())
  and email             = (select email             from public.profiles where id = auth.uid())
  and role              = (select role              from public.profiles where id = auth.uid())
  and status            = (select status            from public.profiles where id = auth.uid())
  and subscription_tier = (select subscription_tier from public.profiles where id = auth.uid())
);

-- -------------------------------------------------------------------------
-- is_subscriber(): the single source of truth for the "subscriber" tier,
-- callable from RLS / RPCs. Reads profiles LIVE (subscription_tier is NOT in
-- the JWT — custom_access_token_hook only injects role), so a tier change
-- takes effect immediately with no token refresh.
-- -------------------------------------------------------------------------
create or replace function public.is_subscriber()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (p.subscription_tier = 'pro' or p.role in ('admin', 'superadmin'))
  );
$$;

revoke all on function public.is_subscriber() from public;
grant execute on function public.is_subscriber() to anon, authenticated;
