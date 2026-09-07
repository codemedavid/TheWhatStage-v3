-- Media library: allow voice (audio) and video assets alongside images.
-- The storage bucket was widened in 20260618000300 but the column check on
-- media_assets.mime_type still rejected anything but images, so AV files
-- could be uploaded to the bucket yet never registered as library assets.
alter table public.media_assets
  drop constraint if exists media_assets_mime_type_check;

alter table public.media_assets
  add constraint media_assets_mime_type_check check (
    mime_type in (
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/quicktime',
      'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac',
      'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm'
    )
  );

alter table public.media_assets
  add column if not exists duration_seconds integer
    check (duration_seconds is null or duration_seconds > 0);

-- Keep the bucket in step with the column check (adds audio/x-m4a).
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac',
  'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav',
  'application/pdf'
]
where id = 'media-assets';

-- Sequence steps and agent campaigns can attach library media (any kind).
alter table public.project_stage_sequence_steps
  add column if not exists media_asset_ids uuid[] not null default '{}';

alter table public.agent_campaigns
  add column if not exists media_asset_ids uuid[] not null default '{}';
