-- =========================================================================
-- Pipeline stage semantics + lead scoring foundations
--
-- Additive only: every column is nullable or has a safe default so existing
-- code paths (selects, classifier reads, RLS policies) keep working unchanged.
-- =========================================================================

-- ---------- pipeline_stages: classification + targets + signals -----------

alter table public.pipeline_stages
  add column if not exists kind text
    not null
    default 'nurture'
    check (kind in ('entry','qualifying','nurture','decision','won','lost','dormant')),
  add column if not exists is_won      boolean not null default false,
  add column if not exists is_lost     boolean not null default false,
  add column if not exists is_terminal boolean not null default false,
  add column if not exists weighted_value         numeric(4,3)
    check (weighted_value is null or (weighted_value >= 0 and weighted_value <= 1)),
  add column if not exists target_dwell_hours     integer
    check (target_dwell_hours is null or target_dwell_hours > 0),
  add column if not exists target_conversion_rate numeric(4,3)
    check (target_conversion_rate is null or (target_conversion_rate >= 0 and target_conversion_rate <= 1)),
  add column if not exists entry_signals   jsonb not null default '[]'::jsonb,
  add column if not exists exit_signals    jsonb not null default '[]'::jsonb,
  add column if not exists required_fields jsonb not null default '[]'::jsonb,
  add column if not exists next_best_action jsonb;

-- Keep is_won / is_lost / is_terminal aligned with kind when possible.
-- Done as a one-time backfill, not a trigger, so users keep manual override power.
update public.pipeline_stages
   set is_won = true, is_terminal = true
 where kind = 'won' and is_won = false;

update public.pipeline_stages
   set is_lost = true, is_terminal = true
 where kind = 'lost' and is_lost = false;

-- A stage can't be both won and lost.
alter table public.pipeline_stages
  add constraint pipeline_stages_won_xor_lost
  check (not (is_won and is_lost));

-- ---------- leads: score + journey timestamps ----------------------------

alter table public.leads
  add column if not exists score smallint
    check (score is null or (score >= 0 and score <= 100)),
  add column if not exists score_updated_at timestamptz,
  add column if not exists last_inbound_at  timestamptz,
  add column if not exists entered_stage_at timestamptz;

-- Backfill entered_stage_at from the most recent stage event per lead;
-- fall back to leads.created_at when no events exist.
update public.leads l
   set entered_stage_at = coalesce(latest.created_at, l.created_at)
  from (
    select distinct on (lead_id)
           lead_id, created_at
      from public.lead_stage_events
     order by lead_id, created_at desc
  ) latest
 where latest.lead_id = l.id
   and l.entered_stage_at is null;

update public.leads
   set entered_stage_at = created_at
 where entered_stage_at is null;

-- Now that it's populated, lock it in as not-null with a default for new rows.
alter table public.leads
  alter column entered_stage_at set default now(),
  alter column entered_stage_at set not null;

-- Helpful indexes for the upcoming insights views.
create index if not exists leads_user_score_idx
  on public.leads (user_id, score desc nulls last);

create index if not exists leads_user_entered_stage_at_idx
  on public.leads (user_id, entered_stage_at);

create index if not exists leads_user_last_inbound_at_idx
  on public.leads (user_id, last_inbound_at desc nulls last);
