-- =========================================================================
-- generation_jobs: durable status + result for onboarding AI generations.
-- One row per (profile_id, kind). Lifecycle: queued -> running -> done|failed.
-- Writes are server-side only (admin client). Owners can read their own rows.
-- =========================================================================

create type onboarding_generation_kind as enum
  ('knowledge', 'faqs', 'personality_seed', 'form_fields', 'bot_instructions');

create type onboarding_generation_status as enum
  ('queued', 'running', 'done', 'failed');

create table public.generation_jobs (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  kind        onboarding_generation_kind not null,
  status      onboarding_generation_status not null default 'queued',
  input_hash  text not null,
  result      jsonb,
  error       text,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (profile_id, kind)
);

create index generation_jobs_profile_status_idx
  on public.generation_jobs (profile_id, status);

create trigger generation_jobs_set_updated_at
  before update on public.generation_jobs
  for each row execute function public.set_updated_at();

alter table public.generation_jobs enable row level security;

create policy generation_jobs_select_own on public.generation_jobs
  for select using (profile_id = auth.uid());
