-- =========================================================================
-- WhatStage University — schema (courses, lessons, protected sources, progress)
--
-- Access model (enforced at BOTH the DB and the app layer):
--   course.access_level  public | authenticated | subscriber   (per course)
--   lesson.is_preview    true => playable by anyone even in a gated course
--
-- THE SECURITY SPINE — table split:
--   * university_lessons         : public-safe metadata (title, provider, duration,
--                                  position, is_preview). Readable for PUBLISHED courses
--                                  so the curriculum can show LOCKED lesson titles.
--   * university_lesson_sources  : the playable identity (provider id / hash / imagekit
--                                  path). RLS enabled + ZERO policies + grants revoked,
--                                  so NO client can ever read it. The only read path is
--                                  the security-definer RPC public.get_lesson_playback()
--                                  (migration 20260610000200), which re-checks entitlement
--                                  inside the DB.
-- =========================================================================

create type public.university_access_level  as enum ('public', 'authenticated', 'subscriber');
create type public.university_course_status as enum ('draft', 'published', 'archived');
create type public.university_video_provider as enum ('youtube', 'vimeo', 'loom', 'imagekit');

-- -------------------------------------------------------------------------
-- Categories (superadmin-managed; seeded with a few defaults below)
-- -------------------------------------------------------------------------
create table public.university_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  name        text not null check (char_length(name) between 1 and 80),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger university_categories_set_updated_at
  before update on public.university_categories
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- Courses
-- -------------------------------------------------------------------------
create table public.university_courses (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  title           text not null check (char_length(title) between 1 and 160),
  subtitle        text check (subtitle is null or char_length(subtitle) <= 280),
  description     text check (description is null or char_length(description) <= 8000),
  cover_image_url text check (cover_image_url is null or char_length(cover_image_url) <= 1000),
  category_id     uuid references public.university_categories(id) on delete set null,
  access_level    public.university_access_level not null default 'authenticated',
  status          public.university_course_status not null default 'draft',
  position        integer not null default 0,
  lesson_count    integer not null default 0,            -- denormalized; maintained by trigger
  total_duration_seconds integer not null default 0,     -- denormalized sum of lesson durations
  created_by      uuid references auth.users(id) on delete set null,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index university_courses_catalog_idx
  on public.university_courses (position, created_at desc) where status = 'published';
create index university_courses_category_idx
  on public.university_courses (category_id) where status = 'published';
create trigger university_courses_set_updated_at
  before update on public.university_courses
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- Lessons (public-safe metadata only — NOT the playable source)
-- -------------------------------------------------------------------------
create table public.university_lessons (
  id               uuid primary key default gen_random_uuid(),
  course_id        uuid not null references public.university_courses(id) on delete cascade,
  slug             text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  title            text not null check (char_length(title) between 1 and 200),
  summary          text check (summary is null or char_length(summary) <= 2000),
  provider         public.university_video_provider not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  position         integer not null default 0,    -- ordering hint; ties break on created_at
  is_preview       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (course_id, slug)
);
create index university_lessons_course_position_idx
  on public.university_lessons (course_id, position, created_at);
create trigger university_lessons_set_updated_at
  before update on public.university_lessons
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- THE PROTECTED TABLE — playable identity only. No client ever reads this.
-- -------------------------------------------------------------------------
create table public.university_lesson_sources (
  lesson_id         uuid primary key references public.university_lessons(id) on delete cascade,
  course_id         uuid not null references public.university_courses(id) on delete cascade, -- denormalized for join-free entitlement
  provider          public.university_video_provider not null,
  provider_video_id text check (provider_video_id is null or char_length(provider_video_id) <= 200),
  provider_hash     text check (provider_hash is null or char_length(provider_hash) <= 200),
  source_path       text check (source_path is null or char_length(source_path) <= 1000),  -- imagekit file path
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger university_lesson_sources_set_updated_at
  before update on public.university_lesson_sources
  for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- Progress (one row per user per lesson)
-- -------------------------------------------------------------------------
create table public.university_progress (
  user_id         uuid not null references auth.users(id) on delete cascade,
  lesson_id       uuid not null references public.university_lessons(id) on delete cascade,
  course_id       uuid not null references public.university_courses(id) on delete cascade, -- denormalized for fast per-course rollups
  resume_seconds  integer not null default 0 check (resume_seconds >= 0),
  completed_at    timestamptz,
  last_watched_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
create index university_progress_user_course_idx
  on public.university_progress (user_id, course_id);
create trigger university_progress_set_updated_at
  before update on public.university_progress
  for each row execute function public.set_updated_at();

-- =========================================================================
-- RLS
-- =========================================================================
alter table public.university_categories     enable row level security;
alter table public.university_courses         enable row level security;
alter table public.university_lessons         enable row level security;
alter table public.university_lesson_sources  enable row level security;
alter table public.university_progress        enable row level security;

-- Categories: world-readable; superadmin writes.
create policy university_categories_public_read
  on public.university_categories for select to anon, authenticated using (true);
create policy university_categories_superadmin_write
  on public.university_categories for all to authenticated
  using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');

-- Courses: published rows are world-readable; superadmin reads everything (drafts too) and writes.
create policy university_courses_public_read
  on public.university_courses for select to anon, authenticated using (status = 'published');
create policy university_courses_superadmin_read
  on public.university_courses for select to authenticated using (public.current_role() = 'superadmin');
create policy university_courses_superadmin_write
  on public.university_courses for all to authenticated
  using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');

-- Lessons: metadata readable when the parent course is published (so the curriculum can
-- show LOCKED lesson titles). The secret is NOT here — it's in university_lesson_sources.
create policy university_lessons_public_read
  on public.university_lessons for select to anon, authenticated
  using (
    exists (
      select 1 from public.university_courses c
      where c.id = university_lessons.course_id and c.status = 'published'
    )
  );
create policy university_lessons_superadmin_all
  on public.university_lessons for all to authenticated
  using (public.current_role() = 'superadmin') with check (public.current_role() = 'superadmin');

-- THE WALL: RLS on, ZERO select policies, and default grants revoked. Only the
-- security-definer RPCs (owned by postgres) can ever touch this table.
revoke all on public.university_lesson_sources from anon, authenticated;

-- Progress: strictly owner-only. All writes flow through upsert_lesson_progress (definer),
-- which re-checks entitlement, but owner-only RLS is the backstop for any direct read.
create policy university_progress_owner_all
  on public.university_progress for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- =========================================================================
-- Denormalized lesson_count + total_duration on the course (cheap catalog cards)
-- =========================================================================
create or replace function public.university_sync_lesson_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid := coalesce(new.course_id, old.course_id);
begin
  update public.university_courses c
    set lesson_count = (
          select count(*) from public.university_lessons l where l.course_id = v_course
        ),
        total_duration_seconds = (
          select coalesce(sum(coalesce(l.duration_seconds, 0)), 0)
          from public.university_lessons l where l.course_id = v_course
        )
  where c.id = v_course;
  return null;
end;
$$;

create trigger university_lessons_count_aiud
  after insert or delete or update of course_id, duration_seconds on public.university_lessons
  for each row execute function public.university_sync_lesson_count();

-- =========================================================================
-- Seed a few default categories (operators can edit/add later)
-- =========================================================================
insert into public.university_categories (slug, name, position) values
  ('getting-started', 'Getting started', 0),
  ('chatbot',         'Chatbot',         1),
  ('action-pages',    'Action Pages',    2),
  ('growth',          'Growth',          3)
on conflict (slug) do nothing;
