-- =========================================================================
-- Allow facebook_lead_comments rows without a linked lead so we can land the
-- canonical record at processing time (e.g. first-time commenters who we
-- privately reply to). The lead_id is filled in later when the commenter's
-- DM thread resolves to a lead via resolveCommentBridgesForThread.
-- =========================================================================

alter table public.facebook_lead_comments
  alter column lead_id drop not null;

-- Fast lookup of unmatched comments at bridge-resolution time.
create index facebook_lead_comments_unmatched_identity_idx
  on public.facebook_lead_comments (page_id, commenter_id)
  where lead_id is null and commenter_id is not null;
