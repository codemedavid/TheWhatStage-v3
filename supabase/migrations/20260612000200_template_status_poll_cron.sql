-- =========================================================================
-- Schedule the template approval-status backstop poller.
--
-- Reuses the app_private.invoke_cron_route() helper + vault secrets established
-- in 20260502235749_supabase_cron_jobs.sql. The route
-- (/api/cron/template-status-poll) polls Meta for every pending message
-- template and flips approved/rejected/disabled rows — a backstop for the
-- unreliable message_template_status_update webhook (the open Templates page
-- also live-polls). Idempotent: drops any prior job of the same name first.
-- =========================================================================

do $$
declare
  job_id bigint;
begin
  for job_id in
    select jobid from cron.job where jobname = 'whatstage-template-status-poll'
  loop
    perform cron.unschedule(job_id);
  end loop;
end $$;

-- Every 2 minutes so freshly-submitted templates resolve quickly even when no
-- one has the Templates page open.
select cron.schedule(
  'whatstage-template-status-poll',
  '*/2 * * * *',
  $$select app_private.invoke_cron_route('/api/cron/template-status-poll', 60000);$$
);
