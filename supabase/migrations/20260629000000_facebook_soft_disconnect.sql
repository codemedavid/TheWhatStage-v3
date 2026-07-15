-- =========================================================================
-- Facebook soft-disconnect
-- =========================================================================
-- Disconnecting a page used to DELETE the facebook_connections row. That
-- cascade-deleted facebook_pages -> messenger_threads -> messenger_messages
-- (+ jobs, comments, follow-ups). For a busy page that is millions of rows in
-- one transaction, which blows past statement_timeout ("canceling statement
-- due to statement timeout") AND destroys the very chat history the operator
-- needs to keep talking to those leads after reconnecting.
--
-- Instead we *pause*: mark the connection disconnected (a one-row UPDATE, no
-- cascade) and keep every page/thread/message/lead intact. Reconnect clears
-- this timestamp and reuses the same page rows (facebook_pages.fb_page_id is
-- unique; messenger_threads is unique on (page_id, psid)), so old threads and
-- leads remain fully chattable.
-- =========================================================================

alter table public.facebook_connections
  add column if not exists disconnected_at timestamptz;

comment on column public.facebook_connections.disconnected_at is
  'When set, the connection is paused (soft-disconnected): pages and Messenger '
  'history are preserved but treated as not-connected in the UI. Cleared on reconnect.';
