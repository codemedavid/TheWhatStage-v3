-- =========================================================================
-- RAG hardening:
-- - version FAQs and embedding jobs so workers cannot commit stale chunks
-- - make hybrid retrieval security-invoker and auth.uid()-scoped
-- - hide unpublished FAQ chunks from retrieval
-- - add a service-role-only RPC for atomic chunk upsert/delete
-- =========================================================================

alter table public.knowledge_faqs
  add column if not exists version integer not null default 0;

alter table public.knowledge_embedding_jobs
  add column if not exists source_version integer not null default 0;

grant select on public.knowledge_chunks to authenticated;
grant select, insert, update, delete on public.knowledge_embedding_jobs to authenticated;

drop function if exists public.match_knowledge_hybrid(
  uuid,
  text,
  vector,
  integer,
  double precision,
  double precision,
  integer
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
  id            uuid,
  document_id   uuid,
  faq_id        uuid,
  content       text,
  heading_path  text,
  rrf_score     float
)
language sql
stable
security invoker
set search_path = public
as $$
  with fts as (
    select
      kc.id,
      row_number() over (
        order by ts_rank_cd(
          to_tsvector('simple', kc.content),
          websearch_to_tsquery('simple', p_query_text)
        ) desc
      ) as rank
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
      )
      and to_tsvector('simple', kc.content)
          @@ websearch_to_tsquery('simple', p_query_text)
    limit p_match_limit
  ),
  sem as (
    select
      kc.id,
      row_number() over (order by kc.embedding <=> p_query_embed) as rank
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
      )
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
security invoker
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
    else
      insert into public.knowledge_chunks (
        document_id,
        faq_id,
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
    end if;
  end if;

  if coalesce(array_length(p_delete_indexes, 1), 0) > 0 then
    if p_kind = 'document' then
      delete from public.knowledge_chunks kc
      where kc.document_id = p_source_id
        and kc.user_id = p_user_id
        and kc.chunk_index = any(p_delete_indexes);
    else
      delete from public.knowledge_chunks kc
      where kc.faq_id = p_source_id
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
