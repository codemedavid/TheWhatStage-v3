-- =========================================================================
-- Facebook Conversions API (Business Messaging) — per-page configuration,
-- per-action-page event override, and an append-only dispatch log.
--
-- All additions are nullable / defaulted so existing rows stay unchanged
-- until a user opts in from Settings → Facebook → Conversions API.
-- =========================================================================

alter table public.facebook_pages
  add column capi_enabled         boolean not null default false,
  add column capi_dataset_id      text,
  add column capi_access_token    text,
  add column capi_test_event_code text;

alter table public.facebook_pages
  add constraint facebook_pages_capi_complete_when_enabled
  check (
    capi_enabled = false
    or (capi_dataset_id is not null and capi_access_token is not null)
  );

alter table public.action_pages
  add column capi_event_name_override text
  check (capi_event_name_override is null or capi_event_name_override in (
    'Lead','Schedule','Purchase','InitiateCheckout',
    'CompleteRegistration','Contact','Subscribe',
    'SubmitApplication','AddToCart','ViewContent',
    'SKIP'
  ));

create table public.capi_event_logs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  page_id         uuid references public.facebook_pages(id) on delete set null,
  submission_id   uuid references public.action_page_submissions(id) on delete set null,
  action_page_id  uuid references public.action_pages(id) on delete set null,
  event_name      text,
  event_id        text not null,
  status          text not null check (status in ('sent','skipped','error')),
  skip_reason     text check (skip_reason is null or skip_reason in (
                    'no_messenger_context','disabled','not_configured','outcome_skip'
                  )),
  http_status     integer,
  fb_trace_id     text,
  request_payload jsonb,
  response_body   jsonb,
  error_message   text,
  created_at      timestamptz not null default now()
);

create index capi_event_logs_user_idx     on public.capi_event_logs (user_id, created_at desc);
create index capi_event_logs_page_idx     on public.capi_event_logs (page_id, created_at desc);
create index capi_event_logs_event_id_idx on public.capi_event_logs (event_id);

alter table public.capi_event_logs enable row level security;

create policy capi_event_logs_owner_read on public.capi_event_logs
  for select to authenticated using (user_id = auth.uid());

create policy capi_event_logs_admin_all on public.capi_event_logs
  for all to authenticated
  using (public.current_role() in ('admin','superadmin'))
  with check (public.current_role() in ('admin','superadmin'));
