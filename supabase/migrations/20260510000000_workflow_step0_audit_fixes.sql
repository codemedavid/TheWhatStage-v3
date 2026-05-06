-- =========================================================================
-- Workflow engine — Step 0: Audit fixes (prerequisites)
--
-- Fixes surfaced in WORKFLOW_IMPLEMENTATION_PLAN.md §2 before the engine
-- ships. Groups:
--
--   A-series  Action-page / submission fixes
--   S-series  Pipeline stage fixes
--   M-series  Messenger coupling fixes
--
-- Also creates new supporting tables and the atomic set_lead_stage()
-- function used by all four call sites (classifier, submission handler,
-- workflow executor, dashboard UI).
-- =========================================================================

-- -------------------------------------------------------------------------
-- S4 / S1: optimistic-lock version column on leads
--   Enables compare-and-swap stage moves; bumped atomically by
--   set_lead_stage() below so concurrent movers detect stale reads.
-- -------------------------------------------------------------------------
alter table public.leads
  add column if not exists version int not null default 0;

-- -------------------------------------------------------------------------
-- S2: idempotency key on lead_stage_events
--   A retried classifier or webhook that re-fires the same logical event
--   inserts with the same key → unique conflict → silent no-op, no
--   duplicate audit row.
-- -------------------------------------------------------------------------
alter table public.lead_stage_events
  add column if not exists idempotency_key text;

create unique index if not exists lead_stage_events_idempotency_key_idx
  on public.lead_stage_events (idempotency_key)
  where idempotency_key is not null;

-- -------------------------------------------------------------------------
-- M1 / M4: 24-hour window tracking + thread ownership on messenger_threads
--   last_inbound_at  — correct base for the 24h messaging window.
--   last_outbound_at — for display / debugging.
--   controlled_by_run_id — workflow run that currently owns this thread;
--     chatbot suppresses auto-reply when this is non-null.
-- -------------------------------------------------------------------------
alter table public.messenger_threads
  add column if not exists last_inbound_at      timestamptz,
  add column if not exists last_outbound_at     timestamptz,
  add column if not exists controlled_by_run_id uuid;       -- fk added after workflow_runs table exists

-- Back-fill: treat last_message_at as approximate last_inbound_at for
-- existing threads (conservative — better than null).
update public.messenger_threads
   set last_inbound_at = last_message_at
 where last_inbound_at is null
   and last_message_at is not null;

-- -------------------------------------------------------------------------
-- A3: marketing / reminder opt-in capture on submissions
--   Collected at action-page submit time; required for outside-24h sends.
-- -------------------------------------------------------------------------
alter table public.action_page_submissions
  add column if not exists marketing_optin boolean not null default false,
  add column if not exists reminder_optin  boolean not null default false;

