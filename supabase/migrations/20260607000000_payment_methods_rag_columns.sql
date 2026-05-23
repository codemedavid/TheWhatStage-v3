-- supabase/migrations/20260607000000_payment_methods_rag_columns.sql
-- Add version + embedding_status columns so payment_methods can participate
-- in the knowledge_embedding_jobs pipeline like business_items and
-- knowledge_documents do.

alter table public.payment_methods
  add column if not exists version integer not null default 0,
  add column if not exists embedding_status text not null default 'pending'
    check (embedding_status in ('pending', 'indexed', 'stale'));

create or replace function public.bump_payment_methods_version()
returns trigger
language plpgsql
as $$
begin
  new.version := coalesce(old.version, 0) + 1;
  return new;
end;
$$;

drop trigger if exists payment_methods_bump_version on public.payment_methods;
create trigger payment_methods_bump_version
  before update on public.payment_methods
  for each row
  execute function public.bump_payment_methods_version();
