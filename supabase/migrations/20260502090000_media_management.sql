-- =========================================================================
-- Media manager: folders, image assets, RAG chunks, and Messenger image
-- idempotency.
-- =========================================================================

create table public.media_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  description text check (description is null or char_length(description) <= 2000),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid not null references public.media_folders(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,119}$'),
  description text check (description is null or char_length(description) <= 4000),
  storage_path text not null check (char_length(storage_path) between 1 and 700),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','image/gif')),
  byte_size integer not null check (byte_size > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  position integer not null default 0,
  is_archived boolean not null default false,
  embedding_status text not null default 'pending' check (embedding_status in ('pending','indexed','stale')),
  version integer not null default 0 check (version >= 0),
  embedded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index media_folders_user_position_idx
  on public.media_folders (user_id, position, created_at);

create index media_assets_user_folder_position_idx
  on public.media_assets (user_id, folder_id, position, created_at);

create index media_assets_user_active_idx
  on public.media_assets (user_id, updated_at desc)
  where not is_archived;

create index media_assets_search_idx
  on public.media_assets
  using gin (
    to_tsvector(
      'simple'::regconfig,
      coalesce(name, '') || ' ' || coalesce(slug, '') || ' ' || coalesce(description, '')
    )
  );

create trigger media_folders_set_updated_at
before update on public.media_folders
for each row execute function public.set_updated_at();

create trigger media_assets_set_updated_at
before update on public.media_assets
for each row execute function public.set_updated_at();

alter table public.media_folders enable row level security;
alter table public.media_assets enable row level security;

create policy media_folders_owner_all on public.media_folders
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy media_assets_owner_all on public.media_assets
  for all to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.media_folders mf
      where mf.id = media_assets.folder_id
        and mf.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.media_folders mf
      where mf.id = media_assets.folder_id
        and mf.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.media_folders to authenticated;
grant select, insert, update, delete on public.media_assets to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-assets',
  'media-assets',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "media_assets_owner_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'media-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "media_assets_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'media-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "media_assets_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'media-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'media-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "media_assets_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'media-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

alter table public.knowledge_chunks
  add column if not exists media_asset_id uuid references public.media_assets(id) on delete cascade;

alter table public.knowledge_chunks
  drop constraint if exists knowledge_chunks_one_source;

alter table public.knowledge_chunks
  add constraint knowledge_chunks_one_source
  check (num_nonnulls(document_id, faq_id, business_item_id, media_asset_id) = 1);

alter table public.knowledge_chunks
  add constraint knowledge_chunks_media_asset_chunk_uniq unique (media_asset_id, chunk_index);

alter table public.knowledge_embedding_jobs
  add column if not exists media_asset_id uuid references public.media_assets(id) on delete cascade;

alter table public.knowledge_embedding_jobs
  drop constraint if exists knowledge_embedding_jobs_one_source;

alter table public.knowledge_embedding_jobs
  add constraint knowledge_embedding_jobs_one_source
  check (num_nonnulls(document_id, faq_id, business_item_id, media_asset_id) = 1);

create unique index knowledge_embedding_jobs_active_media_asset_uniq
  on public.knowledge_embedding_jobs (media_asset_id)
  where media_asset_id is not null and status in ('queued','running');

alter table public.messenger_messages
  add column if not exists media_asset_id uuid references public.media_assets(id) on delete set null;

alter table public.messenger_jobs
  add column if not exists outbound_media jsonb not null default '[]'::jsonb;

-- Keep text-answer retrieval excluding media_asset_id. Media is selected by
-- match_media_assets.
drop function if exists public.match_knowledge_hybrid(
  uuid, text, vector, int, float, float, int
);

create or replace function public.match_knowledge_hybrid(
  p_user_id      uuid,
  p_query_text   text,
  p_query_embed  vector(1024),
  p_match_limit  int     default 150,
  p_full_text_w  float   default 1.0,
  p_semantic_w   float   default 1.0,
  p_rrf_k        int     default 60
)
returns table (
  id               uuid,
  document_id      uuid,
  faq_id           uuid,
  business_item_id uuid,
  media_asset_id   uuid,
  content          text,
  heading_path     text,
  rrf_score        float
)
language sql
stable
security invoker
set search_path = public
as $$
  with eligible as (
    select kc.id
    from public.knowledge_chunks kc
    where auth.uid() is not null
      and p_user_id = auth.uid()
      and kc.user_id = auth.uid()
      and (
        kc.document_id is not null
        or exists (
          select 1
          from public.knowledge_faqs f
          where f.id = kc.faq_id
            and f.is_published
        )
        or exists (
          select 1
          from public.business_items bi
          where bi.id = kc.business_item_id
            and bi.status = 'published'
            and bi.rag_enabled
        )
      )
  ),
  fts as (
    select
      kc.id,
      row_number() over (
        order by ts_rank_cd(
          to_tsvector('simple', kc.content),
          websearch_to_tsquery('simple', p_query_text)
        ) desc
      ) as rank
    from public.knowledge_chunks kc
    join eligible e on e.id = kc.id
    where to_tsvector('simple', kc.content)
          @@ websearch_to_tsquery('simple', p_query_text)
    limit p_match_limit
  ),
  sem as (
    select
      kc.id,
      row_number() over (order by kc.embedding <=> p_query_embed) as rank
    from public.knowledge_chunks kc
    join eligible e on e.id = kc.id
    order by kc.embedding <=> p_query_embed
    limit p_match_limit
  ),
  fused as (
    select id from fts
    union
    select id from sem
  )
  select
    kc.id,
    kc.document_id,
    kc.faq_id,
    kc.business_item_id,
    null::uuid as media_asset_id,
    kc.content,
    kc.heading_path,
    coalesce(p_full_text_w / (p_rrf_k + fts.rank), 0)
      + coalesce(p_semantic_w / (p_rrf_k + sem.rank), 0) as rrf_score
  from fused
  join public.knowledge_chunks kc on kc.id = fused.id
  left join fts on fts.id = kc.id
  left join sem on sem.id = kc.id
  where kc.user_id = auth.uid()
  order by rrf_score desc
  limit p_match_limit;
$$;

revoke all on function public.match_knowledge_hybrid(
  uuid, text, vector, int, float, float, int
) from public;

grant execute on function public.match_knowledge_hybrid(
  uuid, text, vector, int, float, float, int
) to authenticated;

comment on function public.match_knowledge_hybrid is
  'Hybrid FTS + vector retrieval over non-media knowledge_chunks for a single user.
   Returns up to p_match_limit candidates ranked by RRF. Caller must rerank.';

drop function if exists public.match_knowledge_hybrid_service(
  uuid, text, vector, int, float, float, int
);

create or replace function public.match_knowledge_hybrid_service(
  p_user_id      uuid,
  p_query_text   text,
  p_query_embed  vector(1024),
  p_match_limit  int     default 150,
  p_full_text_w  float   default 1.0,
  p_semantic_w   float   default 1.0,
  p_rrf_k        int     default 60
)
returns table (
  id               uuid,
  document_id      uuid,
  faq_id           uuid,
  business_item_id uuid,
  media_asset_id   uuid,
  content          text,
  heading_path     text,
  rrf_score        float
)
language sql
stable
security definer
set search_path = public
as $$
  with eligible as (
    select kc.id
    from public.knowledge_chunks kc
    where kc.user_id = p_user_id
      and (
        kc.document_id is not null
        or exists (
          select 1
          from public.knowledge_faqs f
          where f.id = kc.faq_id
            and f.is_published
        )
        or exists (
          select 1
          from public.business_items bi
          where bi.id = kc.business_item_id
            and bi.status = 'published'
            and bi.rag_enabled
        )
      )
  ),
  fts as (
    select
      kc.id,
      row_number() over (
        order by ts_rank_cd(
          to_tsvector('simple', kc.content),
          websearch_to_tsquery('simple', p_query_text)
        ) desc
      ) as rank
    from public.knowledge_chunks kc
    join eligible e on e.id = kc.id
    where to_tsvector('simple', kc.content)
          @@ websearch_to_tsquery('simple', p_query_text)
    limit p_match_limit
  ),
  sem as (
    select
      kc.id,
      row_number() over (order by kc.embedding <=> p_query_embed) as rank
    from public.knowledge_chunks kc
    join eligible e on e.id = kc.id
    order by kc.embedding <=> p_query_embed
    limit p_match_limit
  ),
  fused as (
    select id from fts
    union
    select id from sem
  )
  select
    kc.id,
    kc.document_id,
    kc.faq_id,
    kc.business_item_id,
    null::uuid as media_asset_id,
    kc.content,
    kc.heading_path,
    coalesce(p_full_text_w / (p_rrf_k + fts.rank), 0)
      + coalesce(p_semantic_w / (p_rrf_k + sem.rank), 0) as rrf_score
  from fused
  join public.knowledge_chunks kc on kc.id = fused.id
  left join fts on fts.id = kc.id
  left join sem on sem.id = kc.id
  where kc.user_id = p_user_id
  order by rrf_score desc
  limit p_match_limit;
$$;

revoke all on function public.match_knowledge_hybrid_service(
  uuid, text, vector, int, float, float, int
) from public;

grant execute on function public.match_knowledge_hybrid_service(
  uuid, text, vector, int, float, float, int
) to service_role;

create or replace function public.apply_knowledge_ingest(
  p_kind           text,
  p_source_id      uuid,
  p_user_id        uuid,
  p_source_version integer,
  p_rows           jsonb default '[]'::jsonb,
  p_delete_indexes integer[] default '{}'::integer[]
)
returns table (
  applied         boolean,
  current_version integer
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_current_version integer;
begin
  if p_kind = 'document' then
    select d.version
      into v_current_version
    from public.knowledge_documents d
    where d.id = p_source_id
      and d.user_id = p_user_id;
  elsif p_kind = 'faq' then
    select f.version
      into v_current_version
    from public.knowledge_faqs f
    where f.id = p_source_id
      and f.user_id = p_user_id;
  elsif p_kind = 'business_item' then
    select bi.version
      into v_current_version
    from public.business_items bi
    where bi.id = p_source_id
      and bi.user_id = p_user_id
      and bi.status = 'published'
      and bi.rag_enabled
      and nullif(trim(coalesce(bi.rag_text, '')), '') is not null;
  elsif p_kind = 'media_asset' then
    select ma.version
      into v_current_version
    from public.media_assets ma
    where ma.id = p_source_id
      and ma.user_id = p_user_id;
  else
    raise exception 'unknown RAG source kind: %', p_kind;
  end if;

  if v_current_version is null then
    raise exception 'RAG source not found: % %', p_kind, p_source_id;
  end if;

  if v_current_version <> p_source_version then
    applied := false;
    current_version := v_current_version;
    return next;
    return;
  end if;

  if jsonb_array_length(p_rows) > 0 then
    if p_kind = 'document' then
      insert into public.knowledge_chunks (
        document_id,
        faq_id,
        business_item_id,
        media_asset_id,
        user_id,
        chunk_index,
        content,
        heading_path,
        source_offset,
        token_count,
        content_hash,
        is_atomic,
        embedding
      )
      select
        p_source_id,
        null::uuid,
        null::uuid,
        null::uuid,
        p_user_id,
        r.chunk_index,
        r.content,
        r.heading_path,
        nullif(r.source_offset, '')::int4range,
        r.token_count,
        r.content_hash,
        r.is_atomic,
        r.embedding::text::vector
      from jsonb_to_recordset(p_rows) as r(
        chunk_index integer,
        content text,
        heading_path text,
        source_offset text,
        token_count integer,
        content_hash text,
        is_atomic boolean,
        embedding jsonb
      )
      on conflict (document_id, chunk_index) do update
        set content = excluded.content,
            heading_path = excluded.heading_path,
            source_offset = excluded.source_offset,
            token_count = excluded.token_count,
            content_hash = excluded.content_hash,
            is_atomic = excluded.is_atomic,
            embedding = excluded.embedding,
            updated_at = now();
    elsif p_kind = 'faq' then
      insert into public.knowledge_chunks (
        document_id,
        faq_id,
        business_item_id,
        media_asset_id,
        user_id,
        chunk_index,
        content,
        heading_path,
        source_offset,
        token_count,
        content_hash,
        is_atomic,
        embedding
      )
      select
        null::uuid,
        p_source_id,
        null::uuid,
        null::uuid,
        p_user_id,
        r.chunk_index,
        r.content,
        r.heading_path,
        nullif(r.source_offset, '')::int4range,
        r.token_count,
        r.content_hash,
        r.is_atomic,
        r.embedding::text::vector
      from jsonb_to_recordset(p_rows) as r(
        chunk_index integer,
        content text,
        heading_path text,
        source_offset text,
        token_count integer,
        content_hash text,
        is_atomic boolean,
        embedding jsonb
      )
      on conflict (faq_id, chunk_index) do update
        set content = excluded.content,
            heading_path = excluded.heading_path,
            source_offset = excluded.source_offset,
            token_count = excluded.token_count,
            content_hash = excluded.content_hash,
            is_atomic = excluded.is_atomic,
            embedding = excluded.embedding,
            updated_at = now();
    elsif p_kind = 'business_item' then
      insert into public.knowledge_chunks (
        document_id,
        faq_id,
        business_item_id,
        media_asset_id,
        user_id,
        chunk_index,
        content,
        heading_path,
        source_offset,
        token_count,
        content_hash,
        is_atomic,
        embedding
      )
      select
        null::uuid,
        null::uuid,
        p_source_id,
        null::uuid,
        p_user_id,
        r.chunk_index,
        r.content,
        r.heading_path,
        nullif(r.source_offset, '')::int4range,
        r.token_count,
        r.content_hash,
        r.is_atomic,
        r.embedding::text::vector
      from jsonb_to_recordset(p_rows) as r(
        chunk_index integer,
        content text,
        heading_path text,
        source_offset text,
        token_count integer,
        content_hash text,
        is_atomic boolean,
        embedding jsonb
      )
      on conflict (business_item_id, chunk_index) do update
        set content = excluded.content,
            heading_path = excluded.heading_path,
            source_offset = excluded.source_offset,
            token_count = excluded.token_count,
            content_hash = excluded.content_hash,
            is_atomic = excluded.is_atomic,
            embedding = excluded.embedding,
            updated_at = now();
    else
      insert into public.knowledge_chunks (
        document_id,
        faq_id,
        business_item_id,
        media_asset_id,
        user_id,
        chunk_index,
        content,
        heading_path,
        source_offset,
        token_count,
        content_hash,
        is_atomic,
        embedding
      )
      select
        null::uuid,
        null::uuid,
        null::uuid,
        p_source_id,
        p_user_id,
        r.chunk_index,
        r.content,
        r.heading_path,
        nullif(r.source_offset, '')::int4range,
        r.token_count,
        r.content_hash,
        r.is_atomic,
        r.embedding::text::vector
      from jsonb_to_recordset(p_rows) as r(
        chunk_index integer,
        content text,
        heading_path text,
        source_offset text,
        token_count integer,
        content_hash text,
        is_atomic boolean,
        embedding jsonb
      )
      on conflict (media_asset_id, chunk_index) do update
        set content = excluded.content,
            heading_path = excluded.heading_path,
            source_offset = excluded.source_offset,
            token_count = excluded.token_count,
            content_hash = excluded.content_hash,
            is_atomic = excluded.is_atomic,
            embedding = excluded.embedding,
            updated_at = now();
    end if;
  end if;

  if coalesce(array_length(p_delete_indexes, 1), 0) > 0 then
    if p_kind = 'document' then
      delete from public.knowledge_chunks kc
      where kc.document_id = p_source_id
        and kc.user_id = p_user_id
        and kc.chunk_index = any(p_delete_indexes);
    elsif p_kind = 'faq' then
      delete from public.knowledge_chunks kc
      where kc.faq_id = p_source_id
        and kc.user_id = p_user_id
        and kc.chunk_index = any(p_delete_indexes);
    elsif p_kind = 'business_item' then
      delete from public.knowledge_chunks kc
      where kc.business_item_id = p_source_id
        and kc.user_id = p_user_id
        and kc.chunk_index = any(p_delete_indexes);
    else
      delete from public.knowledge_chunks kc
      where kc.media_asset_id = p_source_id
        and kc.user_id = p_user_id
        and kc.chunk_index = any(p_delete_indexes);
    end if;
  end if;

  applied := true;
  current_version := v_current_version;
  return next;
end;
$$;

revoke all on function public.apply_knowledge_ingest(
  text, uuid, uuid, integer, jsonb, integer[]
) from public;

grant execute on function public.apply_knowledge_ingest(
  text, uuid, uuid, integer, jsonb, integer[]
) to service_role;

create or replace function public.match_media_assets(
  p_user_id uuid,
  p_query_text text,
  p_query_embed vector(1024),
  p_match_limit int default 40,
  p_full_text_w float default 1.0,
  p_semantic_w float default 1.0,
  p_rrf_k int default 60
)
returns table (
  media_asset_id uuid,
  chunk_id uuid,
  rrf_score float
)
language sql
stable
security invoker
set search_path = public
as $$
  with eligible as (
    select kc.id
    from public.knowledge_chunks kc
    join public.media_assets ma on ma.id = kc.media_asset_id
    where auth.uid() is not null
      and p_user_id = auth.uid()
      and kc.user_id = auth.uid()
      and ma.user_id = auth.uid()
      and not ma.is_archived
  ),
  fts as (
    select kc.id,
           row_number() over (
             order by ts_rank_cd(
               to_tsvector('simple', kc.content),
               websearch_to_tsquery('simple', p_query_text)
             ) desc
           ) as rank
    from public.knowledge_chunks kc
    join eligible e on e.id = kc.id
    where to_tsvector('simple', kc.content) @@ websearch_to_tsquery('simple', p_query_text)
    limit p_match_limit
  ),
  sem as (
    select kc.id,
           row_number() over (order by kc.embedding <=> p_query_embed) as rank
    from public.knowledge_chunks kc
    join eligible e on e.id = kc.id
    order by kc.embedding <=> p_query_embed
    limit p_match_limit
  ),
  fused as (
    select id from fts
    union
    select id from sem
  )
  select kc.media_asset_id,
         kc.id as chunk_id,
         coalesce(p_full_text_w / (p_rrf_k + fts.rank), 0)
           + coalesce(p_semantic_w / (p_rrf_k + sem.rank), 0) as rrf_score
  from fused
  join public.knowledge_chunks kc on kc.id = fused.id
  left join fts on fts.id = kc.id
  left join sem on sem.id = kc.id
  where kc.user_id = auth.uid()
    and kc.media_asset_id is not null
  order by rrf_score desc
  limit p_match_limit;
$$;

revoke all on function public.match_media_assets(
  uuid, text, vector, int, float, float, int
) from public;

grant execute on function public.match_media_assets(
  uuid, text, vector, int, float, float, int
) to authenticated;

create or replace function public.match_media_assets_service(
  p_user_id uuid,
  p_query_text text,
  p_query_embed vector(1024),
  p_match_limit int default 40,
  p_full_text_w float default 1.0,
  p_semantic_w float default 1.0,
  p_rrf_k int default 60
)
returns table (
  media_asset_id uuid,
  chunk_id uuid,
  rrf_score float
)
language sql
stable
security definer
set search_path = public
as $$
  with eligible as (
    select kc.id
    from public.knowledge_chunks kc
    join public.media_assets ma on ma.id = kc.media_asset_id
    where kc.user_id = p_user_id
      and ma.user_id = p_user_id
      and not ma.is_archived
  ),
  fts as (
    select kc.id,
           row_number() over (
             order by ts_rank_cd(
               to_tsvector('simple', kc.content),
               websearch_to_tsquery('simple', p_query_text)
             ) desc
           ) as rank
    from public.knowledge_chunks kc
    join eligible e on e.id = kc.id
    where to_tsvector('simple', kc.content) @@ websearch_to_tsquery('simple', p_query_text)
    limit p_match_limit
  ),
  sem as (
    select kc.id,
           row_number() over (order by kc.embedding <=> p_query_embed) as rank
    from public.knowledge_chunks kc
    join eligible e on e.id = kc.id
    order by kc.embedding <=> p_query_embed
    limit p_match_limit
  ),
  fused as (
    select id from fts
    union
    select id from sem
  )
  select kc.media_asset_id,
         kc.id as chunk_id,
         coalesce(p_full_text_w / (p_rrf_k + fts.rank), 0)
           + coalesce(p_semantic_w / (p_rrf_k + sem.rank), 0) as rrf_score
  from fused
  join public.knowledge_chunks kc on kc.id = fused.id
  left join fts on fts.id = kc.id
  left join sem on sem.id = kc.id
  where kc.user_id = p_user_id
    and kc.media_asset_id is not null
  order by rrf_score desc
  limit p_match_limit;
$$;

revoke all on function public.match_media_assets_service(
  uuid, text, vector, int, float, float, int
) from public;

grant execute on function public.match_media_assets_service(
  uuid, text, vector, int, float, float, int
) to service_role;

drop function if exists public.claim_messenger_jobs(int, int);

create or replace function public.claim_messenger_jobs(
  p_limit          int default 5,
  p_stale_seconds int default 300
)
returns table (
  id                    uuid,
  thread_id             uuid,
  inbound_msg_id        uuid,
  user_id               uuid,
  attempts              integer,
  outbound_text_fb_id   text,
  outbound_button_fb_id text,
  outbound_media        jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Reset stuck running jobs (worker invocation crashed before finishing).
  update public.messenger_jobs
     set status = 'queued',
         started_at = null
   where status = 'running'
     and started_at is not null
     and started_at <= now() - make_interval(secs => p_stale_seconds);

  return query
  with picked as (
    select j.id,
           j.thread_id,
           j.inbound_msg_id,
           j.user_id,
           j.attempts,
           j.outbound_text_fb_id,
           j.outbound_button_fb_id,
           j.outbound_media
      from public.messenger_jobs j
     where j.status = 'queued'
       and j.scheduled_at <= now()
       and not exists (
         select 1
           from public.messenger_jobs r
          where r.thread_id = j.thread_id
            and r.status = 'running'
       )
       and not exists (
         select 1
           from public.messenger_jobs e
          where e.thread_id = j.thread_id
            and e.status = 'queued'
            and (
              e.scheduled_at < j.scheduled_at
              or (e.scheduled_at = j.scheduled_at and e.id < j.id)
            )
       )
     order by j.scheduled_at, j.id
     limit greatest(p_limit, 1)
     for update skip locked
  )
  update public.messenger_jobs j
     set status = 'running',
         started_at = now()
    from picked p
   where j.id = p.id
     and j.status = 'queued'
  returning j.id,
            j.thread_id,
            j.inbound_msg_id,
            j.user_id,
            j.attempts,
            j.outbound_text_fb_id,
            j.outbound_button_fb_id,
            j.outbound_media;
end;
$$;

revoke all on function public.claim_messenger_jobs(int, int) from public;
grant execute on function public.claim_messenger_jobs(int, int) to service_role;
