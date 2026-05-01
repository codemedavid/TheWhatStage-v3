-- =========================================================================
-- Facebook comments management: queue, lead-linked comments, bridges
-- =========================================================================

create table public.facebook_comment_jobs (
  id              uuid primary key default gen_random_uuid(),
  page_id         uuid not null references public.facebook_pages(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  fb_comment_id   text not null,
  fb_parent_id    text,
  fb_post_id      text,
  webhook_event   jsonb not null,
  status          text not null default 'queued'
                  check (status in ('queued','running','done','failed','skipped')),
  attempts        integer not null default 0,
  scheduled_at    timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  unique (fb_comment_id)
);

create index facebook_comment_jobs_status_idx
  on public.facebook_comment_jobs (status, scheduled_at)
  where status in ('queued','running');

create table public.facebook_lead_comments (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null references public.leads(id) on delete cascade,
  page_id            uuid not null references public.facebook_pages(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  fb_comment_id      text not null unique,
  fb_post_id         text,
  fb_parent_id       text,
  commenter_id       text,
  commenter_name     text,
  message            text not null default '',
  classification     text not null
                     check (classification in ('good','question','spam','abusive','needs_no_action')),
  confidence         text not null check (confidence in ('low','medium','high')),
  moderation_action  text not null
                     check (moderation_action in ('none','public_reply','private_reply','hide','delete')),
  public_reply       text,
  private_reply      text,
  graph_status       text not null default 'pending'
                     check (graph_status in ('pending','sent','hidden','deleted','failed','skipped')),
  graph_error        text,
  created_at         timestamptz not null default now()
);

create index facebook_lead_comments_lead_idx
  on public.facebook_lead_comments (lead_id, created_at);

create index facebook_lead_comments_user_recent_idx
  on public.facebook_lead_comments (user_id, created_at desc);

create table public.facebook_comment_bridges (
  id                       uuid primary key default gen_random_uuid(),
  page_id                  uuid not null references public.facebook_pages(id) on delete cascade,
  user_id                  uuid not null references auth.users(id) on delete cascade,
  fb_comment_id            text not null unique,
  commenter_id             text,
  commenter_name           text,
  message                  text not null default '',
  private_reply_message_id text,
  lead_id                  uuid references public.leads(id) on delete cascade,
  resolved_at              timestamptz,
  expires_at               timestamptz not null,
  created_at               timestamptz not null default now()
);

create index facebook_comment_bridges_unresolved_identity_idx
  on public.facebook_comment_bridges (page_id, commenter_id)
  where resolved_at is null and commenter_id is not null;

create index facebook_comment_bridges_expires_idx
  on public.facebook_comment_bridges (expires_at)
  where resolved_at is null;

alter table public.facebook_comment_jobs enable row level security;
alter table public.facebook_lead_comments enable row level security;
alter table public.facebook_comment_bridges enable row level security;

create policy facebook_comment_jobs_owner_read on public.facebook_comment_jobs
  for select to authenticated
  using (user_id = auth.uid());

create policy facebook_comment_jobs_admin_all on public.facebook_comment_jobs
  for all to authenticated
  using (public.current_role() in ('admin','superadmin'))
  with check (public.current_role() in ('admin','superadmin'));

create policy facebook_lead_comments_owner_read on public.facebook_lead_comments
  for select to authenticated
  using (user_id = auth.uid());

create policy facebook_lead_comments_admin_all on public.facebook_lead_comments
  for all to authenticated
  using (public.current_role() in ('admin','superadmin'))
  with check (public.current_role() in ('admin','superadmin'));

create policy facebook_comment_bridges_owner_read on public.facebook_comment_bridges
  for select to authenticated
  using (user_id = auth.uid());

create policy facebook_comment_bridges_admin_all on public.facebook_comment_bridges
  for all to authenticated
  using (public.current_role() in ('admin','superadmin'))
  with check (public.current_role() in ('admin','superadmin'));

create or replace function public.claim_facebook_comment_jobs(
  p_limit int default 5,
  p_stale_seconds int default 300
)
returns table (
  id uuid,
  page_id uuid,
  user_id uuid,
  fb_comment_id text,
  fb_parent_id text,
  fb_post_id text,
  webhook_event jsonb,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.facebook_comment_jobs
  set status = 'queued',
      started_at = null,
      scheduled_at = now()
  where status = 'running'
    and started_at < now() - make_interval(secs => p_stale_seconds);

  return query
  with picked as (
    select j.id
    from public.facebook_comment_jobs j
    where j.status = 'queued'
      and j.scheduled_at <= now()
    order by j.scheduled_at, j.id
    limit p_limit
    for update skip locked
  )
  update public.facebook_comment_jobs j
  set status = 'running',
      started_at = now(),
      finished_at = null
  from picked
  where j.id = picked.id
  returning
    j.id,
    j.page_id,
    j.user_id,
    j.fb_comment_id,
    j.fb_parent_id,
    j.fb_post_id,
    j.webhook_event,
    j.attempts;
end;
$$;

revoke all on function public.claim_facebook_comment_jobs(int, int) from public;
grant execute on function public.claim_facebook_comment_jobs(int, int) to service_role;
