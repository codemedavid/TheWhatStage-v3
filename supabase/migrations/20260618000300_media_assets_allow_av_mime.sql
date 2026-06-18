-- The media-assets bucket originally only allowed image MIME types and a 10 MB
-- ceiling, but operator attachment sends (and the media library) need audio,
-- video, and PDF up to 25 MB. Uploading e.g. audio/mpeg failed with
-- "mime type audio/mpeg is not supported". Widen the allowlist + raise the limit
-- so the bucket matches the operator-upload route's contract.
update storage.buckets
set
  file_size_limit = 26214400, -- 25 MB
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/quicktime',
    'audio/mpeg',
    'audio/mp4',
    'audio/aac',
    'audio/ogg',
    'audio/webm',
    'audio/wav',
    'audio/x-wav',
    'application/pdf'
  ]
where id = 'media-assets';
