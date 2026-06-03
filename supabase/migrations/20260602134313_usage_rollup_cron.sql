-- =========================================================================
-- Schedule the hourly usage rollup (Phase 2 — see USAGE_BILLING_PLAN.md).
--
-- Reuses the app_private.invoke_cron_route() helper + vault secrets established
-- in 20260502235749_supabase_cron_jobs.sql. The route (/api/cron/usage-rollup)
-- calls rollup_llm_usage_daily(). Idempotent: drops any prior job of the same
-- name before (re)scheduling.
-- =========================================================================

do $$
declare
  job_id bigint;
begin
  for job_id in
    select jobid from cron.job where jobname = 'whatstage-usage-rollup'
  loop
    perform cron.unschedule(job_id);
  end loop;
end $$;

-- Hourly at :07 (offset from other jobs to spread load).
select cron.schedule(
  'whatstage-usage-rollup',
  '7 * * * *',
  $$select app_private.invoke_cron_route('/api/cron/usage-rollup', 60000);$$
);
