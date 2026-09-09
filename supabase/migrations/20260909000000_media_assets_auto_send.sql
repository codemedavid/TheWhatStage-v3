-- Media library: per-asset "auto-send" flag.
--
-- Until now a library asset could only reach the chatbot when a retrieved
-- knowledge chunk (or, from this change on, the chatbot instructions) named it
-- with an @slug / #folder token. Operators asked for a second path: mark an
-- asset as sendable on its own, and let the bot pull it purely on relevance
-- (its embedded name + description ranked against the customer's message),
-- e.g. a testimonial screenshot when a customer asks for reviews.
--
-- The flag only makes the asset a CANDIDATE. The reply model still decides,
-- per asset, whether it fits the current turn.
alter table public.media_assets
  add column if not exists auto_send boolean not null default false;

comment on column public.media_assets.auto_send is
  'When true the chatbot may offer this asset as a reply attachment based on semantic relevance alone (no @slug/#folder reference required). The model still picks per turn.';

create index if not exists media_assets_user_auto_send_idx
  on public.media_assets (user_id)
  where auto_send and not is_archived;
