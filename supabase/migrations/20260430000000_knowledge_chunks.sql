-- =========================================================================
-- Knowledge chunks: per-chunk vector store for RAG.
-- A chunk belongs to exactly one source: a knowledge_document OR a
-- knowledge_faq. Both FKs cascade so chunks disappear with their source.
-- Edits upsert by (source, chunk_index); content_hash lets the worker
-- skip re-embedding unchanged chunks.
-- =========================================================================

create extension if not exists vector;

create table public.knowledge_chunks (
  id            uuid primary key default gen_random_uuid(),

  -- Polymorphic source: exactly one of (document_id, faq_id) must be set.
  document_id   uuid references public.knowledge_documents(id) on delete cascade,
  faq_id        uuid references public.knowledge_faqs(id)      on delete cascade,

  -- Denormalized for RLS perf and tenant filtering in the HNSW scan.
  user_id       uuid not null references auth.users(id) on delete cascade,

  chunk_index   integer not null check (chunk_index >= 0),

  -- The exact text that was embedded (heading prefix already prepended).
  content       text   not null,
  heading_path  text,
  source_offset int4range,
  token_count   integer not null check (token_count > 0),
  content_hash  text   not null check (char_length(content_hash) = 64),
  is_atomic     boolean not null default false,

  embedding     vector(1024) not null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint knowledge_chunks_one_source
    check ((document_id is null) <> (faq_id is null))
);

-- Idempotent upsert key per source. NULL semantics allow multiple rows with
-- a NULL on either side, so a single regular UNIQUE works for each source.
-- Partial unique indexes would be tighter but PostgREST upsert can't use
-- them as ON CONFLICT targets.
alter table public.knowledge_chunks
  add constraint knowledge_chunks_doc_chunk_uniq unique (document_id, chunk_index);

alter table public.knowledge_chunks
  add constraint knowledge_chunks_faq_chunk_uniq unique (faq_id, chunk_index);

-- ANN index. Cosine matches what bge-m3 is trained for.
create index knowledge_chunks_embedding_hnsw
  on public.knowledge_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Lexical leg of hybrid search.
create index knowledge_chunks_fts
  on public.knowledge_chunks
  using gin (to_tsvector('simple'::regconfig, content));

-- Tenant filter used by every retrieval query.
create index knowledge_chunks_user_idx
  on public.knowledge_chunks (user_id);

create trigger knowledge_chunks_set_updated_at
  before update on public.knowledge_chunks
  for each row execute function public.set_updated_at();

alter table public.knowledge_chunks enable row level security;

create policy knowledge_chunks_owner_all on public.knowledge_chunks
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
