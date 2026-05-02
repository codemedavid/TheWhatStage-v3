-- =========================================================================
-- Knowledge base: documents + categories (per-user)
-- Documents are edited in-place: every save updates the same row by id.
-- draft_* columns hold autosaved drafts; content_* columns hold the
-- explicitly Saved version that downstream RAG/embeddings will read.
-- =========================================================================

create table public.knowledge_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  color       text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)
);

create index knowledge_categories_user_position_idx
  on public.knowledge_categories (user_id, position);

create table public.knowledge_documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  category_id  uuid references public.knowledge_categories(id) on delete set null,
  title        text not null default 'Untitled' check (char_length(title) between 1 and 200),

  -- Committed (Saved) content. RAG pipeline reads these.
  content_json jsonb,
  content_html text,
  content_text text,

  -- Working draft (autosaved, not yet committed).
  draft_json   jsonb,
  draft_html   text,
  draft_text   text,
  has_unsaved_changes boolean not null default false,

  version      integer not null default 0,
  published_at timestamptz,

  -- Reserved for future RAG phase.
  embedding_status text not null default 'pending'
    check (embedding_status in ('pending','indexed','stale')),
  embedded_at  timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index knowledge_documents_user_updated_idx
  on public.knowledge_documents (user_id, updated_at desc);
create index knowledge_documents_user_category_idx
  on public.knowledge_documents (user_id, category_id);

-- Reuse the existing public.set_updated_at() trigger function.
create trigger knowledge_categories_set_updated_at
  before update on public.knowledge_categories
  for each row execute function public.set_updated_at();

create trigger knowledge_documents_set_updated_at
  before update on public.knowledge_documents
  for each row execute function public.set_updated_at();

-- RLS
alter table public.knowledge_categories enable row level security;
alter table public.knowledge_documents  enable row level security;

create policy knowledge_categories_owner_all on public.knowledge_categories
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy knowledge_documents_owner_all on public.knowledge_documents
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
