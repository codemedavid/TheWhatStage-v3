-- One-time backfill of lead contact arrays + lead_contact_values.
--
-- The append_lead_contacts RPC had an arg-count mismatch in production
-- (callers passed p_source against a 3-arg function) so submission contacts
-- were never captured. This backfill reconstructs them from the raw
-- action_page_submissions, then folds in any pre-existing array/scalar values.
--
-- Classifier mirrors extractContactsFromSubmission:
--  * emails by anchored pattern
--  * phones by 7-15 digits with a phone-hint key/label or a PH-mobile shape
-- Idempotent: re-running is a no-op thanks to the unique constraint and the
-- distinct array merge.

with cand as (
  -- form/booking field values
  select s.lead_id,
    case when kv.value ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then 'email' else 'phone' end as kind,
    case when kv.value ~ '@' then lower(trim(kv.value)) else trim(kv.value) end as value,
    ap.kind::text as source,
    s.created_at as collected_at
  from public.action_page_submissions s
  join public.action_pages ap on ap.id = s.action_page_id and ap.kind in ('form','booking')
  cross join lateral jsonb_each_text(coalesce(s.data->'fields','{}'::jsonb)) kv
  where s.lead_id is not null and (
    kv.value ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or (regexp_replace(kv.value,'[^0-9]','','g') ~ '^[0-9]{7,15}$'
        and (kv.key ~* 'phone|mobile|contact|tel|whatsapp|viber'
             or regexp_replace(kv.value,'[^0-9+]','','g') ~ '^(\+?63|0)9[0-9]{9}$'))
  )
  union all
  -- catalog customer phone
  select s.lead_id, 'phone', trim(s.data->'customer'->>'phone'), 'catalog', s.created_at
  from public.action_page_submissions s
  join public.action_pages ap on ap.id = s.action_page_id and ap.kind = 'catalog'
  where s.lead_id is not null
    and regexp_replace(coalesce(s.data->'customer'->>'phone',''),'[^0-9]','','g') ~ '^[0-9]{7,15}$'
  union all
  -- catalog customer email
  select s.lead_id, 'email', lower(trim(s.data->'customer'->>'email')), 'catalog', s.created_at
  from public.action_page_submissions s
  join public.action_pages ap on ap.id = s.action_page_id and ap.kind = 'catalog'
  where s.lead_id is not null
    and s.data->'customer'->>'email' ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
),
clean as (
  select lead_id, kind, value, source, collected_at from cand where value <> ''
),
ranked as (
  select distinct on (lead_id, kind, value)
    lead_id, kind, value, source, collected_at
  from clean
  order by lead_id, kind, value, collected_at asc
),
ins as (
  insert into public.lead_contact_values (lead_id, user_id, kind, value, source, collected_at)
  select r.lead_id, l.user_id, r.kind, r.value, r.source, r.collected_at
  from ranked r
  join public.leads l on l.id = r.lead_id
  on conflict (lead_id, kind, value) do nothing
  returning lead_id
),
agg as (
  select lead_id,
    array_agg(distinct value) filter (where kind='phone') as phones,
    array_agg(distinct value) filter (where kind='email') as emails
  from ranked group by lead_id
)
update public.leads l
set
  phones = array(
    select distinct trim(v)
    from unnest(coalesce(l.phones,'{}'::text[]) || coalesce(a.phones,'{}'::text[])) v
    where trim(v) <> ''
  ),
  emails = array(
    select distinct lower(trim(v))
    from unnest(coalesce(l.emails,'{}'::text[]) || coalesce(a.emails,'{}'::text[])) v
    where trim(v) <> ''
  )
from agg a
where l.id = a.lead_id;

-- Fold in any pre-existing array/scalar values that predate the table.
insert into public.lead_contact_values (lead_id, user_id, kind, value, source, collected_at)
select l.id, l.user_id, 'phone', trim(p), 'manual', l.created_at
from public.leads l, unnest(l.phones) p where trim(p) <> ''
on conflict (lead_id, kind, value) do nothing;

insert into public.lead_contact_values (lead_id, user_id, kind, value, source, collected_at)
select l.id, l.user_id, 'email', lower(trim(e)), 'manual', l.created_at
from public.leads l, unnest(l.emails) e where trim(e) <> ''
on conflict (lead_id, kind, value) do nothing;

insert into public.lead_contact_values (lead_id, user_id, kind, value, source, collected_at)
select l.id, l.user_id, 'phone', trim(l.phone), 'manual', l.created_at
from public.leads l where l.phone is not null and trim(l.phone) <> ''
on conflict (lead_id, kind, value) do nothing;

insert into public.lead_contact_values (lead_id, user_id, kind, value, source, collected_at)
select l.id, l.user_id, 'email', lower(trim(l.email)), 'manual', l.created_at
from public.leads l where l.email is not null and trim(l.email) <> ''
on conflict (lead_id, kind, value) do nothing;
