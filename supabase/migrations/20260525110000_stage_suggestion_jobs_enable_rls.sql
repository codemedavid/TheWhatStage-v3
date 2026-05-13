-- stage_suggestion_jobs is service-role-only (admin client writes + cron reads).
-- Enable RLS without a policy so PostgREST denies all anon/authenticated access.
alter table public.stage_suggestion_jobs enable row level security;
