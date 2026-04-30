-- =========================================================================
-- Action Pages: public interactive pages (Form / Booking / Qualification /
-- Sales / Catalog / Real Estate) that the chatbot deeplinks Messenger leads
-- into. Each public URL carries a signed PSID + Page id so submissions can
-- be attributed back to a lead and trigger pipeline-stage moves + Messenger
-- echoes.
--
-- Per-kind UI/handlers live in src/lib/action-pages/kinds.ts and are added
-- in follow-up PRs. This migration owns only the storage + RLS shape.
-- =========================================================================

create table public.action_pages (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  kind                  text not null check (kind in (
                          'form','booking','qualification',
                          'sales','catalog','realestate'
                        )),
  slug                  text not null unique
                          check (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  title                 text not null check (char_length(title) between 1 and 120),
  description           text,
  status                text not null default 'draft'
                          check (status in ('draft','published','archived')),
  config                jsonb not null default '{}'::jsonb,
  pipeline_rules        jsonb not null default '[]'::jsonb,
  notification_template jsonb,
  signing_secret        text not null
                          default encode(gen_random_bytes(32), 'base64'),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index action_pages_user_idx
  on public.action_pages (user_id, created_at desc);

create trigger action_pages_set_updated_at
before update on public.action_pages
for each row execute function public.set_updated_at();

-- =========================================================================
-- Submissions: every interaction (form filled, slot booked, quiz answered,
-- order placed). Linked to a lead when the deeplink carried a verified PSID.
-- =========================================================================

create table public.action_page_submissions (
  id              uuid primary key default gen_random_uuid(),
  action_page_id  uuid not null references public.action_pages(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  lead_id         uuid references public.leads(id) on delete set null,
  psid            text,
  page_id         uuid references public.facebook_pages(id) on delete set null,
  outcome         text,
  data            jsonb not null default '{}'::jsonb,
  ip_hash         text,
  user_agent      text,
  meta            jsonb,
  created_at      timestamptz not null default now()
);

create index action_page_submissions_page_idx
  on public.action_page_submissions (action_page_id, created_at desc);

create index action_page_submissions_lead_idx
  on public.action_page_submissions (lead_id, created_at desc)
  where lead_id is not null;

create index action_page_submissions_user_idx
  on public.action_page_submissions (user_id, created_at desc);

-- =========================================================================
-- Pipeline-event audit: extend the source check to include 'action_page'
-- so submission-driven stage moves show up in the lead drawer alongside
-- AI/user moves.
-- =========================================================================

alter table public.lead_stage_events
  drop constraint if exists lead_stage_events_source_check;

alter table public.lead_stage_events
  add constraint lead_stage_events_source_check
  check (source in ('ai','user','action_page'));

-- =========================================================================
-- RLS — owners read/write their own pages and submissions.
-- The public submission endpoint runs with the service-role admin client
-- and bypasses RLS; it derives ownership from action_pages.user_id.
-- =========================================================================

alter table public.action_pages             enable row level security;
alter table public.action_page_submissions  enable row level security;

create policy action_pages_owner_all on public.action_pages
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy action_page_submissions_owner_all on public.action_page_submissions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
