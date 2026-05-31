-- =========================================================================
-- Action Pages: concurrency guards
--
-- Additive, idempotent hardening for two race conditions in the public
-- submit path. Safe to run against a populated production database — this
-- migration only CREATEs indexes IF NOT EXISTS and never drops, alters,
-- truncates, deletes, or rewrites any existing data.
-- =========================================================================

-- -------------------------------------------------------------------------
-- FIX 1 — Idempotency double-insert race.
--
-- submit/route.ts dedupes retries by checking meta->>'idempotency_key'
-- before inserting, but with no DB-level uniqueness two concurrent retries
-- can both pass the SELECT and double-insert. This partial unique index makes
-- the database the source of truth: the second concurrent insert fails with
-- 23505, which the route catches and treats as a successful replay.
--
-- Partial (WHERE ... is not null) so legacy/non-idempotent submissions, which
-- carry no idempotency_key, are unaffected and can coexist freely.
-- -------------------------------------------------------------------------
create unique index if not exists action_page_submissions_idempotency_key_uidx
  on public.action_page_submissions ((meta->>'idempotency_key'))
  where meta->>'idempotency_key' is not null;

-- -------------------------------------------------------------------------
-- FIX 2 — Double-booking. INTENTIONALLY NOT ENFORCED WITH A UNIQUE INDEX.
--
-- A naive partial unique index on
--   (action_page_id, (data->>'slot_iso')) where outcome = 'booked'
-- would enforce AT MOST ONE booking per slot. That is WRONG for this feature:
-- the booking config exposes `slots_per_window` (see
-- src/app/a/[slug]/_kinds/booking/schema.ts — integer, min 1, max 50,
-- default 1), so a single slot_iso may legitimately accept up to
-- `slots_per_window` concurrent bookings. A blanket unique index would reject
-- the 2nd..Nth legitimate booking and break every page configured with
-- capacity > 1.
--
-- Capacity is a per-page, config-driven count that cannot be expressed as a
-- static SQL UNIQUE constraint (the limit lives in action_pages.config, not in
-- a column on the submissions row), so it is enforced at read time by the
-- /api/action-pages/[slug]/slots endpoint, which counts existing 'booked'
-- submissions per slot and hides slots that have reached capacity.
--
-- Therefore no booking uniqueness index is added here. Correctness over
-- completeness: shipping a constraint that rejects within-capacity bookings
-- would be a regression. If capacity is ever promoted to a real column on the
-- submissions row, a capacity-aware exclusion constraint could be revisited.
-- -------------------------------------------------------------------------
