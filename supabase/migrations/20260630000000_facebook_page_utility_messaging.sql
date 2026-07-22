-- =========================================================================
-- Per-page pages_utility_messaging capability flag
-- =========================================================================
-- `pages_utility_messaging` gates the Message Templates API (creating/sending
-- UTILITY templates). It is granted per PAGE, not per app: Meta grants it
-- immediately to app admins/testers/developers but withholds it for other
-- owners' pages until App Review passes. `/me/permissions` is user-token scoped
-- and cannot answer this per page, so we probe the templates endpoint with each
-- page's own token at connect/save time and cache the result here.
--
--   true  -> permission usable (probe succeeded)
--   false -> Meta returned the permission error (code 200 / HTTP 403)
--   null  -> unknown (never probed, or the probe failed for an unrelated reason)
--
-- The settings page reads this to flag pages that will fail a template submit,
-- BEFORE the operator discovers it the hard way.
-- =========================================================================

alter table public.facebook_pages
  add column if not exists utility_messaging_ok boolean;

comment on column public.facebook_pages.utility_messaging_ok is
  'Per-page pages_utility_messaging capability from the last connect-time probe: '
  'true = usable, false = withheld by Meta (needs reconnect/App Review), null = unknown.';
