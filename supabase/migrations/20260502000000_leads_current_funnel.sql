-- Track the active funnel node for each campaign-assigned lead.
-- NULL means the lead has no active campaign funnel yet.

alter table public.leads
  add column if not exists current_funnel_id uuid
    references public.funnels(id) on delete set null;

create index if not exists leads_user_current_funnel_idx
  on public.leads (user_id, current_funnel_id)
  where current_funnel_id is not null;

with first_funnels as (
  select distinct on (campaign_id)
    campaign_id,
    id
  from public.funnels
  order by campaign_id, position asc
)
update public.leads l
set current_funnel_id = f.id
from first_funnels f
where l.campaign_id = f.campaign_id
  and l.current_funnel_id is null;
