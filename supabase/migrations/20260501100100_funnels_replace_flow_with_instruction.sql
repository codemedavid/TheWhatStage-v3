-- Drop the per-funnel flow array in favor of a single free-form
-- instruction string. Runtime concatenates the instruction into the
-- system prompt alongside the campaign personality and the funnel's
-- do/dont rules.

alter table public.funnels
  drop column if exists flow;

alter table public.funnels
  add column if not exists instruction text not null default ''
    check (char_length(instruction) <= 4000);
