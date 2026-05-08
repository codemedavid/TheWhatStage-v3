-- =========================================================================
-- Service-role hybrid retrieval scoped to business_item chunks, with an
-- optional pre-filter to a specific set of item ids (e.g. a catalog page's
-- product_ids). Used by the recommendation engine in src/lib/chatbot.
--
-- Mirrors match_knowledge_hybrid_service but:
--   * Only considers chunks whose business_item_id is non-null and where
--     the parent item is published + rag_enabled.
--   * Optionally restricts to p_item_ids when caller supplies a non-empty
--     array (NULL or empty = no restriction beyond the user scope).
-- =========================================================================

create or replace function public.match_business_items_hybrid_service(
  p_user_id      uuid,
  p_query_text   text,
  p_query_embed  vector(1024),
  p_item_ids     uuid[] default null,
  p_match_limit  int     default 30,
  p_full_text_w  float   default 1.0,
  p_semantic_w   float   default 1.0,
  p_rrf_k        int     default 60
)
returns table (
  id               uuid,
  business_item_id uuid,
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
    select kc.id, kc.business_item_id
    from public.knowledge_chunks kc
    join public.business_items bi
      on bi.id = kc.business_item_id
    where kc.user_id = p_user_id
      and kc.business_item_id is not null
      and bi.status = 'published'
      and bi.rag_enabled
      and (p_item_ids is null or array_length(p_item_ids, 1) is null
           or kc.business_item_id = any(p_item_ids))
  ),
  fts as (
    select
      e.id,
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
      e.id,
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
    kc.business_item_id,
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

revoke all on function public.match_business_items_hybrid_service(
  uuid, text, vector, uuid[], int, float, float, int
) from public;

grant execute on function public.match_business_items_hybrid_service(
  uuid, text, vector, uuid[], int, float, float, int
) to service_role;

comment on function public.match_business_items_hybrid_service is
  'Hybrid FTS + vector retrieval scoped to business_item chunks for one user.
   Optional p_item_ids restricts to a specific catalog page''s products.
   Service-role only — caller is responsible for verifying the user_id matches
   the action page owner before invoking.';
