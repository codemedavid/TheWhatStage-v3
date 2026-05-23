-- supabase/migrations/20260607000100_knowledge_chunks_payment_method_source.sql
-- Fifth polymorphic source type on knowledge_chunks: payment_methods.
-- Mirrors the existing document_id / faq_id / business_item_id / media_asset_id
-- shape — exactly one source FK per row is set.

alter table public.knowledge_chunks
  add column if not exists payment_method_id uuid
  references public.payment_methods(id) on delete cascade;

-- Replace the one-source CHECK constraint to include the new column.
alter table public.knowledge_chunks
  drop constraint if exists knowledge_chunks_one_source;

alter table public.knowledge_chunks
  add constraint knowledge_chunks_one_source
  check (
    num_nonnulls(document_id, faq_id, business_item_id, media_asset_id, payment_method_id) = 1
  );

-- Upsert key per payment method (same shape as the other source uniques).
create unique index if not exists knowledge_chunks_payment_method_unique
  on public.knowledge_chunks (payment_method_id, chunk_index)
  where payment_method_id is not null;

-- Lookup index for the resolver / retrieval RPC.
create index if not exists knowledge_chunks_payment_method_id_idx
  on public.knowledge_chunks (payment_method_id)
  where payment_method_id is not null;
