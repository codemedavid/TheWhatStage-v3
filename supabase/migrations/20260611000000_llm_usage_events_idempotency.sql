-- =========================================================================
-- Usage ledger hardening (WS1): idempotency + unpriced-model marker.
--
-- 1. event_key — a per-turn idempotency token (`<inbound_msg_id|job_id>:<scope>`)
--    set by recordUsage(). A unique index dedupes retried/requeued worker jobs so
--    the same model call is never billed twice. NULLs are distinct in a Postgres
--    unique index, so legacy / un-keyed rows still insert freely (no dedup) —
--    keeping the table append-only for callers that don't pass a key.
--
-- 2. priced — false when cost_micros fell back to $0 because the model had no
--    price entry (pricing.ts). Makes a $0 config-regression row distinguishable
--    from a genuine $0 and back-fillable once a rate is set. cost_micros stays
--    frozen; corrections land via usage_adjustments (WS3), never by rewriting.
--
-- Purely additive + forward-only: existing rows get event_key = NULL and
-- priced = true (the historical assumption). No backfill of past dedup is possible.
-- =========================================================================

alter table public.llm_usage_events
  add column if not exists event_key text,
  add column if not exists priced    boolean not null default true;

-- Unique on event_key; multiple NULLs allowed (NULLs distinct) so un-keyed rows
-- never collide. recordUsage upserts with on-conflict-do-nothing on this index.
create unique index if not exists llm_usage_events_event_key_key
  on public.llm_usage_events (event_key);
