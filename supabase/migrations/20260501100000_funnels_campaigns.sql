-- =========================================================================
-- Funnels feature.
--
-- A `campaign` is a top-level container the chatbot can run for a lead.
-- It owns one personality (either a reference to the user's chatbot config
-- or an inline override) and a goal action page used for conversion math.
--
-- A `funnel` is an ordered node inside a campaign. Each funnel can require
-- a set of questions to be answered (saved into leads.custom_fields by
-- lead_field_key), enforce a small set of do/dont rules layered on top of
-- the personality, and play a flow of messages/images/pitches before
-- sending its terminal action page (or simply chaining to the next funnel).
--
-- Runtime selection (which campaign a lead is on, where in the flow they
-- are, dropoff detection) lives in a follow-up migration. This one owns
-- the storage shape, RLS, and the global dropoff knob.
-- =========================================================================

create table public.campaigns (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  name                     text not null check (char_length(name) between 1 and 120),
  description              text check (description is null or char_length(description) <= 2000),
  enabled                  boolean not null default true,
  status                   text not null default 'draft'
                             check (status in ('draft','active','paused','archived')),
  assignment_mode          text not null default 'manual'
                             check (assignment_mode in ('manual','random')),
  weight                   integer not null default 1
                             check (weight between 0 and 100),
  personality_mode         text not null default 'chatbot'
                             check (personality_mode in ('chatbot','custom')),
  persona                  text not null default '',
  do_rules                 text[] not null default '{}',
  dont_rules               text[] not null default '{}',
  goal_action_page_id      uuid references public.action_pages(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index campaigns_user_idx
  on public.campaigns (user_id, updated_at desc);

create index campaigns_user_enabled_idx
  on public.campaigns (user_id, enabled, status)
  where enabled = true;

create trigger campaigns_set_updated_at
before update on public.campaigns
for each row execute function public.set_updated_at();

-- =========================================================================
-- Funnels — ordered nodes inside a campaign. position is unique per
-- campaign for stable ordering; next_funnel_id is an explicit pointer that
-- runtime can use to chain transitions independently of position.
-- =========================================================================

create table public.funnels (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references public.campaigns(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 120),
  description     text check (description is null or char_length(description) <= 2000),
  position        integer not null default 0,
  -- requirements: array of { key, label, question, lead_field_key, required }
  --   key            — stable identifier within this funnel
  --   label          — short human label for the answer (shown in dashboards)
  --   question       — what the bot will ask the lead
  --   lead_field_key — which leads.custom_fields key to write the answer to
  --   required       — gate the action page on this being answered
  requirements    jsonb not null default '[]'::jsonb,
  -- rules: array of { kind: 'do'|'dont', text }
  --   layered on top of the campaign personality at runtime
  rules           jsonb not null default '[]'::jsonb,
  -- flow: array of { type: 'message'|'image'|'pitch', content, delay_seconds? }
  --   played in order between requirement Q&A and the action page send
  flow            jsonb not null default '[]'::jsonb,
  action_page_id  uuid references public.action_pages(id) on delete set null,
  next_funnel_id  uuid references public.funnels(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (campaign_id, position)
);

create index funnels_campaign_idx
  on public.funnels (campaign_id, position);

create index funnels_user_idx
  on public.funnels (user_id, updated_at desc);

create trigger funnels_set_updated_at
before update on public.funnels
for each row execute function public.set_updated_at();

-- =========================================================================
-- Global dropoff window. When a lead in an active campaign hasn't
-- progressed within this many minutes, runtime will mark them stalled.
-- =========================================================================

alter table public.chatbot_configs
  add column if not exists funnel_dropoff_minutes integer not null default 120
  check (funnel_dropoff_minutes between 5 and 10080);

-- =========================================================================
-- RLS — owners read/write their own campaigns and funnels.
-- =========================================================================

alter table public.campaigns enable row level security;
alter table public.funnels   enable row level security;

create policy campaigns_owner_all on public.campaigns
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy funnels_owner_all on public.funnels
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
