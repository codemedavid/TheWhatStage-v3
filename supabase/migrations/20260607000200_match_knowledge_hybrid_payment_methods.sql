-- supabase/migrations/20260607000200_match_knowledge_hybrid_payment_methods.sql
-- Extend match_knowledge_hybrid_service to:
--   1. Include payment_method chunks (when enabled).
--   2. Accept optional p_payment_method_ids to scope to a page's methods.
--   3. Return payment_method_id in results.
--
-- Media chunks continue to be excluded — they flow through
-- match_media_assets_service / selectMediaForReply unchanged.
-- The old 7-arg overload is dropped first to avoid signature conflicts.

drop function if exists public.match_knowledge_hybrid_service(
  uuid, text, vector, int, float, float, int
);

create or replace function public.match_knowledge_hybrid_service(
  p_user_id            uuid,
  p_query_text         text,
  p_query_embed        vector(1024),
  p_match_limit        int       default 150,
  p_full_text_w        float     default 1.0,
  p_semantic_w         float     default 1.0,
  p_rrf_k              int       default 60,
  p_payment_method_ids uuid[]    default null
)
returns table (
  id                 uuid,
  document_id        uuid,
  faq_id             uuid,
  business_item_id   uuid,
  media_asset_id     uuid,
  payment_method_id  uuid,
  content            text,
  heading_path       text,
  rrf_score          float
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
        or (
          kc.payment_method_id is not null
          and exists (
            select 1
            from public.payment_methods pm
            where pm.id = kc.payment_method_id
              and pm.enabled = true
              and pm.user_id = p_user_id
          )
          and (
            p_payment_method_ids is null
            or kc.payment_method_id = any(p_payment_method_ids)
          )
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
    null::uuid                 as media_asset_id,
    kc.payment_method_id,
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
  uuid, text, vector(1024), int, float, float, int, uuid[]
) from public;

grant execute on function public.match_knowledge_hybrid_service(
  uuid, text, vector(1024), int, float, float, int, uuid[]
) to service_role;
