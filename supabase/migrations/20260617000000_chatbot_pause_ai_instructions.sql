-- =========================================================================
-- AI auto-pause instructions: per-user rules that tell the bot WHEN to stop
-- replying and hand the conversation off to a human. Injected into the system
-- prompt (so the model is aware) and surfaced to the classifier as a structured
-- `pause` decision. When the model decides to pause, the worker stamps the
-- existing messenger_threads.bot_paused_until using human_takeover_minutes —
-- reusing the human-takeover pause window so no new pause-state machine is
-- introduced.
-- =========================================================================

alter table public.chatbot_configs
  add column if not exists pause_ai_instructions text not null default '';

comment on column public.chatbot_configs.pause_ai_instructions is
  'Free-form rules describing when the bot should pause itself and hand off to a human (e.g. "pause if the customer asks for a person, is angry, or mentions a refund over 5000"). Injected into the system prompt as the "# Auto-Pause Rules" block and gates the classifier''s structured `pause` output. Empty string = feature off (no schema field, no prompt block). Pause duration reuses human_takeover_minutes.';
