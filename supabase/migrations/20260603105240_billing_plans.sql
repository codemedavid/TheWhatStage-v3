-- Billing plans (Phase 3 — flat tiers + soft caps). Keyed on the existing
-- profiles.subscription_tier values ('free' | 'pro') so there's ONE tier source
-- of truth (the superadmin UserTierToggle), not a parallel system. included_tokens
-- is a per-calendar-month SOFT cap used for display-only quota right now — nothing
-- is ever blocked. Values below are PLACEHOLDERS; the owner should tune them.
create table public.billing_plans (
  id                text primary key,              -- matches profiles.subscription_tier
  name              text not null,
  monthly_price_usd numeric(10,2) not null default 0,
  included_tokens   bigint not null,               -- soft cap / month (display-only)
  sort_order        integer not null default 0,
  active            boolean not null default true,
  updated_at        timestamptz not null default now()
);

alter table public.billing_plans enable row level security;

-- Readable by everyone (pricing/plan info is not sensitive). Writes via service
-- role only — no insert/update/delete policy for end users.
create policy "plans readable" on public.billing_plans for select using (true);

insert into public.billing_plans (id, name, monthly_price_usd, included_tokens, sort_order) values
  ('free', 'Free', 0,   2000000,   0),   -- ~560 turns/mo @ ~3,562 tok/turn (placeholder)
  ('pro',  'Pro',  0, 100000000,   1);   -- price TBD (PayMongo later); cap placeholder
