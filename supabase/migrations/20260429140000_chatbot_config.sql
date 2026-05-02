-- =========================================================================
-- Single chatbot configuration per user. Drives the system prompt assembled
-- in src/lib/rag/prompt-builder.ts.
-- =========================================================================

create table public.chatbot_configs (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  name             text not null default 'Assistant',
  persona          text not null default '',
  do_rules         text[] not null default '{}',
  dont_rules       text[] not null default '{}',
  fallback_message text not null default 'Sorry, wala akong info diyan. Pwede kong i-check sa owner para sa''yo.',
  temperature      real not null default 0.4 check (temperature >= 0 and temperature <= 1),
  max_context      int  not null default 12 check (max_context between 1 and 40),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.chatbot_configs enable row level security;

create policy "chatbot_configs_select_own" on public.chatbot_configs
  for select using (auth.uid() = user_id);
create policy "chatbot_configs_insert_own" on public.chatbot_configs
  for insert with check (auth.uid() = user_id);
create policy "chatbot_configs_update_own" on public.chatbot_configs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "chatbot_configs_delete_own" on public.chatbot_configs
  for delete using (auth.uid() = user_id);

create trigger chatbot_configs_set_updated_at
  before update on public.chatbot_configs
  for each row execute function public.set_updated_at();
