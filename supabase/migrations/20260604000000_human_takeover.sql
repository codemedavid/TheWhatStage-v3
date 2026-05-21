-- =========================================================================
-- Human takeover: auto-pause the reactive bot when the operator replies in
-- the Conversation panel. Resumes after configurable operator inactivity.
-- =========================================================================

-- Per-thread pause stamp. NULL = not auto-paused. Past timestamp = pause
-- expired (treated as NULL by the gating check). Independent from the
-- existing sticky auto_reply_enabled flag — both can be set, and the manual
-- toggle wins.
alter table public.messenger_threads
  add column bot_paused_until timestamptz;

-- Per-user pause duration in minutes. 0 disables auto-takeover entirely.
-- Default 60 = one hour, matches the design discussion.
alter table public.chatbot_configs
  add column human_takeover_minutes integer not null default 60
    check (human_takeover_minutes >= 0 and human_takeover_minutes <= 1440);

-- Partial index on the hot read: webhook gates every inbound message on this.
-- Only paused-future rows are interesting; we don't index NULL or past values.
create index if not exists messenger_threads_bot_paused_until_idx
  on public.messenger_threads (bot_paused_until)
  where bot_paused_until is not null;
