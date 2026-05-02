-- =========================================================================
-- Embedding job queue.
-- One row per pending re-embed of a knowledge_document or knowledge_faq.
-- Workers claim jobs with `for update skip locked` and update status.
-- A partial index keeps polling cheap regardless of how many done/failed
-- jobs accumulate.
-- =========================================================================

create table public.knowledge_embedding_jobs (
  id            uuid primary key default gen_random_uuid(),

  document_id   uuid references public.knowledge_documents(id) on delete cascade,
  faq_id        uuid references public.knowledge_faqs(id)      on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,

  status        text not null default 'queued'
                check (status in ('queued','running','done','failed')),
  source_version integer not null default 0,
  attempts      integer not null default 0 check (attempts >= 0),
  last_error    text,

  scheduled_at  timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint knowledge_embedding_jobs_one_source
    check ((document_id is null) <> (faq_id is null))
);

-- Cheap polling for the worker. Only active rows live in this index.
create index knowledge_embedding_jobs_active_idx
  on public.knowledge_embedding_jobs (scheduled_at)
  where status in ('queued','running');

-- One active job per source at a time. Keeps re-saves from stacking up
-- duplicate work; the worker rechecks the row's freshness before running.
create unique index knowledge_embedding_jobs_active_doc_uniq
  on public.knowledge_embedding_jobs (document_id)
  where document_id is not null and status in ('queued','running');

create unique index knowledge_embedding_jobs_active_faq_uniq
  on public.knowledge_embedding_jobs (faq_id)
  where faq_id is not null and status in ('queued','running');

create trigger knowledge_embedding_jobs_set_updated_at
  before update on public.knowledge_embedding_jobs
  for each row execute function public.set_updated_at();

alter table public.knowledge_embedding_jobs enable row level security;

create policy knowledge_embedding_jobs_owner_all on public.knowledge_embedding_jobs
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
