-- supabase/migrations/20260607000300_messenger_threads_attached_item_keys.sql
-- Per-thread first-mention dedup keys for the source-image auto-attach
-- pipeline. Each key is shaped as "<source>:<id>", e.g. "product:abc",
-- "property:p-xyz", "sales:<action_page_id>", "payment:m-789". The worker
-- FIFO-trims to 100 entries to bound growth on long-lived threads.

alter table public.messenger_threads
  add column if not exists attached_item_keys text[] not null default '{}';
