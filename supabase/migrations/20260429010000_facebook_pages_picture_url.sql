-- Add page profile picture URL to facebook_pages.
-- Populated from Graph API picture{url} during page selection.

alter table public.facebook_pages add column picture_url text;
