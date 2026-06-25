-- "Important to check" manual pin on a messenger thread (one thread per lead).
-- Powers the Inbox "Important" tab and the per-row pin toggle. The pin is
-- operator-controlled and independent of unread/missed — a thread stays pinned
-- after it has been read until the operator unpins it.
--
-- Additive + idempotent: a plain boolean column (no new table — YAGNI) plus a
-- partial index. Existing RLS on messenger_threads (user_id = auth.uid()) already
-- covers reads/writes of the new column, so no policy change is required.

alter table public.messenger_threads
  add column if not exists is_important boolean not null default false;

-- Partial index for the Inbox "Important" tab's "pinned, newest-first" scan.
-- Mirrors the existing messenger_threads_user_recent_idx exactly, including
-- `nulls last`, so it fully serves the tab's `order by last_message_at desc
-- nulls last` (a pinned thread may have no messages yet → null last_message_at).
create index if not exists messenger_threads_user_important_idx
  on public.messenger_threads (user_id, last_message_at desc nulls last)
  where is_important;
