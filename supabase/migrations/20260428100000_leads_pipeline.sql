-- =========================================================================
-- Leads pipeline: pipeline_stages, leads, lead_field_defs (per-user)
-- =========================================================================

create extension if not exists pg_trgm;

create table public.pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  description text,
  position    integer not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index pipeline_stages_user_position_idx
  on public.pipeline_stages (user_id, position);

create unique index pipeline_stages_one_default_per_user
  on public.pipeline_stages (user_id) where is_default;

create table public.lead_field_defs (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  key       text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label     text not null check (char_length(label) between 1 and 60),
  type      text not null check (type in ('text','number','date','select')),
  options   jsonb,
  position  integer not null,
  created_at timestamptz not null default now(),
  unique (user_id, key)
);

create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  stage_id        uuid not null references public.pipeline_stages(id) on delete restrict,
  name            text not null check (char_length(name) between 1 and 120),
  email           text,
  phone           text,
  company         text,
  job_title       text,
  source          text,
  estimated_value numeric(12,2),
  notes           text,
  custom_fields   jsonb not null default '{}'::jsonb,
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index leads_user_stage_position_idx
  on public.leads (user_id, stage_id, position);
create index leads_user_created_at_idx
  on public.leads (user_id, created_at desc);
create index leads_search_trgm_idx
  on public.leads using gin (
    (coalesce(name,'') || ' ' || coalesce(email,'') || ' ' ||
     coalesce(phone,'') || ' ' || coalesce(company,'')) gin_trgm_ops
  );

-- updated_at trigger (reuse existing public.set_updated_at)
create trigger leads_set_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

-- RLS
alter table public.pipeline_stages enable row level security;
alter table public.lead_field_defs enable row level security;
alter table public.leads           enable row level security;

create policy pipeline_stages_owner_all on public.pipeline_stages
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy lead_field_defs_owner_all on public.lead_field_defs
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy leads_owner_all on public.leads
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
