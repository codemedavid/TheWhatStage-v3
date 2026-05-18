-- =========================================================================
-- Lead Reminder Sequences: customer-requested 7-touchpoint Fibonacci-cadence
-- follow-ups. Sequence row holds anchor + topic + lifecycle status. Each of
-- the 7 touchpoints is a regular lead_reminders row, linked by sequence_id
-- + sequence_position, so the existing cron + worker + dashboard keep working.
-- =========================================================================

create table public.lead_reminder_sequences (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id)               on delete cascade,
  lead_id       uuid not null references public.leads(id)             on delete cascade,
  thread_id     uuid not null references public.messenger_threads(id) on delete cascade,

  anchor_at     timestamptz not null,
  topic         text not null check (char_length(topic) between 1 and 500),
  source_message_id uuid references public.messenger_messages(id) on delete set null,

  status text not null default 'active'
    check (status in ('active','resolved','cancelled','exhausted')),
  resolved_at     timestamptz,
  resolved_reason text check (resolved_reason in ('topic_addressed','manual','rescheduled')),
  cancelled_at    timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Only one active sequence per lead.
create unique index uniq_active_reminder_sequence_per_lead
  on public.lead_reminder_sequences (lead_id)
  where status = 'active';

create index idx_reminder_sequences_user_status
  on public.lead_reminder_sequences (user_id, status, anchor_at desc);

alter table public.lead_reminder_sequences enable row level security;

create policy "lead_reminder_sequences_owner_rw" on public.lead_reminder_sequences
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.touch_lead_reminder_sequences_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger lead_reminder_sequences_touch_updated_at
  before update on public.lead_reminder_sequences
  for each row execute function public.touch_lead_reminder_sequences_updated_at();

-- Extend lead_reminders so touchpoints can carry sequence metadata + the
-- pre-generated message content.
alter table public.lead_reminders
  add column sequence_id        uuid references public.lead_reminder_sequences(id) on delete cascade,
  add column sequence_position  smallint check (sequence_position between 0 and 6),
  add column pre_generated_text text check (char_length(pre_generated_text) <= 2000),
  add column fallback_text      text check (char_length(fallback_text) <= 2000);

create unique index uniq_reminder_sequence_position
  on public.lead_reminders (sequence_id, sequence_position)
  where sequence_id is not null;
