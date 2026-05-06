-- Add cover_image_url to business_items for fast product card rendering.
alter table public.business_items
  add column cover_image_url text
    check (cover_image_url is null or char_length(cover_image_url) <= 600);
