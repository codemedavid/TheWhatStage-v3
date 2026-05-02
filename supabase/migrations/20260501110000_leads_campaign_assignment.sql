-- =========================================================================
-- Leads ↔ Campaigns: assign each lead to a campaign so the chatbot knows
-- which funnel to run. NULL means "no campaign — fall back to the user's
-- default chatbot configuration (the main bot)".
--
-- Random selection happens in the createLead server action (not a trigger)
-- so it remains visible/testable in app code; the column itself is just a
-- nullable FK with on-delete-set-null to keep leads alive if a campaign
-- gets removed.
-- =========================================================================

alter table public.leads
  add column campaign_id uuid references public.campaigns(id) on delete set null;

create index leads_user_campaign_idx
  on public.leads (user_id, campaign_id)
  where campaign_id is not null;

create index leads_campaign_created_idx
  on public.leads (campaign_id, created_at desc)
  where campaign_id is not null;
