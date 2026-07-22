-- =========================================================================
-- Split messages: let the bot reply in several human-like chat bubbles
-- =========================================================================
-- Two additive, per-tenant columns on chatbot_configs:
--
--   1. split_messages_enabled — when true, the Messenger worker splits a single
--      generated reply into a small ordered list of bubbles (greeting first,
--      then the follow-up question) via segmentReply(), pacing them with a
--      typing indicator + short delay so the bot reads like a human. Default
--      FALSE: existing tenants keep the current single-bubble behaviour until
--      an operator opts in from the chatbot settings page.
--
--   2. split_max_bubbles — hard cap on bubbles per reply. Default 3. Clamped to
--      [2, 5] in app code (rowToConfig / setSplitMessageSettings).
--
-- Both use `if not exists` so a re-run (or a db push against a remote where the
-- history row is missing) is idempotent and safe.
-- =========================================================================

alter table public.chatbot_configs
  add column if not exists split_messages_enabled boolean not null default false;

alter table public.chatbot_configs
  add column if not exists split_max_bubbles integer not null default 3;
