-- supabase/migrations/20260607000150_embedding_jobs_payment_method_id.sql
alter table public.knowledge_embedding_jobs
  add column if not exists payment_method_id uuid
  references public.payment_methods(id) on delete cascade;

-- Partial unique: only one active job per payment_method at a time.
create unique index if not exists knowledge_embedding_jobs_payment_method_active_unique
  on public.knowledge_embedding_jobs (payment_method_id)
  where payment_method_id is not null and status in ('queued', 'running');

alter table public.knowledge_embedding_jobs
  drop constraint if exists knowledge_embedding_jobs_one_source;

alter table public.knowledge_embedding_jobs
  add constraint knowledge_embedding_jobs_one_source
  check (num_nonnulls(document_id, faq_id, business_item_id, media_asset_id, payment_method_id) = 1);
