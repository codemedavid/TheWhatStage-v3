-- =========================================================================
-- Hybrid retrieval RPC: FTS + pgvector merged via Reciprocal Rank Fusion.
-- Returns the top N candidates for a user; the app reranks the result
-- with bge-reranker-v2-m3 before passing context to the LLM.
--
-- Runs as security invoker so knowledge_chunks RLS still applies. p_user_id
-- is retained for API compatibility but must match auth.uid().
-- =========================================================================

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

comment on function public.match_knowledge_hybrid is
  'Hybrid FTS + vector retrieval over knowledge_chunks for a single user.
   Returns up to p_match_limit candidates ranked by RRF. Caller must rerank.';
