-- =========================================================================
-- Messenger inbox: threads, messages, work queue
-- =========================================================================
-- Each Messenger conversation is one (page_id, psid) tuple. Threads link to
-- a lead in the operator's pipeline (created on first inbound message).
-- Messages store the full thread; jobs drive async bot replies.
--
-- Webhook + worker run with the service-role key (admin client) and bypass
-- RLS — they always derive ownership from facebook_pages → facebook_connections.
-- RLS below exists for the owner-facing dashboard surface only.
-- =========================================================================

create table public.messenger_threads (
  id                   uuid primary key default gen_random_uuid(),
  page_id              uuid not null references public.facebook_pages(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  psid                 text not null,
  lead_id              uuid references public.leads(id) on delete set null,
  full_name            text,
  picture_url          text,
  auto_reply_enabled   boolean not null default true,
  unread_count         integer not null default 0,
  last_message_at      timestamptz,
  last_message_preview text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (page_id, psid)
);

create index messenger_threads_user_recent_idx
  on public.messenger_threads (user_id, last_message_at desc nulls last);

create index messenger_threads_lead_idx
  on public.messenger_threads (lead_id)
  where lead_id is not null;

create trigger messenger_threads_set_updated_at
before update on public.messenger_threads
for each row execute function public.set_updated_at();

create table public.messenger_messages (
  id            uuid primary key default gen_random_uuid(),
  thread_id     uuid not null references public.messenger_threads(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  direction     text not null check (direction in ('inbound','outbound')),
  sender        text not null check (sender in ('user','bot','operator')),
  fb_message_id text unique,
  body          text not null default '',
  attachments   jsonb,
  error         text,
  created_at    timestamptz not null default now()
);

create index messenger_messages_thread_idx
  on public.messenger_messages (thread_id, created_at);

create table public.messenger_jobs (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid not null references public.messenger_threads(id) on delete cascade,
  inbound_msg_id  uuid not null references public.messenger_messages(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'queued'
                  check (status in ('queued','running','done','failed','skipped')),
  attempts        integer not null default 0,
  last_error      text,
  scheduled_at    timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index messenger_jobs_status_idx
  on public.messenger_jobs (status, scheduled_at)
  where status in ('queued','running');

-- =========================================================================
-- RLS — owner-only read/write from the dashboard.
-- =========================================================================

alter table public.messenger_threads  enable row level security;
alter table public.messenger_messages enable row level security;
alter table public.messenger_jobs     enable row level security;

create policy messenger_threads_owner_all on public.messenger_threads
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy messenger_messages_owner_all on public.messenger_messages
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy messenger_jobs_owner_read on public.messenger_jobs
  for select to authenticated
  using (user_id = auth.uid());

-- =========================================================================
-- Service-role variant of the knowledge retrieval RPC.
-- The chat webhook worker runs without an auth context and cannot use
-- match_knowledge_hybrid (which gates on auth.uid()). This security-definer
-- variant trusts the caller to pass the correct user_id and is granted to
-- service_role only.
-- =========================================================================

create or replace function public.match_knowledge_hybrid_service(
  p_user_id      uuid,
  p_query_text   text,
  p_query_embed  vector(1024),
  p_match_limit  int     default 150,
  p_full_text_w  float   default 1.0,
  p_semantic_w   float   default 1.0,
  p_rrf_k        int     default 60
)
returns table (
  id            uuid,
  document_id   uuid,
  faq_id        uuid,
  content       text,
  heading_path  text,
  rrf_score     float
)
language sql
stable
security definer
set search_path = public
as $$
  with fts as (
    select
      kc.id,
      row_number() over (
        order by ts_rank_cd(
          to_tsvector('simple', kc.content),
          websearch_to_tsquery('simple', p_query_text)
        ) desc
      ) as rank
    from public.knowledge_chunks kc
    where kc.user_id = p_user_id
      and (
        kc.document_id is not null
        or exists (
          select 1
          from public.knowledge_faqs f
          where f.id = kc.faq_id
            and f.is_published
        )
      )
      and to_tsvector('simple', kc.content)
          @@ websearch_to_tsquery('simple', p_query_text)
    limit p_match_limit
  ),
  sem as (
    select
      kc.id,
      row_number() over (order by kc.embedding <=> p_query_embed) as rank
    from public.knowledge_chunks kc
    where kc.user_id = p_user_id
      and (
        kc.document_id is not null
        or exists (
          select 1
          from public.knowledge_faqs f
          where f.id = kc.faq_id
            and f.is_published
        )
      )
    order by kc.embedding <=> p_query_embed
    limit p_match_limit
  ),
  fused as (
    select id from fts
    union
    select id from sem
  )
  select
    kc.id,
    kc.document_id,
    kc.faq_id,
    kc.content,
    kc.heading_path,
    coalesce(p_full_text_w / (p_rrf_k + fts.rank), 0)
      + coalesce(p_semantic_w / (p_rrf_k + sem.rank), 0) as rrf_score
  from fused
  join public.knowledge_chunks kc on kc.id = fused.id
  left join fts on fts.id = kc.id
  left join sem on sem.id = kc.id
  where kc.user_id = p_user_id
  order by rrf_score desc
  limit p_match_limit;
$$;

revoke all on function public.match_knowledge_hybrid_service(
  uuid, text, vector, int, float, float, int
) from public;

grant execute on function public.match_knowledge_hybrid_service(
  uuid, text, vector, int, float, float, int
) to service_role;
