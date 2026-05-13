alter table public.profiles
  add column if not exists dismissed_stage_upgrade_at timestamptz null;