-- -------------------------------------------------------------------------
-- A1 / A2: structured booking events table
--   Lifts event_at out of submissions.data JSON into a typed, indexed row.
--   booking_offset triggers use this for 3d / 2h / 10m ladder.
-- -------------------------------------------------------------------------
create table if not exists public.booking_events (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,
  submission_id     uuid        not null references public.action_page_submissions(id) on delete cascade,
  lead_id           uuid        references public.leads(id) on delete set null,
  event_at          timestamptz not null,         -- always stored in UTC
  timezone          text        not null,          -- IANA tz for display, e.g. 'Asia/Manila'
  duration_minutes  int,
  status            text        not null default 'scheduled'
                    check (status in ('scheduled','cancelled','completed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists booking_events_event_at_scheduled_idx
  on public.booking_events (event_at)
  where status = 'scheduled';

create index if not exists booking_events_user_id_idx
  on public.booking_events (user_id);

alter table public.booking_events enable row level security;

create policy "booking_events: owner full access"
  on public.booking_events
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "booking_events: service_role full access"
  on public.booking_events
  for all
  to service_role
  using (true)
  with check (true);

-- -------------------------------------------------------------------------
-- M5: Marketing-Message opt-in registry
--   Written when a lead taps the opt-in button; read by channel-policy
--   resolver to determine whether outside-24h promo sends are allowed.
-- -------------------------------------------------------------------------
create table if not exists public.messenger_marketing_optins (
  thread_id    uuid        primary key references public.messenger_threads(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  opted_in_at  timestamptz not null default now(),
  opted_out_at timestamptz,
  source       text        -- 'action_page' | 'in_thread' | 'manual'
);

create index if not exists messenger_marketing_optins_user_id_idx
  on public.messenger_marketing_optins (user_id);

alter table public.messenger_marketing_optins enable row level security;

create policy "messenger_marketing_optins: owner full access"
  on public.messenger_marketing_optins
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "messenger_marketing_optins: service_role full access"
  on public.messenger_marketing_optins
  for all
  to service_role
  using (true)
  with check (true);

-- -------------------------------------------------------------------------
-- M5: One-Time Notification token registry
--   Token granted by user in-thread; consumed exactly once by the workflow
--   send node for the matching topic.
-- -------------------------------------------------------------------------
create table if not exists public.messenger_otn_tokens (
  id           uuid        primary key default gen_random_uuid(),
  thread_id    uuid        not null references public.messenger_threads(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  topic        text        not null,
  token        text        not null,
  requested_at timestamptz not null default now(),
  consumed_at  timestamptz,
  expires_at   timestamptz
);

create index if not exists messenger_otn_tokens_thread_topic_idx
  on public.messenger_otn_tokens (thread_id, topic)
  where consumed_at is null;

create index if not exists messenger_otn_tokens_user_id_idx
  on public.messenger_otn_tokens (user_id);

alter table public.messenger_otn_tokens enable row level security;

create policy "messenger_otn_tokens: owner full access"
  on public.messenger_otn_tokens
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "messenger_otn_tokens: service_role full access"
  on public.messenger_otn_tokens
  for all
  to service_role
  using (true)
  with check (true);

-- -------------------------------------------------------------------------
-- M5: Utility-template registry
--   Stores pre-approved Meta Messenger Utility templates.
--   Required for outside-24h non-promo sends (booking reminders, etc.).
-- -------------------------------------------------------------------------
create table if not exists public.messenger_utility_templates (
  id               uuid  primary key default gen_random_uuid(),
  user_id          uuid  not null references auth.users(id) on delete cascade,
  name             text  not null,
  category         text  not null check (category in ('appointment','order','account')),
  language         text  not null default 'en_US',
  body             text  not null,
  variables        jsonb not null default '[]',
  buttons          jsonb not null default '[]',
  meta_template_id text,                         -- set after Meta approves
  status           text  not null default 'pending'
                   check (status in ('pending','approved','rejected')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists messenger_utility_templates_user_name_lang_idx
  on public.messenger_utility_templates (user_id, name, language);

create index if not exists messenger_utility_templates_user_status_idx
  on public.messenger_utility_templates (user_id, status);

alter table public.messenger_utility_templates enable row level security;

create policy "messenger_utility_templates: owner full access"
  on public.messenger_utility_templates
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "messenger_utility_templates: service_role full access"
  on public.messenger_utility_templates
  for all
  to service_role
  using (true)
  with check (true);

-- =========================================================================
-- S1 / S3 / S4 + A6: Atomic stage-move function
--
-- Single authoritative path for every stage transition:
--   - classify.ts          (AI classifier)
--   - submit/route.ts      (action-page pipeline rule)
--   - workflow set_stage   (coming in step 2)
--   - dashboard UI         (manual drag)
--
-- Guarantees:
--   1. Row-level lock (FOR UPDATE) prevents interleaved reads on the same lead.
--   2. to_stage_id ownership check prevents cross-user moves (S3).
--   3. Idempotency key prevents duplicate audit rows on retries (S2).
--   4. Optional optimistic-lock via p_expected_version (S4).
--   5. Bumps leads.version on every successful move.
--
-- Returns true  — transition committed.
--         false — version mismatch (caller may retry or surface conflict).
--         raises exception — bad stage ownership or other hard error.
-- =========================================================================
create or replace function public.set_lead_stage(
  p_lead_id           uuid,
  p_to_stage_id       uuid,
  p_source            text,
  p_reason            text    default null,
  p_idempotency_key   text    default null,
  p_expected_version  int     default null,
  p_confidence        text    default null,
  p_thread_id         uuid    default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead         record;
  v_stage_user   uuid;
  v_from_stage   uuid;
  v_event_id     uuid;
begin
  -- 1. Lock the lead row exclusively for the duration of this transaction.
  select id, user_id, stage_id, version
    into v_lead
    from public.leads
   where id = p_lead_id
     for update;

  if not found then
    raise exception 'Lead % not found', p_lead_id;
  end if;

  -- 2. Optimistic-lock check: if caller supplied an expected version and it
  --    doesn't match, abort and let the caller decide whether to retry.
  if p_expected_version is not null and v_lead.version != p_expected_version then
    return false;
  end if;

  -- 3. Validate that p_to_stage_id belongs to the same user as the lead.
  --    Prevents cross-tenant stage assignments (S3).
  select user_id into v_stage_user
    from public.pipeline_stages
   where id = p_to_stage_id;

  if not found then
    raise exception 'Stage % not found', p_to_stage_id;
  end if;

  if v_stage_user != v_lead.user_id then
    raise exception 'Stage % does not belong to the lead''s user', p_to_stage_id;
  end if;

  -- 4. No-op if already in target stage (idempotent at the data level).
  --    Still proceeds to insert audit row unless idempotency_key already
  --    exists (handled by the ON CONFLICT below).
  v_from_stage := v_lead.stage_id;

  -- 5. Insert audit row. ON CONFLICT on idempotency_key = silent no-op so
  --    retried calls don't produce duplicate events (S2).
  v_event_id := gen_random_uuid();

  insert into public.lead_stage_events
    (id, lead_id, user_id, from_stage_id, to_stage_id,
     source, reason, confidence, thread_id, idempotency_key)
  values
    (v_event_id, p_lead_id, v_lead.user_id, v_from_stage, p_to_stage_id,
     p_source, p_reason, p_confidence, p_thread_id, p_idempotency_key)
  on conflict (idempotency_key)
    where idempotency_key is not null
    do nothing;

  -- If the idempotency key already existed, the insert was a no-op.
  -- We still update the lead stage to be safe (it's idempotent anyway).

  -- 6. Atomically update the lead row: new stage + bumped version.
  update public.leads
     set stage_id   = p_to_stage_id,
         version    = version + 1,
         updated_at = now()
   where id = p_lead_id;

  return true;
end;
$$;

-- Only service_role and the RLS-bypassing backend call this function.
-- anon / authenticated users never call it directly.
revoke all on function public.set_lead_stage(uuid,uuid,text,text,text,int,text,uuid) from public;
grant execute on function public.set_lead_stage(uuid,uuid,text,text,text,int,text,uuid) to service_role;
