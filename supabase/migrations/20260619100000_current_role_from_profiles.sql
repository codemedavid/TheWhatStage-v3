-- Fix: current_role() must resolve the app role from profiles.role, not the JWT
-- claim. `app_metadata.role` is never populated anywhere in the app, so the old
-- JWT-based implementation always returned 'user' — silently breaking every
-- superadmin-gated RPC (admin_usage_*) and RLS policy across ~15 tables. The
-- admin dashboard therefore showed zero usage despite a full ledger.
--
-- profiles.role is the single source of truth the app already trusts
-- (getSession/requireSuperadmin read it live). Resolving from profiles also lets
-- demotions take effect immediately, with no token-refresh dependency.
--
-- SECURITY DEFINER is REQUIRED: this function is called inside RLS policies on
-- public.profiles itself; running as the definer bypasses RLS and prevents
-- infinite policy recursion. search_path is pinned for the same safety reason.
create or replace function public.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role from public.profiles p where p.id = auth.uid()),
    'user'::public.user_role
  );
$$;
