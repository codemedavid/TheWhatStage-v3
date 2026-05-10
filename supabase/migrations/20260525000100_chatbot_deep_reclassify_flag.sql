alter table public.chatbot_configs
  add column if not exists deep_reclassify_enabled boolean not null default false;

comment on column public.chatbot_configs.deep_reclassify_enabled is
  'When true, the messenger worker fires a deeper stage re-evaluation pass every 10 inbound customer messages.';
