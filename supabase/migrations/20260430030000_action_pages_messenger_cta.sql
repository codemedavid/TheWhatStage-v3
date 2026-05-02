-- =========================================================================
-- Action Pages — Messenger CTA + bot send instructions
--
-- Adds two fields to action_pages so the chatbot can autonomously send a
-- published action page to a Messenger lead as a button:
--
--   cta_label             — short button label (≤50 chars). Shown as the CTA
--                           on the Messenger button template.
--   bot_send_instructions — natural-language guidance for the bot describing
--                           when this action page should be sent (e.g.
--                           "Send when the lead asks for pricing or to book
--                           a demo"). Injected into the system prompt so the
--                           combined classify call can pick at most one
--                           action page per reply.
-- =========================================================================

alter table public.action_pages
  add column cta_label text
    check (cta_label is null or char_length(cta_label) between 1 and 50);

alter table public.action_pages
  add column bot_send_instructions text
    check (bot_send_instructions is null or char_length(bot_send_instructions) <= 2000);
