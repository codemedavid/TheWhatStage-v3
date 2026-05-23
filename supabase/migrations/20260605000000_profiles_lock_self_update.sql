-- =========================================================================
-- Harden profiles self-update RLS.
--
-- Prior policy `profiles_update_self_no_role_change` locked `role` but left
-- `status`, `email`, and `id` mutable by the row owner. A pending user with
-- a valid session could call
--   supabase.from('profiles').update({ status: 'active' }).eq('id', myId)
-- and bypass the manual-approval gate. Same risk for impersonating another
-- email or rebinding id. Only superadmin should change those fields.
--
-- Drop the old policy and replace it with one that pins id/email/role/status
-- to their current values; users may only update presentational fields
-- (currently `full_name`; `dismissed_stage_upgrade_*` were added in a later
-- migration but use existing policies).
-- =========================================================================

drop policy if exists profiles_update_self_no_role_change on public.profiles;

create policy profiles_update_self_safe_fields
on public.profiles
for update
to authenticated
using ( id = auth.uid() )
with check (
  id = auth.uid()
  and id     = (select id     from public.profiles where id = auth.uid())
  and email  = (select email  from public.profiles where id = auth.uid())
  and role   = (select role   from public.profiles where id = auth.uid())
  and status = (select status from public.profiles where id = auth.uid())
);
