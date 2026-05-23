-- One-time backfill. Historical values lose true timestamp + source — they get
-- the lead's created_at and source='manual'. Idempotent: re-running is a no-op
-- because of the unique constraint.

insert into public.lead_contact_values (lead_id, user_id, kind, value, source, collected_at)
select l.id, l.user_id, 'phone', trim(p), 'manual', l.created_at
from public.leads l, unnest(l.phones) p
where trim(p) <> ''
on conflict (lead_id, kind, value) do nothing;

insert into public.lead_contact_values (lead_id, user_id, kind, value, source, collected_at)
select l.id, l.user_id, 'email', lower(trim(e)), 'manual', l.created_at
from public.leads l, unnest(l.emails) e
where trim(e) <> ''
on conflict (lead_id, kind, value) do nothing;

-- Scalar fallbacks: leads whose array is empty but scalar phone/email is set.
insert into public.lead_contact_values (lead_id, user_id, kind, value, source, collected_at)
select l.id, l.user_id, 'phone', trim(l.phone), 'manual', l.created_at
from public.leads l
where l.phone is not null and trim(l.phone) <> ''
on conflict (lead_id, kind, value) do nothing;

insert into public.lead_contact_values (lead_id, user_id, kind, value, source, collected_at)
select l.id, l.user_id, 'email', lower(trim(l.email)), 'manual', l.created_at
from public.leads l
where l.email is not null and trim(l.email) <> ''
on conflict (lead_id, kind, value) do nothing;
