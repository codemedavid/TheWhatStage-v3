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

comment on column public.messenger_threads.bot_paused_until is
  'Auto-pause expiry timestamp set when operator replies. NULL = not paused; past timestamp = expired. Webhook + worker treat bot_paused_until > now() as equivalent to auto_reply_enabled = false for reactive replies only. Independent from the sticky manual toggle.';

comment on column public.chatbot_configs.human_takeover_minutes is
  'Pause duration (minutes) when operator takes over. Range 0-1440 (24h). Default 60. Set to 0 to disable auto-takeover.';

comment on index public.messenger_threads_bot_paused_until_idx is
  'Partial index on active pause windows. Webhook gates every inbound message on this (hot path). WHERE clause excludes NULL (not paused) and past timestamps (expired) to minimize index bloat.';
