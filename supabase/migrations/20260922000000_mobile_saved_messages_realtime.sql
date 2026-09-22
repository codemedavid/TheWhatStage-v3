-- Mobile app foundation: operator "saved messages" (canned replies) and the
-- Realtime publication the Expo inbox subscribes to.
--
-- saved_messages: per-user reusable replies the operator can drop into a chat.
-- Bodies may contain the campaign merge tags ([first_name], [name],
-- [last_name]); they are rendered server-side at send time by
-- src/lib/agent/personalize.ts.

create table if not exists public.saved_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  body        text not null check (char_length(body) between 1 and 2000),
  shortcut    text check (shortcut is null or shortcut ~ '^[a-z0-9_-]{1,24}$'),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, shortcut)
);

create index if not exists saved_messages_user_position_idx
  on public.saved_messages (user_id, position, created_at);

alter table public.saved_messages enable row level security;

drop policy if exists saved_messages_owner_all on public.saved_messages;
create policy saved_messages_owner_all on public.saved_messages
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.saved_messages to authenticated;

-- Reuse the shared updated_at trigger if the project defines one; otherwise
-- keep it simple with an inline function.
create or replace function public.saved_messages_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists saved_messages_touch_updated_at on public.saved_messages;
create trigger saved_messages_touch_updated_at
  before update on public.saved_messages
  for each row execute function public.saved_messages_touch_updated_at();

-- Realtime: the web dashboard polls, but the mobile inbox subscribes to
-- postgres_changes. Publication membership is all that is needed — Realtime
-- enforces the existing owner RLS policies per subscriber.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messenger_messages'
  ) then
    alter publication supabase_realtime add table public.messenger_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messenger_threads'
  ) then
    alter publication supabase_realtime add table public.messenger_threads;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table public.leads;
  end if;
end $$;
