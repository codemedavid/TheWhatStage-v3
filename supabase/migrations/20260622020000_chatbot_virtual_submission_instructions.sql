-- =========================================================================
-- Chatbot: chat-implied submission instructions.
--
-- Adds a per-tenant free-form instruction field that guides how the bot
-- handles chat-implied ("virtual") submissions (see
-- src/lib/chatbot/virtual-submission.ts and classify.ts):
--   - what useful info to note from the conversation (e.g. contact number,
--     business name, what they're looking for), captured PASSIVELY from what
--     the customer already shared, and
--   - how to acknowledge once the submission is recorded (e.g. "Ok po,
--     ipo-process na po namin 'to").
--
-- Default '' (no extra guidance) so existing tenants are unaffected. Only
-- meaningful when virtual_submission_mode is 'suggest' or 'auto'. Additive +
-- idempotent — safe on a populated production database and safe to re-run on a
-- migration-history reconcile.
-- =========================================================================

alter table public.chatbot_configs
  add column if not exists virtual_submission_instructions text not null default '';
