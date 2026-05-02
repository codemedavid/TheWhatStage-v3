-- =========================================================================
-- AI-driven stage classification: per-user opt-in toggle, per-thread debounce
-- counter, and a stage-event audit log used for UI display + Undo.
-- =========================================================================

alter table public.chatbot_configs
  add column if not exists auto_classify_enabled boolean not null default false;

alter table public.messenger_threads
  add column if not exists inbound_since_classify integer not null default 0;

create table if not exists public.lead_stage_events (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.leads(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  from_stage_id  uuid references public.pipeline_stages(id) on delete set null,
  to_stage_id    uuid references public.pipeline_stages(id) on delete set null,
  source         text not null check (source in ('ai','user')),
  reason         text,
  confidence     text check (confidence in ('low','medium','high')),
  thread_id      uuid references public.messenger_threads(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists lead_stage_events_lead_idx
  on public.lead_stage_events (lead_id, created_at);

alter table public.lead_stage_events enable row level security;

create policy lead_stage_events_owner_read on public.lead_stage_events
  for select to authenticated
  using (user_id = auth.uid());

create policy lead_stage_events_owner_insert on public.lead_stage_events
  for insert to authenticated
  with check (user_id = auth.uid());
