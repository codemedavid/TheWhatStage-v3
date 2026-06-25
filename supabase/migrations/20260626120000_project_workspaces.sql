-- =========================================================================
-- Project workspaces ("project managements"): a per-user container that groups
-- its OWN stages + projects. Before this, a user had a single implicit board
-- (project_stages / projects scoped only by user_id). This adds a workspace
-- dimension so a user can run several independent boards, duplicate a board's
-- workflow, and transfer a project (card) between boards.
--
-- Additive + backfilled: every user with existing projects data gets a default
-- "Welcome" workspace that ADOPTS all their current stages and projects, so the
-- old setup keeps working untouched. All DDL + DML is guarded so a re-run is
-- safe (this repo re-runs project migrations that lack a history row).
-- =========================================================================

-- 1. project_workspaces — the container. Exactly one default ("Welcome") per user.
create table if not exists public.project_workspaces (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  description text check (char_length(description) <= 500),
  position    integer not null default 0,
  is_default  boolean not null default false,
  color       text check (char_length(color) <= 32),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists project_workspaces_user_position_idx
  on public.project_workspaces (user_id, position);

create unique index if not exists project_workspaces_one_default_per_user
  on public.project_workspaces (user_id) where is_default;

create or replace trigger project_workspaces_set_updated_at
  before update on public.project_workspaces
  for each row execute function public.set_updated_at();

alter table public.project_workspaces enable row level security;

drop policy if exists project_workspaces_owner_all on public.project_workspaces;
create policy project_workspaces_owner_all on public.project_workspaces
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2. Add workspace_id to project_stages + projects (nullable during backfill).
--    Stages cascade with their workspace; projects RESTRICT so a workspace can
--    only be dropped once emptied of cards (matches the app-level delete guard).
alter table public.project_stages
  add column if not exists workspace_id uuid references public.project_workspaces(id) on delete cascade;

alter table public.projects
  add column if not exists workspace_id uuid references public.project_workspaces(id) on delete restrict;

-- 3. Backfill: one "Welcome" workspace per user that has any stages or projects.
insert into public.project_workspaces (user_id, name, position, is_default)
select distinct u.user_id, 'Welcome', 0, true
from (
  select user_id from public.project_stages
  union
  select user_id from public.projects
) u
where not exists (
  select 1 from public.project_workspaces w
  where w.user_id = u.user_id and w.is_default
);

-- Assign every existing stage to its user's default workspace.
update public.project_stages s
set workspace_id = w.id
from public.project_workspaces w
where w.user_id = s.user_id and w.is_default and s.workspace_id is null;

-- Assign every existing project to the workspace of its stage, joined on BOTH
-- stage id and user_id so a (data-inconsistent) cross-user stage reference is
-- left NULL and surfaced loudly by the SET NOT NULL below rather than silently
-- placing a card in another user's workspace.
update public.projects p
set workspace_id = st.workspace_id
from public.project_stages st
where st.id = p.stage_id and st.user_id = p.user_id and p.workspace_id is null;

-- 4. Now that every row is backfilled, require the column.
alter table public.project_stages alter column workspace_id set not null;
alter table public.projects        alter column workspace_id set not null;

-- 5. Composite integrity: a card's workspace MUST match its stage's workspace.
--    Unique key on project_stages backs the composite FK from projects.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'project_stages_workspace_id_key') then
    alter table public.project_stages
      add constraint project_stages_workspace_id_key unique (workspace_id, id);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projects_workspace_stage_fk') then
    alter table public.projects
      add constraint projects_workspace_stage_fk
      foreign key (workspace_id, stage_id)
      references public.project_stages (workspace_id, id);
  end if;
end $$;

-- 6. One default STAGE per workspace (was one per user).
drop index if exists public.project_stages_one_default_per_user;
create unique index if not exists project_stages_one_default_per_workspace
  on public.project_stages (workspace_id) where is_default;

-- 7. Workspace-scoped board/lookup indexes.
create index if not exists project_stages_workspace_position_idx
  on public.project_stages (workspace_id, position);
create index if not exists projects_workspace_stage_position_idx
  on public.projects (workspace_id, stage_id, position);

-- 8. duplicate_project_workspace — clone a workspace's stages + per-stage
--    sequences + steps (and their settings) into a NEW workspace owned by the
--    caller. Does NOT copy projects (cards), sequence runs, or stage events.
--    Returns the new workspace id. SECURITY INVOKER: RLS confines every read and
--    write to the caller's own rows.
create or replace function public.duplicate_project_workspace(
  p_workspace_id uuid,
  p_name text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_new_ws   uuid;
  v_next_pos integer;
  s          record;
  v_new_stage uuid;
  v_seq      record;
  v_new_seq  uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Source must exist and be owned by the caller.
  if not exists (
    select 1 from public.project_workspaces
    where id = p_workspace_id and user_id = v_uid
  ) then
    raise exception 'Workspace not found';
  end if;

  select coalesce(max(position), -1) + 1 into v_next_pos
  from public.project_workspaces where user_id = v_uid;

  insert into public.project_workspaces (user_id, name, position, is_default, color, description)
  select v_uid,
         left(coalesce(nullif(btrim(p_name), ''), 'Copy of ' || w.name), 60),
         v_next_pos, false, w.color, w.description
  from public.project_workspaces w
  where w.id = p_workspace_id
  returning id into v_new_ws;

  for s in
    select * from public.project_stages
    where workspace_id = p_workspace_id and user_id = v_uid
    order by position
  loop
    insert into public.project_stages
      (user_id, workspace_id, name, description, position, is_default, kind, color)
    values
      (v_uid, v_new_ws, s.name, s.description, s.position, s.is_default, s.kind, s.color)
    returning id into v_new_stage;

    -- Copy the stage's sequence config + steps when one exists.
    select * into v_seq from public.project_stage_sequences
    where stage_id = s.id and user_id = v_uid;
    if found then
      insert into public.project_stage_sequences
        (user_id, stage_id, enabled, stage_instructions, do_rules, dont_rules)
      values
        (v_uid, v_new_stage, v_seq.enabled, v_seq.stage_instructions, v_seq.do_rules, v_seq.dont_rules)
      returning id into v_new_seq;

      insert into public.project_stage_sequence_steps
        (user_id, sequence_id, position, delay_minutes, instruction,
         manual_message, fallback_message, channel, enabled)
      select v_uid, v_new_seq, position, delay_minutes, instruction,
             manual_message, fallback_message, channel, enabled
      from public.project_stage_sequence_steps
      where sequence_id = v_seq.id
      order by position;
    end if;
  end loop;

  return v_new_ws;
end;
$$;

-- Least privilege: only authenticated users may invoke (the body also guards on
-- auth.uid() and every write is RLS-checked). Supabase grants EXECUTE to `anon`
-- via default privileges, so revoke it explicitly too — not just from PUBLIC.
revoke execute on function public.duplicate_project_workspace(uuid, text) from public, anon;
grant execute on function public.duplicate_project_workspace(uuid, text) to authenticated;
