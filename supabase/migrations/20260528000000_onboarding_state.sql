-- =========================================================================
-- Onboarding state: tracks per-step progress for the post-signup wizard.
-- One row per profile. Created by the signup server action; backfilled for
-- pre-existing profiles in the same migration with completed_at = now() so
-- they never see the wizard.
-- =========================================================================

create table public.onboarding_state (
  profile_id uuid primary key references public.profiles(id) on delete cascade,

  -- Per-step completion. null = not done. Timestamp set on both completion
  -- and explicit skip (skipped steps are marked in ai_generations audit).
  business_completed_at         timestamptz,
  knowledge_completed_at        timestamptz,
  faqs_completed_at             timestamptz,
  personality_completed_at      timestamptz,
  goal_completed_at             timestamptz,
  goal_content_completed_at     timestamptz,
  flow_completed_at             timestamptz,

  -- Terminal states. completed_at = user finished the wizard.
  -- dismissed_at = user clicked "Skip for now" or hid the dashboard card.
  completed_at  timestamptz,
  dismissed_at  timestamptz,

  -- Captured user inputs (kept so we can regenerate AI later).
  business_basics     jsonb,
  faq_seeds           jsonb,
  personality_seeds   jsonb,
  flow_description    text,

  -- Audit trail of AI generations + skips.
  ai_generations jsonb not null default '[]'::jsonb,

  ui_language        text not null default 'tl'
    check (ui_language in ('tl','en')),
  customer_language  text not null default 'tl'
    check (customer_language in ('tl','en')),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger onboarding_state_set_updated_at
  before update on public.onboarding_state
  for each row execute function public.set_updated_at();

alter table public.onboarding_state enable row level security;

create policy onboarding_state_select_own on public.onboarding_state
  for select using (auth.uid() = profile_id);
create policy onboarding_state_insert_own on public.onboarding_state
  for insert with check (auth.uid() = profile_id);
create policy onboarding_state_update_own on public.onboarding_state
  for update using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);
-- No DELETE policy — rows cascade from profiles.

-- Backfill: existing profiles get a finished onboarding_state so they don't
-- see the wizard or the dashboard checklist after the feature ships.
insert into public.onboarding_state (profile_id, completed_at)
select id, now() from public.profiles
on conflict (profile_id) do nothing;
