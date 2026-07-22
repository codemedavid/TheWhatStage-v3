-- =========================================================================
-- Structured messages + operator-managed reply length
-- =========================================================================
-- Four additive, per-tenant columns on chatbot_configs:
--
--   1. structured_messages_enabled — when true, the reply-generation prompt is
--      given stairway / 1-3-1 formatting guidance so the bot structures replies
--      with intentional line breaks (each option/idea on its own line) instead
--      of one paragraph. Default FALSE: existing tenants keep the current
--      single-paragraph behaviour until an operator opts in.
--
--   2. structured_message_layout — how a structured reply is delivered:
--        'single'  = one Messenger message with line breaks preserved
--        'bubbles' = one paced chat bubble per line (via splitStructuredLines)
--      Default 'single'. Coerced to 'single' for any unknown value in app code.
--
--   3. reply_length_limit_enabled — whether the reply-length HARD RULE is
--      injected into the system prompt. Default TRUE, preserving the previous
--      hardcoded "1 to 2 short sentences" behaviour. FALSE lets the bot reply at
--      a natural length.
--
--   4. reply_max_sentences — the sentence cap used when the limit is on.
--      Default 2 (byte-identical to the old hardcoded rule). Clamped to [1, 6]
--      in app code (rowToConfig / setStructuredMessageSettings).
--
-- All use `if not exists` so a re-run (or a db push against a remote where the
-- history row is missing) is idempotent and safe.
-- =========================================================================

alter table public.chatbot_configs
  add column if not exists structured_messages_enabled boolean not null default false;

alter table public.chatbot_configs
  add column if not exists structured_message_layout text not null default 'single';

alter table public.chatbot_configs
  add column if not exists reply_length_limit_enabled boolean not null default true;

alter table public.chatbot_configs
  add column if not exists reply_max_sentences integer not null default 2;

-- Guardrail: keep the layout column to the two known values. Dropped-and-added
-- so a re-run stays idempotent even if a prior run created it.
alter table public.chatbot_configs
  drop constraint if exists chatbot_configs_structured_message_layout_check;

alter table public.chatbot_configs
  add constraint chatbot_configs_structured_message_layout_check
  check (structured_message_layout in ('single', 'bubbles'));
