-- =========================================================================
-- Chatbot: in-chat fill-up fallback template.
--
-- Adds a per-tenant free-form template the bot sends in chat when the
-- action-page button CANNOT be delivered (Meta policy block, no deliverable
-- card). Instead of leaving the customer with a button-less promise ("fill up
-- the form sa baba" with no form), the bot asks them to type their details in
-- chat; the reply flows into a chat-implied submission (see
-- src/lib/chatbot/virtual-submission.ts and the messenger worker).
--
-- Default '' (no in-chat fallback → button-only) so existing tenants are
-- unaffected. Additive + idempotent — safe on a populated production database
-- and safe to re-run on a migration-history reconcile.
-- =========================================================================

alter table public.chatbot_configs
  add column if not exists chat_fillup_template text not null default '';
