-- Add free-form instructions field to chatbot config
alter table public.chatbot_configs
  add column if not exists instructions text not null default '';

-- Add rolling conversation summary to messenger threads
-- Updated after replies when history is long; injected into prompt as earlier context
alter table public.messenger_threads
  add column if not exists conversation_summary text;