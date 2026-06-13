-- =========================================================================
-- WS3 — per-user soft-cap override.
--
-- billing_plans.included_tokens is the per-tier soft cap. This optional column
-- lets a superadmin override the cap for a single tenant (e.g. a temporary bump)
-- without inventing a new tier. NULL = use the tier's cap. Display-only, like the
-- rest of the quota story — nothing is ever blocked.
--
-- The self-update RLS lock must pin this column too, or a tenant could raise
-- their own cap. We re-create profiles_update_self_safe_fields (last set in
-- 20260603105345) adding the new pin.
-- =========================================================================

alter table public.profiles
  add column if not exists included_tokens_override bigint;

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
  and included_tokens_override is not distinct from
      (select included_tokens_override from public.profiles where id = auth.uid())
);
