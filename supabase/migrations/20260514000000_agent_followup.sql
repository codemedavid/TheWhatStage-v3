-- =========================================================================
-- AI Follow-Up Agent: campaigns, messages, rate buckets, job schema
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Make messenger_jobs.inbound_msg_id nullable so campaign send jobs can
--    exist without a linked inbound message.
-- -------------------------------------------------------------------------
alter table public.messenger_jobs
  drop constraint if exists messenger_jobs_inbound_msg_id_fkey;

alter table public.messenger_jobs
  alter column inbound_msg_id drop not null;

alter table public.messenger_jobs
  add constraint messenger_jobs_inbound_msg_id_fkey
  foreign key (inbound_msg_id) references public.messenger_messages(id)
  on delete cascade;

-- -------------------------------------------------------------------------
-- 2. Add kind + payload to messenger_jobs.
-- -------------------------------------------------------------------------
alter table public.messenger_jobs
  add column if not exists kind text not null default 'inbound_reply'
    check (kind in ('inbound_reply', 'agent_campaign_send')),
  add column if not exists payload jsonb;

create index if not exists messenger_jobs_kind_queued_idx
  on public.messenger_jobs (kind, scheduled_at)
  where status = 'queued';

-- -------------------------------------------------------------------------
-- 3. agent_campaigns — one row per "Send N messages" click.
-- -------------------------------------------------------------------------
create table public.agent_campaigns (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,

  command_text         text not null,
  intent               jsonb not null,
  image_media_asset_id uuid references public.media_assets(id),
  image_url            text,

  status text not null default 'previewing'
    check (status in ('previewing','dispatching','sending','completed','cancelled','failed')),

  total    int not null default 0,
  sent     int not null default 0,
  failed   int not null default 0,
  skipped  int not null default 0,

  created_at     timestamptz not null default now(),
  dispatched_at  timestamptz,
  completed_at   timestamptz
);

create index agent_campaigns_user_idx
  on public.agent_campaigns (user_id, created_at desc);

alter table public.agent_campaigns enable row level security;

create policy "agent_campaigns_owner_rw" on public.agent_campaigns
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- -------------------------------------------------------------------------
-- 4. agent_campaign_messages — one row per lead, per campaign.
-- -------------------------------------------------------------------------
create table public.agent_campaign_messages (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.agent_campaigns(id) on delete cascade,

  lead_id      uuid not null references public.leads(id)            on delete cascade,
  thread_id    uuid           references public.messenger_threads(id) on delete set null,

  -- preview-time
  draft_text       text    not null,
  policy_at_preview text   not null,
  user_included    boolean not null default true,
  user_edited      boolean not null default false,

  -- dispatch-time
  status text not null default 'pending'
    check (status in ('pending','sent','failed','skipped','cancelled')),
  skip_reason         text,
  policy_at_send      text,
  facebook_message_id text,
  error               text,
  attempts            int not null default 0,
  sent_at             timestamptz,

  created_at  timestamptz not null default now()
);

create index agent_campaign_messages_campaign_idx
  on public.agent_campaign_messages (campaign_id, status);

create index agent_campaign_messages_thread_recent_idx
  on public.agent_campaign_messages (thread_id, sent_at desc)
  where status = 'sent';

alter table public.agent_campaign_messages enable row level security;

create policy "agent_campaign_messages_owner_rw" on public.agent_campaign_messages
  for all
  using (
    exists (
      select 1 from public.agent_campaigns c
       where c.id = campaign_id
         and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.agent_campaigns c
       where c.id = campaign_id
         and c.user_id = auth.uid()
    )
  );

-- -------------------------------------------------------------------------
-- 5. Per-page send rate token buckets (service_role only; no user RLS).
-- -------------------------------------------------------------------------
create table public.messenger_page_rate_buckets (
  page_id        uuid primary key references public.facebook_pages(id) on delete cascade,
  tokens         numeric not null default 10,
  capacity       numeric not null default 10,
  refill_per_sec numeric not null default 7,
  last_refill_at timestamptz not null default now()
);

-- Seed one bucket per existing FB page.
insert into public.messenger_page_rate_buckets (page_id)
select id from public.facebook_pages
on conflict (page_id) do nothing;

-- -------------------------------------------------------------------------
-- 6. Update claim_messenger_jobs to return kind + payload.
-- -------------------------------------------------------------------------
create or replace function public.claim_messenger_jobs(
  p_limit         int default 5,
  p_stale_seconds int default 300
)
returns table (
  id                    uuid,
  thread_id             uuid,
  inbound_msg_id        uuid,
  user_id               uuid,
  attempts              integer,
  outbound_text_fb_id   text,
  outbound_button_fb_id text,
  kind                  text,
  payload               jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Reset stuck running jobs from crashed workers.
  update public.messenger_jobs
     set status     = 'queued',
         started_at = null
   where status     = 'running'
     and started_at is not null
     and started_at <= now() - make_interval(secs => p_stale_seconds);

  return query
  with picked as (
    select j.id,
           j.thread_id,
           j.inbound_msg_id,
           j.user_id,
           j.attempts,
           j.outbound_text_fb_id,
           j.outbound_button_fb_id,
           j.kind,
           j.payload
      from public.messenger_jobs j
     where j.status = 'queued'
       and j.scheduled_at <= now()
       -- (a) Skip threads with a running job — that worker owns the conversation.
       and not exists (
         select 1
           from public.messenger_jobs r
          where r.thread_id = j.thread_id
            and r.status   = 'running'
       )
       -- (b) Only the oldest queued job per thread.
       and not exists (
         select 1
           from public.messenger_jobs e
          where e.thread_id = j.thread_id
            and e.status    = 'queued'
            and (
              e.scheduled_at < j.scheduled_at
              or (e.scheduled_at = j.scheduled_at and e.id < j.id)
            )
       )
     order by j.scheduled_at, j.id
     limit greatest(p_limit, 1)
     for update skip locked
  )
  update public.messenger_jobs j
     set status     = 'running',
         started_at = now()
    from picked p
   where j.id     = p.id
     and j.status = 'queued'
  returning j.id,
            j.thread_id,
            j.inbound_msg_id,
            j.user_id,
            j.attempts,
            j.outbound_text_fb_id,
            j.outbound_button_fb_id,
            j.kind,
            j.payload;
end;
$$;

revoke all   on function public.claim_messenger_jobs(int, int) from public;
grant execute on function public.claim_messenger_jobs(int, int) to service_role;
