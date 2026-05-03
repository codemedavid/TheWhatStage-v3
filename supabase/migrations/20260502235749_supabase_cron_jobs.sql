create schema if not exists app_private;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create schema if not exists vault;
create extension if not exists supabase_vault with schema vault;

create or replace function app_private.invoke_cron_route(
  route_path text,
  timeout_ms integer default 10000
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  app_url text;
  cron_secret text;
  request_id bigint;
begin
  select nullif(trim(decrypted_secret), '')
    into app_url
  from vault.decrypted_secrets
  where name = 'whatstage_app_url'
  order by updated_at desc
  limit 1;

  select nullif(trim(decrypted_secret), '')
    into cron_secret
  from vault.decrypted_secrets
  where name = 'whatstage_cron_secret'
  order by updated_at desc
  limit 1;

  if app_url is null then
    raise exception 'Missing Supabase Vault secret: whatstage_app_url';
  end if;

  if cron_secret is null then
    raise exception 'Missing Supabase Vault secret: whatstage_cron_secret';
  end if;

  select net.http_get(
    url := rtrim(app_url, '/') || route_path,
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || cron_secret
    ),
    timeout_milliseconds := timeout_ms
  )
    into request_id;

  return request_id;
end;
$$;

revoke all on schema app_private from public;
revoke all on function app_private.invoke_cron_route(text, integer) from public, anon, authenticated;

do $$
declare
  job_id bigint;
begin
  for job_id in
    select jobid
    from cron.job
    where jobname in (
      'whatstage-embed-jobs',
      'whatstage-messenger-drain',
      'whatstage-comments-drain'
    )
  loop
    perform cron.unschedule(job_id);
  end loop;
end $$;

select cron.schedule(
  'whatstage-embed-jobs',
  '*/5 * * * *',
  $$select app_private.invoke_cron_route('/api/cron/embed-jobs', 290000);$$
);

select cron.schedule(
  'whatstage-messenger-drain',
  '* * * * *',
  $$select app_private.invoke_cron_route('/api/cron/messenger-drain', 10000);$$
);

select cron.schedule(
  'whatstage-comments-drain',
  '*/5 * * * *',
  $$select app_private.invoke_cron_route('/api/cron/comments-drain', 10000);$$
);
