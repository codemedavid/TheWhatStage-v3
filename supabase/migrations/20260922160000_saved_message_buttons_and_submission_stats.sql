-- Mobile: saved messages that carry an action-page button, plus the per-page
-- submission rollup the mobile "Submissions" monitor reads.
--
-- 1. saved_messages.action_page_id / cta_label
--    A saved message may now be a *button* message: the body is the Messenger
--    text and the button deeplinks into a published action page. The page is
--    referenced, never copied — retitling or re-slugging the page keeps every
--    saved message correct, and deleting the page degrades the saved message
--    back to plain text (on delete set null) instead of breaking the send.
--
-- 2. action_page_submission_stats()
--    PostgREST cannot group-by, so the mobile monitor would need one count
--    request per page. This returns every owned page with its submission
--    count, distinct-lead count and last fill in a single round trip.

alter table public.saved_messages
  add column if not exists action_page_id uuid
    references public.action_pages(id) on delete set null,
  add column if not exists cta_label text;

-- Meta caps a button label at 20 chars; the send layer truncates, but keeping
-- the constraint here means the editor and the DB agree on what is storable.
alter table public.saved_messages
  drop constraint if exists saved_messages_cta_label_check;
alter table public.saved_messages
  add constraint saved_messages_cta_label_check
  check (cta_label is null or char_length(btrim(cta_label)) between 1 and 20);

-- A label with no page has nothing to link to, so it is never a valid state.
alter table public.saved_messages
  drop constraint if exists saved_messages_cta_requires_page_check;
alter table public.saved_messages
  add constraint saved_messages_cta_requires_page_check
  check (action_page_id is not null or cta_label is null);

create index if not exists saved_messages_action_page_idx
  on public.saved_messages (action_page_id)
  where action_page_id is not null;

-- ---------------------------------------------------------------------------
-- Per-page submission rollup.
--
-- security invoker: both tables carry owner RLS policies, so the caller only
-- ever aggregates their own pages and submissions. Pages with zero submissions
-- are kept (left join) — "nobody has filled this yet" is exactly what the
-- monitor needs to show.
-- ---------------------------------------------------------------------------
create or replace function public.action_page_submission_stats(
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns table (
  action_page_id uuid,
  title          text,
  kind           text,
  status         text,
  submissions    bigint,
  filled         bigint,
  people         bigint,
  last_at        timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id,
    p.title,
    p.kind,
    p.status,
    count(s.id),
    -- 'implied_proceed' rows are chat-implied (the bot inferred intent); they
    -- are NOT someone filling the page in, so they get their own column.
    count(s.id) filter (where s.outcome is distinct from 'implied_proceed'),
    count(distinct s.lead_id),
    max(s.created_at)
  from public.action_pages p
  left join public.action_page_submissions s
    on s.action_page_id = p.id
   and (p_from is null or s.created_at >= p_from)
   and (p_to   is null or s.created_at <  p_to)
  group by p.id, p.title, p.kind, p.status
  order by count(s.id) desc, p.title asc
$$;

grant execute on function public.action_page_submission_stats(timestamptz, timestamptz)
  to authenticated;
