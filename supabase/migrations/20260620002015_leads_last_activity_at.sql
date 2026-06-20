-- Denormalized last_activity_at on leads = max(created_at, latest messenger
-- thread activity). Lets the leads date filters surface conversations we
-- interacted with in the window, not only leads created in it.

alter table public.leads
  add column if not exists last_activity_at timestamptz;

-- Backfill: start from created_at, then raise to the latest thread activity.
update public.leads
set last_activity_at = created_at
where last_activity_at is null;

update public.leads l
set last_activity_at = greatest(l.last_activity_at, t.last_message_at)
from public.messenger_threads t
where t.lead_id = l.id
  and t.last_message_at is not null
  and t.last_message_at > l.last_activity_at;

alter table public.leads alter column last_activity_at set not null;
alter table public.leads alter column last_activity_at set default now();

create index if not exists leads_user_activity_idx
  on public.leads (user_id, last_activity_at desc);

-- Keep last_activity_at fresh as messenger threads advance. SECURITY DEFINER so
-- the cascade succeeds regardless of who writes the thread row (webhook service
-- role, owner action, etc.); pinned search_path for safety.
create or replace function public.bump_lead_last_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.lead_id is not null
     and NEW.last_message_at is not null
     and (
       TG_OP = 'INSERT'
       or NEW.last_message_at is distinct from OLD.last_message_at
       or NEW.lead_id is distinct from OLD.lead_id
     ) then
    update public.leads
    set last_activity_at = greatest(last_activity_at, NEW.last_message_at)
    where id = NEW.lead_id
      and last_activity_at < NEW.last_message_at;
  end if;
  return NEW;
end;
$$;

drop trigger if exists messenger_threads_bump_lead_activity on public.messenger_threads;
create trigger messenger_threads_bump_lead_activity
after insert or update of last_message_at, lead_id on public.messenger_threads
for each row execute function public.bump_lead_last_activity();
