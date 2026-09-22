-- The mobile inbox's "Unread" filter and its tab-bar badge count both filter on
-- (unread_count > 0 OR missed_count > 0). Neither predicate was indexed, so both
-- fell back to messenger_threads_user_recent_idx and discarded most of what they
-- read: on a 1.8k-thread account the count scanned 1,865 rows to return 430
-- (~256 ms). This partial index carries the same sort key as the unfiltered list
-- so the filtered page needs no extra sort.
create index if not exists messenger_threads_user_unread_idx
  on public.messenger_threads (user_id, last_message_at desc nulls last)
  where unread_count > 0 or missed_count > 0;
