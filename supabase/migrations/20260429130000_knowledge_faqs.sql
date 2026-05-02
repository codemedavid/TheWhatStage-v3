-- =========================================================================
-- Knowledge FAQs: per-user question/answer entries.
-- Separate from knowledge_documents so FAQs can have their own ordering,
-- publish state, and (future) public-facing surface without bleeding into
-- the document model.
-- =========================================================================

create table public.knowledge_faqs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  category_id  uuid references public.knowledge_categories(id) on delete set null,

  question     text not null check (char_length(question) between 1 and 300),
  answer       text not null default '' check (char_length(answer) <= 10000),

  position     integer not null default 0,
  is_published boolean not null default true,
  version      integer not null default 0,

  -- Reserved for future RAG phase, mirrors knowledge_documents.
  embedding_status text not null default 'pending'
    check (embedding_status in ('pending','indexed','stale')),
  embedded_at  timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index knowledge_faqs_user_position_idx
  on public.knowledge_faqs (user_id, position, created_at);
create index knowledge_faqs_user_category_idx
  on public.knowledge_faqs (user_id, category_id);

create trigger knowledge_faqs_set_updated_at
  before update on public.knowledge_faqs
  for each row execute function public.set_updated_at();

alter table public.knowledge_faqs enable row level security;

create policy knowledge_faqs_owner_all on public.knowledge_faqs
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
