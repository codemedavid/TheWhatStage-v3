-- Storage bucket + RLS for knowledge document images.
-- Path layout: <user_id>/<doc_id>/<uuid>-<filename>. The first folder
-- segment is the uploader's user id, which RLS uses to authorize writes.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'knowledge-images',
  'knowledge-images',
  true,
  10485760,
  array['image/png','image/jpeg','image/gif','image/webp','image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "knowledge_images_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'knowledge-images');

create policy "knowledge_images_owner_write"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'knowledge-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "knowledge_images_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'knowledge-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "knowledge_images_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'knowledge-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
