-- Per-value contact log: gives us a real `collected_at` and `source` for every
-- phone/email we've ever captured for a lead. The denormalized `leads.phones[]`
-- and `leads.emails[]` arrays are still maintained by append_lead_contacts as a
-- cheap "has any?" cache for list filtering.

create table if not exists public.lead_contact_values (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('phone','email')),
  value        text not null,
  source       text not null check (source in ('form','booking','catalog','messenger','manual')),
  collected_at timestamptz not null default now(),
  unique (lead_id, kind, value)
);

create index if not exists lead_contact_values_lead_kind_collected_idx
  on public.lead_contact_values (lead_id, kind, collected_at desc);

create index if not exists lead_contact_values_user_kind_idx
  on public.lead_contact_values (user_id, kind);

alter table public.lead_contact_values enable row level security;

create policy "lead_contact_values_select_own"
  on public.lead_contact_values for select
  using (user_id = auth.uid());

-- Rewrite of append_lead_contacts:
--  * Inserts a per-value row into lead_contact_values (dedup via unique).
--  * Continues to maintain the denormalized arrays on leads.
--  * Adds p_source (default 'manual') so legacy callers stay correct.
drop function if exists public.append_lead_contacts(uuid, text[], text[]);

create or replace function public.append_lead_contacts(
  p_lead_id uuid,
  p_phones  text[],
  p_emails  text[],
  p_source  text default 'manual'
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id from public.leads where id = p_lead_id;
  if v_user_id is null then return; end if;

  insert into public.lead_contact_values (lead_id, user_id, kind, value, source)
  select p_lead_id, v_user_id, 'phone', trim(v), p_source
  from unnest(coalesce(p_phones, '{}'::text[])) as v
  where trim(v) <> ''
  on conflict (lead_id, kind, value) do nothing;

  insert into public.lead_contact_values (lead_id, user_id, kind, value, source)
  select p_lead_id, v_user_id, 'email', lower(trim(v)), p_source
  from unnest(coalesce(p_emails, '{}'::text[])) as v
  where trim(v) <> ''
  on conflict (lead_id, kind, value) do nothing;

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
end;
$$;

grant execute on function public.append_lead_contacts(uuid, text[], text[], text) to service_role;
