-- Pinned documents float to the top of the list.
-- Tags are user-managed and many-to-many with documents.

alter table public.knowledge_documents
  add column if not exists is_pinned boolean not null default false,
  add column if not exists pinned_at timestamptz;

create index if not exists knowledge_documents_user_pinned_idx
  on public.knowledge_documents (user_id, is_pinned, updated_at desc);

create table if not exists public.knowledge_tags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  color       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists knowledge_tags_user_name_idx
  on public.knowledge_tags (user_id, name);

create table if not exists public.knowledge_document_tags (
  document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  tag_id      uuid not null references public.knowledge_tags(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (document_id, tag_id)
);

create index if not exists knowledge_document_tags_user_idx
  on public.knowledge_document_tags (user_id);
create index if not exists knowledge_document_tags_tag_idx
  on public.knowledge_document_tags (tag_id);

create trigger knowledge_tags_set_updated_at
  before update on public.knowledge_tags
  for each row execute function public.set_updated_at();

alter table public.knowledge_tags          enable row level security;
alter table public.knowledge_document_tags enable row level security;

create policy knowledge_tags_owner_all on public.knowledge_tags
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy knowledge_document_tags_owner_all on public.knowledge_document_tags
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
