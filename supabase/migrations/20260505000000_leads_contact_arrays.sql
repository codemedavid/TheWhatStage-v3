-- Add phone/email arrays to leads so we can track every known contact
-- value for a lead (auto-detected from messages + collected via forms).
-- The scalar `phone` / `email` columns remain the primary contact fields;
-- these arrays accumulate every additional value we encounter.

alter table public.leads
  add column if not exists phones text[] not null default '{}',
  add column if not exists emails text[] not null default '{}';

-- GIN indexes for array containment queries (@> / && operators).
create index if not exists leads_phones_gin_idx on public.leads using gin (phones);
create index if not exists leads_emails_gin_idx on public.leads using gin (emails);

-- Atomic dedup-append used by both the messenger worker and the submit handler.
-- Callers pass only non-empty, normalised strings; the function skips blanks and
-- guarantees no duplicates (case-sensitive) without a read-modify-write race.
create or replace function public.append_lead_contacts(
  p_lead_id uuid,
  p_phones  text[],
  p_emails  text[]
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.leads
  set
    phones = array(
      select distinct trim(v)
      from unnest(coalesce(phones, '{}'::text[]) || coalesce(p_phones, '{}'::text[])) as v
      where trim(v) <> ''
    ),
    emails = array(
      select distinct lower(trim(v))
      from unnest(coalesce(emails, '{}'::text[]) || coalesce(p_emails, '{}'::text[])) as v
      where trim(v) <> ''
    )
  where id = p_lead_id;
$$;

grant execute on function public.append_lead_contacts(uuid, text[], text[]) to service_role;
