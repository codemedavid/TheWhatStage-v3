-- =========================================================================
-- Seed-once marker for default message templates.
--
-- loadTemplates() previously seeded the default templates whenever a user had
-- ZERO templates (count === 0). That meant a user who deleted all of their
-- templates would have the defaults silently re-seeded on their next visit —
-- deletions never "stuck". This column records that we've seeded once; the
-- loader seeds only when it IS NULL and stamps it, so deletions persist.
--
-- Not added to the profiles_update_self_safe_fields pin list: it's a harmless
-- per-user marker, and loadTemplates() stamps it through the user-scoped client.
-- =========================================================================

alter table public.profiles
  add column if not exists templates_seeded_at timestamptz;
