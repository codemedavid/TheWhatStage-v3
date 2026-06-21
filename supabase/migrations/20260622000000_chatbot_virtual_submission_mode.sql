-- =========================================================================
-- Chatbot: virtual-submission mode.
--
-- Adds a per-tenant setting controlling how the bot reacts when it detects
-- "proceed intent" in a Messenger conversation (e.g. "Kayo na po bahala",
-- "Check niyo na lang po page namin") WITHOUT the customer filling an action
-- page form. See src/lib/chatbot/virtual-submission.ts.
--
--   off     = never record a chat-implied submission
--   suggest = record the submission as an operator review flag (no stage move)
--   auto    = record AND advance the lead's stage forward
--
-- Default 'suggest' (the product-chosen default): existing tenants begin
-- surfacing chat-implied submissions for review, but the bot never silently
-- advances a stage from a fuzzy phrase. Additive + idempotent — safe on a
-- populated production database.
-- =========================================================================

alter table public.chatbot_configs
  add column if not exists virtual_submission_mode text not null default 'suggest';

-- Constrain to the known modes. Dropped-and-recreated so re-running the
-- migration (history reconcile) never errors on a duplicate constraint.
alter table public.chatbot_configs
  drop constraint if exists chatbot_configs_virtual_submission_mode_check;

alter table public.chatbot_configs
  add constraint chatbot_configs_virtual_submission_mode_check
  check (virtual_submission_mode in ('off', 'suggest', 'auto'));
