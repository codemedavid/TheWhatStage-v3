# Supabase Cron

Scheduled workers are owned by Supabase Cron through `pg_cron` and `pg_net`.
The migration `20260502235749_supabase_cron_jobs.sql` installs three jobs:

- `whatstage-embed-jobs` calls `/api/cron/embed-jobs` every 5 minutes.
- `whatstage-messenger-drain` calls `/api/cron/messenger-drain` every minute.
- `whatstage-comments-drain` calls `/api/cron/comments-drain` every 5 minutes.

Before applying the migration in a Supabase project, create these Vault secrets:

```sql
select vault.create_secret(
  'https://your-app.example.com',
  'whatstage_app_url',
  'Base URL for Supabase Cron HTTP callbacks'
);

select vault.create_secret(
  '<same value as the app CRON_SECRET env var>',
  'whatstage_cron_secret',
  'Bearer token for Supabase Cron HTTP callbacks'
);
```

The deployed app must have `CRON_SECRET` set to the same value as
`whatstage_cron_secret`.

Useful checks after deployment:

```sql
select jobid, schedule, jobname, command
from cron.job
where jobname like 'whatstage-%'
order by jobname;

select *
from cron.job_run_details
where jobid in (select jobid from cron.job where jobname like 'whatstage-%')
order by start_time desc
limit 20;

select *
from net._http_response
order by created desc
limit 20;
```
