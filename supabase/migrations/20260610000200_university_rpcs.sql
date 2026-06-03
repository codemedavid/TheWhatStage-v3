-- =========================================================================
-- WhatStage University — RPCs
--
--   get_lesson_playback   (anon, authenticated)  — the ONLY read path for a source.
--                          Re-derives entitlement inside the DB; empty set if denied.
--   upsert_lesson_progress(authenticated)        — owner progress; re-checks entitlement.
--   superadmin_upsert_lesson (service_role)      — atomic lesson + source write for the CMS.
--
-- Entitlement truth table (must match src/lib/university/access.ts::getEntitlement):
--   access \ preview | anon | authed | subscriber/admin | superadmin
--   public           |  ✓   |   ✓    |        ✓         |     ✓
--   authenticated/F  |  ✗   |   ✓    |        ✓         |     ✓
--   authenticated/T  |  ✓   |   ✓    |        ✓         |     ✓
--   subscriber/F     |  ✗   |   ✗    |        ✓         |     ✓
--   subscriber/T     |  ✓   |   ✓    |        ✓         |     ✓
--   draft course     |  ✗   |   ✗    |        ✗         |     ✓ (superadmin only)
-- =========================================================================

-- -------------------------------------------------------------------------
-- get_lesson_playback: returns the source row ONLY to entitled callers.
-- Empty set for: unknown lesson, unpublished course (non-superadmin), or not entitled.
-- No existence/leak difference between "not found" and "not allowed".
-- -------------------------------------------------------------------------
create or replace function public.get_lesson_playback(p_lesson_id uuid)
returns table (
  lesson_id         uuid,
  provider          public.university_video_provider,
  provider_video_id text,
  provider_hash     text,
  source_path       text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_access     public.university_access_level;
  v_status     public.university_course_status;
  v_is_preview boolean;
  v_is_super   boolean := public.current_role() = 'superadmin';
  v_allowed    boolean := false;
begin
  select c.access_level, c.status, l.is_preview
    into v_access, v_status, v_is_preview
  from public.university_lessons l
  join public.university_courses c on c.id = l.course_id
  where l.id = p_lesson_id;

  if not found then
    return;  -- unknown lesson → empty set
  end if;

  if v_is_super then
    v_allowed := true;                       -- superadmin previews anything (incl. drafts)
  elsif v_status <> 'published' then
    v_allowed := false;                      -- non-superadmin never sees unpublished sources
  elsif v_is_preview then
    v_allowed := true;                       -- a preview lesson is playable by anyone
  elsif v_access = 'public' then
    v_allowed := true;
  elsif v_access = 'authenticated' then
    v_allowed := auth.uid() is not null;
  elsif v_access = 'subscriber' then
    v_allowed := public.is_subscriber();
  end if;

  if not v_allowed then
    return;  -- deny → empty set
  end if;

  return query
  select s.lesson_id, s.provider, s.provider_video_id, s.provider_hash, s.source_path
  from public.university_lesson_sources s
  where s.lesson_id = p_lesson_id;
end;
$$;

revoke all on function public.get_lesson_playback(uuid) from public;
grant execute on function public.get_lesson_playback(uuid) to anon, authenticated;

-- -------------------------------------------------------------------------
-- upsert_lesson_progress: owner records resume position / completion.
-- Re-checks entitlement so a user can't log progress on a lesson they can't watch.
-- Completion is sticky (never un-completed here). resume clamped to duration.
-- -------------------------------------------------------------------------
create or replace function public.upsert_lesson_progress(
  p_lesson_id      uuid,
  p_resume_seconds integer default 0,
  p_complete       boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_course     uuid;
  v_access     public.university_access_level;
  v_status     public.university_course_status;
  v_is_preview boolean;
  v_duration   integer;
  v_resume     integer;
  v_allowed    boolean := false;
begin
  if v_uid is null then
    return false;  -- anon: no progress
  end if;

  select l.course_id, c.access_level, c.status, l.is_preview, l.duration_seconds
    into v_course, v_access, v_status, v_is_preview, v_duration
  from public.university_lessons l
  join public.university_courses c on c.id = l.course_id
  where l.id = p_lesson_id;

  if not found then
    return false;
  end if;

  if public.current_role() = 'superadmin' then
    v_allowed := true;
  elsif v_status <> 'published' then
    v_allowed := false;
  elsif v_is_preview then
    v_allowed := true;
  elsif v_access = 'public' then
    v_allowed := true;
  elsif v_access = 'authenticated' then
    v_allowed := true;                     -- v_uid is already non-null
  elsif v_access = 'subscriber' then
    v_allowed := public.is_subscriber();
  end if;

  if not v_allowed then
    return false;
  end if;

  v_resume := greatest(0, coalesce(p_resume_seconds, 0));
  if v_duration is not null then
    v_resume := least(v_resume, v_duration);
  end if;

  insert into public.university_progress as up
    (user_id, lesson_id, course_id, resume_seconds, completed_at, last_watched_at, updated_at)
  values
    (v_uid, p_lesson_id, v_course, v_resume,
     case when p_complete then now() else null end, now(), now())
  on conflict (user_id, lesson_id) do update
    set resume_seconds  = excluded.resume_seconds,
        completed_at    = case when p_complete then coalesce(up.completed_at, now()) else up.completed_at end,
        last_watched_at = now(),
        updated_at      = now();

  return true;
end;
$$;

revoke all on function public.upsert_lesson_progress(uuid, integer, boolean) from public;
grant execute on function public.upsert_lesson_progress(uuid, integer, boolean) to authenticated;

-- -------------------------------------------------------------------------
-- superadmin_upsert_lesson: atomic write of a lesson row + its source row.
-- service_role only (the CMS route handlers call it via the service-role client,
-- AFTER a getSession() superadmin check). p_lesson_id null => insert.
-- -------------------------------------------------------------------------
create or replace function public.superadmin_upsert_lesson(
  p_lesson_id        uuid,
  p_course_id        uuid,
  p_slug             text,
  p_title            text,
  p_summary          text,
  p_provider         public.university_video_provider,
  p_duration_seconds integer,
  p_position         integer,
  p_is_preview       boolean,
  p_provider_video_id text,
  p_provider_hash    text,
  p_source_path      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_lesson_id is null then
    insert into public.university_lessons
      (course_id, slug, title, summary, provider, duration_seconds, position, is_preview)
    values
      (p_course_id, p_slug, p_title, p_summary, p_provider, p_duration_seconds,
       coalesce(p_position, 0), coalesce(p_is_preview, false))
    returning id into v_id;
  else
    update public.university_lessons
      set slug             = p_slug,
          title            = p_title,
          summary          = p_summary,
          provider         = p_provider,
          duration_seconds = p_duration_seconds,
          position         = coalesce(p_position, 0),
          is_preview       = coalesce(p_is_preview, false),
          updated_at       = now()
    where id = p_lesson_id and course_id = p_course_id
    returning id into v_id;
    if v_id is null then
      raise exception 'lesson % not found in course %', p_lesson_id, p_course_id;
    end if;
  end if;

  insert into public.university_lesson_sources
    (lesson_id, course_id, provider, provider_video_id, provider_hash, source_path)
  values
    (v_id, p_course_id, p_provider, p_provider_video_id, p_provider_hash, p_source_path)
  on conflict (lesson_id) do update
    set course_id         = excluded.course_id,
        provider          = excluded.provider,
        provider_video_id = excluded.provider_video_id,
        provider_hash     = excluded.provider_hash,
        source_path       = excluded.source_path,
        updated_at        = now();

  return v_id;
end;
$$;

revoke all on function public.superadmin_upsert_lesson(
  uuid, uuid, text, text, text, public.university_video_provider,
  integer, integer, boolean, text, text, text
) from public, anon, authenticated;
grant execute on function public.superadmin_upsert_lesson(
  uuid, uuid, text, text, text, public.university_video_provider,
  integer, integer, boolean, text, text, text
) to service_role;
