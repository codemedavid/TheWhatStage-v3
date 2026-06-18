-- =========================================================================
-- Projects (deals/opportunities): a piece of work created FOR a customer
-- (lead), optionally born from an action-page submission. A lead can have
-- many projects. Each project carries a monetary value, lives on its own
-- per-user Kanban board (project_stages — kept separate from the lead-nurture
-- pipeline_stages to avoid the "stage" terminology collision), and holds
-- AI instructions that steer both the live chatbot and proactive follow-ups.
--
-- Tables: project_stages, projects, project_stage_events (append-only audit).
-- Follow-up sequence tables live in the companion migration
-- (20260618000100_project_sequences.sql).
-- =========================================================================

-- 1. project_stages — per-user project board columns. Mirrors pipeline_stages.
create table public.project_stages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  description text check (char_length(description) <= 500),
  position    integer not null,
  is_default  boolean not null default false,
  -- 'won'/'lost' carry win-loss semantics for value reporting; 'open' (or null)
  -- is an in-progress column. Default project stages seeded lazily in app code.
  kind        text check (kind in ('open','won','lost')),
  color       text check (char_length(color) <= 32),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index project_stages_user_position_idx
  on public.project_stages (user_id, position);

create unique index project_stages_one_default_per_user
  on public.project_stages (user_id) where is_default;

-- 2. projects — the deal/opportunity. lead_id is required ("a project for the
--    customer"); origin_submission_id is optional (manual projects allowed).
create table public.projects (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id)             on delete cascade,
  lead_id              uuid not null references public.leads(id)           on delete cascade,
  origin_submission_id uuid references public.action_page_submissions(id) on delete set null,
  stage_id             uuid not null references public.project_stages(id)  on delete restrict,

  title           text not null check (char_length(title) between 1 and 160),
  description     text check (char_length(description) <= 4000),
  value           numeric(12,2) check (value >= 0),
  currency        text not null default 'PHP' check (char_length(currency) = 3),
  -- Per-customer alignment: what the AI should know/say about THIS project.
  -- Injected into the live chatbot prompt and the follow-up draft prompt.
  ai_instructions text check (char_length(ai_instructions) <= 4000),
  notes           text check (char_length(notes) <= 4000),
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index projects_user_stage_position_idx
  on public.projects (user_id, stage_id, position);
create index projects_user_created_at_idx
  on public.projects (user_id, created_at desc);
-- Active-project resolution looks up by lead, newest first.
create index projects_lead_updated_idx
  on public.projects (lead_id, updated_at desc);
create index projects_origin_submission_idx
  on public.projects (origin_submission_id) where origin_submission_id is not null;
create index projects_search_trgm_idx
  on public.projects using gin (
    (coalesce(title,'') || ' ' || coalesce(description,'')) gin_trgm_ops
  );

-- 3. project_stage_events — append-only audit of stage transitions. Mirrors
--    lead_stage_events; used for the project timeline + value reporting.
create table public.project_stage_events (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  from_stage_id uuid references public.project_stages(id) on delete set null,
  to_stage_id   uuid references public.project_stages(id) on delete set null,
  source        text not null check (source in ('user','ai','workflow')),
  reason        text,
  created_at    timestamptz not null default now()
);

create index project_stage_events_project_idx
  on public.project_stage_events (project_id, created_at);

-- 4. updated_at triggers (reuse the global public.set_updated_at).
create trigger project_stages_set_updated_at
  before update on public.project_stages
  for each row execute function public.set_updated_at();

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- 5. RLS — per-user owner isolation (no multi-tenancy in this app).
alter table public.project_stages       enable row level security;
alter table public.projects             enable row level security;
alter table public.project_stage_events enable row level security;

create policy project_stages_owner_all on public.project_stages
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy projects_owner_all on public.projects
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy project_stage_events_owner_read on public.project_stage_events
  for select to authenticated
  using (user_id = auth.uid());

create policy project_stage_events_owner_insert on public.project_stage_events
  for insert to authenticated
  with check (user_id = auth.uid());
