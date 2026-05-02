# WhatStage RAG Pipeline — Implementation Plan

**Date:** 2026-04-29
**Owner:** John Angelo David
**Status:** Approved, ready to implement
**Stack constraint:** HuggingFace-only models. No paid APIs (Anthropic / Cohere / OpenAI / Voyage). Self-hosted infra only where serverless HF cannot serve.

---

## 1. Goals

1. Build a Retrieval-Augmented Generation pipeline over the existing `knowledge_documents` and `knowledge_faqs` tables.
2. Embed knowledge on save; re-embed on edit; never duplicate chunks across edits.
3. Skip re-embedding chunks whose content did not change (cost + latency saver).
4. Stream answers from an open-source LLM tuned (or competent) for Tagalog / Taglish.
5. Every unit individually testable. Pure functions where possible.
6. Future-proof for document uploads (PDF, DOCX, etc.) without rewriting the pipeline.

## 2. Non-goals (v1)

- Anthropic Contextual Retrieval (gated behind a future flag; not shipping in v1).
- ColPali / vision RAG.
- Multi-tenant beyond per-user RLS (already in place).
- Open-ended ReAct / agentic loops. v1 is bounded CRAG only.
- Image embeddings. Knowledge images stay as references inside the document text.

## 3. Final stack (locked)

| Stage          | Choice                                          | Endpoint                                                   |
| -------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| Embedding      | `BAAI/bge-m3` (1024-dim dense)                  | `@huggingface/inference` → `featureExtraction`, `hf-inference` provider |
| Reranker       | `BAAI/bge-reranker-v2-m3` (568M, multilingual)  | `@huggingface/inference` → `textClassification`, `hf-inference` provider |
| LLM (default)  | `meta-llama/Llama-3.3-70B-Instruct:groq`        | OpenAI client → `https://router.huggingface.co/v1`         |
| LLM (alts)     | `Llama-4-Maverick-17B-128E-Instruct`, `Qwen2.5-72B-Instruct` | Same router, switched via env var                |
| Vector store   | Supabase pgvector 0.8+ HNSW (`m=16, ef_construction=64`) | `iterative_scan = relaxed_order`                  |
| Hybrid search  | Postgres FTS (`tsvector`) + vector → RRF (`k=60`) | Single SQL RPC                                           |
| Pipeline shape | Bounded CRAG: retrieve → rerank → grade → optional one-shot rewrite → generate | —                          |

### Why these choices

- **bge-m3**: multilingual including Tagalog, 8K context, free, available serverlessly on `hf-inference`. Returns 1024-dim dense vectors via `featureExtraction` (note: NOT `sentenceSimilarity`, which only returns scores).
- **bge-reranker-v2-m3**: Qwen3-Reranker is **not** deployed on HF Inference Providers. bge-reranker-v2-m3 is the strongest multilingual reranker that **is** serverless, same family as the embedder, supports Tagalog.
- **Llama-3.3-70B via Groq**: sub-second TTFT through HF router, handles Taglish well via in-context prompting, no GPU to manage. Confirmed on FilBench-style code-switched evals.
- **Bounded CRAG over Self-RAG**: open-ended loops break Messenger-style latency budgets; one bounded retrieval → optional one-shot rewrite is the sweet spot.

## 4. Architecture

### 4.1 Source-agnostic ingestion

```
source → parser → markdown → normalizer → chunker → diff → embed → upsert
```

Per-source parsers (add as the upload feature grows):

| Source                | Parser                      | Status        |
| --------------------- | --------------------------- | ------------- |
| TipTap editor (now)   | `tiptap.ts`: JSON → markdown via TipTap serializer, fallback HTML→md via `turndown` | v1            |
| FAQ rows (now)        | `faq.ts`: `Q: ...\nA: ...`, atomic | v1            |
| PDF                   | `pdfjs-dist` or `unpdf`     | v2 (upload feature) |
| DOCX                  | `mammoth` → HTML → markdown | v2            |
| Plain text / `.md`    | identity                    | v2            |
| HTML pages            | `@mozilla/readability` + `turndown` | v2     |
| Scanned PDFs / images | OCR (Tesseract or vision)   | v3            |

All paths converge into the same chunker, so chunking is tested once.

### 4.2 Chunker algorithm

Two-pass recursive splitter, header-aware.

**Pass 1 — semantic split** in this priority, stopping the moment a chunk fits the size budget:
`H1 → H2 → H3 → blank line → paragraph → sentence → word`.

**Pass 2 — size enforcement**: target **800 tokens, max 1024, overlap 100 tokens**.
Token counting via `js-tiktoken` cl100k_base — used for sizing only, not for model input.

**Header inheritance**: each chunk records its H1/H2/H3 path in `heading_path`, prepended to the embedded text:
```
# Refund policy > Eligibility

<chunk text>
```
Deterministic, free, no extra LLM call. Captures most of the contextual-retrieval benefit without an Anthropic dependency.

**Atomic markers**: chunks flagged `atomic=true` (FAQs, code blocks, tables) are never split. Oversized atomics are truncated with a warning logged.

### 4.3 No-duplicate-on-edit guarantee

Three layers:

1. **Stable key**: `knowledge_chunks` is `unique (document_id, chunk_index)`. Always upsert, never plain insert.
2. **Content hash**: `content_hash = sha256(normalized_content)`. If hash unchanged for that `chunk_index`, skip embedding entirely.
3. **Tombstone delete**: chunks present in the previous version but missing in the new one are deleted in the same transaction.

Saving turns into: `{insert: N, update: M, delete: K, skip: rest}`. On a small edit, `skip` is most chunks.

### 4.4 Queue (confirmed)

Saving a document inserts a row into `knowledge_embedding_jobs` (status `queued`). A worker claims jobs with `for update skip locked`, runs the ingest, and marks `done` or `failed` with backoff.

Worker host options (decide before slice 6):
- **Vercel Cron + route handler** (every 30s, simple, fits Fluid Compute, no external infra).
- Long-poll script in a side container (Railway/Fly) — only if Vercel Cron cadence becomes a bottleneck.

v1 default: Vercel Cron route handler at `/api/cron/embed-jobs`.

### 4.5 Retrieval pipeline

```
query(q, userId):
  qvec  = embedder.embed(q)                            // bge-m3
  cands = rpc.match_knowledge_hybrid(userId, q, qvec, limit=150)
                                                       // RRF over FTS + HNSW
  top   = reranker.rank(q, cands, k=20)                // bge-reranker-v2-m3
  ctx   = grader.filter(top, threshold=0.5)            // bounded CRAG
  if ctx.length == 0:
    qRewrite = llm.rewrite(q)                          // ONE retry only
    cands    = rpc.match_knowledge_hybrid(userId, qRewrite, ...)
    top      = reranker.rank(qRewrite, cands, 20)
    ctx      = grader.filter(top, 0.5)
  return llm.stream(promptBuilder(ctx, q))             // Llama-3.3-70B via Groq
```

Top-20 (not top-5) per Anthropic's eval finding.

## 5. Schema

### 5.1 New tables

```sql
-- Per-chunk vector store
create table public.knowledge_chunks (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.knowledge_documents(id) on delete cascade,
  user_id       uuid not null,                          -- denormalized for RLS perf
  chunk_index   integer not null,
  content       text   not null,                        -- text actually embedded (with heading prefix)
  heading_path  text,                                   -- "Refund policy > Eligibility"
  source_offset int4range,                              -- char range in source markdown, for citations later
  token_count   integer not null,
  content_hash  text   not null,                        -- sha256 of normalized content
  is_atomic     boolean not null default false,
  embedding     vector(1024) not null,
  created_at    timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index knowledge_chunks_doc_idx
  on public.knowledge_chunks (document_id, chunk_index);

create index knowledge_chunks_embedding_hnsw
  on public.knowledge_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index knowledge_chunks_fts
  on public.knowledge_chunks
  using gin (to_tsvector('simple', content));

create index knowledge_chunks_user_idx
  on public.knowledge_chunks (user_id);

-- Embed/re-embed work queue
create table public.knowledge_embedding_jobs (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.knowledge_documents(id) on delete cascade,
  user_id       uuid not null,
  status        text not null default 'queued'
                check (status in ('queued','running','done','failed')),
  attempts      integer not null default 0,
  last_error    text,
  scheduled_at  timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index knowledge_embedding_jobs_status_idx
  on public.knowledge_embedding_jobs (status, scheduled_at)
  where status in ('queued','running');
```

### 5.2 RLS

```sql
alter table public.knowledge_chunks enable row level security;
alter table public.knowledge_embedding_jobs enable row level security;

create policy knowledge_chunks_owner_all on public.knowledge_chunks
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy knowledge_embedding_jobs_owner_all on public.knowledge_embedding_jobs
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

The retrieval RPC is `security invoker` so `knowledge_chunks` RLS still applies. It also requires `p_user_id = auth.uid()` and filters unpublished FAQ chunks.

### 5.3 Hybrid search RPC

```sql
create or replace function public.match_knowledge_hybrid(
  p_user_id      uuid,
  p_query_text   text,
  p_query_embed  vector(1024),
  p_match_limit  int default 150,
  p_full_text_w  float default 1.0,
  p_semantic_w   float default 1.0,
  p_rrf_k        int default 60
) returns table (
  id            uuid,
  document_id   uuid,
  faq_id        uuid,
  content       text,
  heading_path  text,
  rrf_score     float
)
language sql
security invoker
set search_path = public
as $$
  with fts as (
    select id, row_number() over (order by ts_rank_cd(to_tsvector('simple', content), websearch_to_tsquery('simple', p_query_text)) desc) as rank
    from knowledge_chunks
    where user_id = p_user_id
      and to_tsvector('simple', content) @@ websearch_to_tsquery('simple', p_query_text)
    limit p_match_limit
  ),
  sem as (
    select id, row_number() over (order by embedding <=> p_query_embed) as rank
    from knowledge_chunks
    where user_id = p_user_id
    order by embedding <=> p_query_embed
    limit p_match_limit
  )
  select
    kc.id,
    kc.document_id,
    kc.content,
    kc.heading_path,
    coalesce(p_full_text_w / (p_rrf_k + fts.rank), 0)
      + coalesce(p_semantic_w / (p_rrf_k + sem.rank), 0) as rrf_score
  from knowledge_chunks kc
  left join fts on fts.id = kc.id
  left join sem on sem.id = kc.id
  where kc.user_id = p_user_id
    and (fts.id is not null or sem.id is not null)
  order by rrf_score desc
  limit p_match_limit;
$$;
```

Session GUC for filtered HNSW correctness (set per request before calling):
```sql
set local hnsw.iterative_scan = 'relaxed_order';
set local hnsw.max_scan_tuples = 20000;
```

### 5.4 Migration files (ordered)

1. `20260430000000_knowledge_chunks.sql` — pgvector extension check, `knowledge_chunks` table, indexes.
2. `20260430000100_knowledge_embedding_jobs.sql` — queue table.
3. `20260430000200_match_knowledge_hybrid.sql` — RPC.

## 6. Module layout

```
src/lib/rag/
  parsers/
    tiptap.ts           # TipTap JSON → markdown
    faq.ts              # FAQ row → atomic markdown
    index.ts            # parse(source, kind) dispatcher
  chunker.ts            # recursive header-aware splitter
  content-hash.ts       # normalize + sha256
  chunk-diff.ts         # old chunks + new chunks → {insert, update, delete, skip}
  hf-client.ts          # embed(text|text[]), rerank(q, docs) with batching + retry
  retriever.ts          # query → RPC → rerank → CRAG → context
  grader.ts             # CRAG threshold filter
  prompt-builder.ts     # system + persona + KB context + user query
  llm.ts                # HF router OpenAI client, streaming
  worker/
    embed-job.ts        # claim → ingest → mark done/failed
    schedule.ts         # called by Vercel Cron route handler
  index.ts              # public API: ingestDocument, query
```

Each file has a sibling `*.test.ts`. Pure modules use Vitest. Integration tests use a local Supabase branch + recorded HF responses (`msw`).

## 7. Build order — vertical slices

| Slice | Files                                           | Tests                                                   | Network? |
| ----- | ----------------------------------------------- | ------------------------------------------------------- | -------- |
| 1     | 3 migrations + RPC                              | pgTAP: schema + RLS + RPC ranking                       | —        |
| 2     | `parsers/tiptap.ts`, `parsers/faq.ts`, `parsers/index.ts` | snapshot tests on fixture documents                     | —        |
| 3     | `chunker.ts`                                    | snapshots: short doc, long doc, all-headings, no-headings, code blocks, atomic FAQ | — |
| 4     | `content-hash.ts`, `chunk-diff.ts`              | exhaustive table-driven tests: insert / update / delete / skip / reorder | — |
| 5     | `hf-client.ts`                                  | `msw`-mocked embed + rerank, batching, retry, error mapping | mocked |
| 6     | `worker/embed-job.ts`, `worker/schedule.ts`, server action wiring on Save | integration: insert job → run → assert chunks + status | mocked HF |
| 7     | `retriever.ts`, `grader.ts`                     | integration: seeded chunks → query → assert order      | mocked HF |
| 8     | `prompt-builder.ts`, `llm.ts`, chat route       | e2e gated on `HF_TOKEN` env var                        | real     |

Slices 1–4 are the first PR — foundation, fully tested, no network.

## 8. Configuration

Env vars (add to `.env.example`):

```
HF_TOKEN=hf_...
RAG_EMBED_MODEL=BAAI/bge-m3
RAG_RERANK_MODEL=BAAI/bge-reranker-v2-m3
RAG_LLM_MODEL=meta-llama/Llama-3.3-70B-Instruct:groq
RAG_CHUNK_TARGET_TOKENS=800
RAG_CHUNK_MAX_TOKENS=1024
RAG_CHUNK_OVERLAP_TOKENS=100
RAG_RETRIEVAL_LIMIT=150
RAG_RERANK_TOP_K=20
RAG_CRAG_THRESHOLD=0.5
```

All knobs read once at module load, not per request.

## 9. Testing strategy

- **Pure functions**: parsers, chunker, content-hash, chunk-diff, grader, prompt-builder. Unit tests only. No mocks, no fixtures beyond input/expected output snapshots.
- **HF clients**: behind interfaces (`Embedder`, `Reranker`, `LLM`). Real implementations call HF; tests inject mocks.
- **SQL**: pgTAP migrations validate schema, RLS isolation (user A cannot read user B), and RPC ordering on a seeded fixture.
- **Worker**: integration test against a local Supabase branch, HF mocked.
- **e2e**: a single happy-path test gated behind `HF_TOKEN` and `SUPABASE_TEST_BRANCH` env vars. Skipped by default in CI; runnable locally with `pnpm test:e2e`.
- **Red-team (later)**: AgentDojo-style prompt-injection tests once the chat surface exists.

## 10. Observability

Per-request structured logs:
- Request id, user id, document id (ingest) / query hash (retrieval).
- Chunker: input tokens, output chunk count, atomic count, oversize warnings.
- Diff: `{insert, update, delete, skip}` counts.
- Embedder: batch size, latency p50/p95, retries.
- Reranker: input count, latency.
- Retriever: candidate count, post-rerank count, CRAG threshold hits, rewrite triggered y/n.
- LLM: TTFT, total tokens, finish reason.

No PII in logs. Document IDs only.

## 11. Open decisions deferred to v2

1. **Anthropic Contextual Retrieval** as a feature flag. Adds 35–49% lift; doubles ingest cost; reintroduces a paid dependency. Revisit when answer quality plateaus.
2. **SEA-LION 70B** as the "quality mode" LLM via a paid HF Inference Endpoint (not router). Worth it once a tenant complains Llama-3.3 misses Tagalog idiom.
3. **Sparse vectors** from bge-m3. Postgres FTS already covers the lexical leg; revisit only if recall on non-Latin scripts becomes a problem.
4. **Late chunking** (Jina) for very long policy docs. Worth it only after we see real long-doc tenants.
5. **Vision RAG (ColPali)** when an upload tenant ships brochures or slide decks where text extraction loses too much.

## 12. Risks and mitigations

| Risk                                                | Mitigation                                                  |
| --------------------------------------------------- | ----------------------------------------------------------- |
| `hf-inference` CPU latency makes embed slow (~200ms/chunk) | Batch 16–32 per call, parallelism cap 5, queue worker not in request path. |
| `hf-inference` rate limits (free tier)              | Exponential backoff in `hf-client.ts`; surface "indexing in progress" UI on docs with queued jobs. |
| Large documents blow out the queue                  | Cap chunks-per-doc at 500; oversize doc gets `failed` with explicit error. |
| Filtered HNSW under-recall                          | `set local hnsw.iterative_scan = 'relaxed_order'` and `max_scan_tuples = 20000` per request. |
| LLM hallucinates outside KB                         | CRAG grader returns empty context → prompt forces "I don't know"; never silently answer from parametric memory. |
| User edits doc while embed job is running           | `version` column on `knowledge_documents`; worker checks version before commit, requeues if stale. |
| Re-ranker false negatives drop the right chunk      | Keep top-20 (not 5); only filter via CRAG threshold, not rerank rank alone. |

## 13. Success criteria for v1

- Save → `indexed` status within 10s for docs ≤ 5K tokens, ≤ 60s for docs ≤ 50K tokens.
- Edit a single paragraph → ≥ 80% of chunks have `skip` status (verified in worker logs).
- Retrieval RPC p95 < 250ms over 10K chunks per user.
- End-to-end query → first token: p95 < 2s on Llama-3.3-70B via Groq.
- pgTAP, unit, and integration test suites all green in CI.
- Zero cross-tenant data leaks (verified by RLS pgTAP).

## 14. Sources

- [HF Inference Providers — OpenAI compatibility](https://huggingface.co/changelog/inference-providers-openai-compatible)
- [HF Inference (serverless) provider docs](https://huggingface.co/docs/inference-providers/en/providers/hf-inference)
- [BAAI/bge-m3 model card](https://huggingface.co/BAAI/bge-m3)
- [BAAI/bge-reranker-v2-m3 model card](https://huggingface.co/BAAI/bge-reranker-v2-m3)
- [FilBench — Filipino LLM benchmark](https://huggingface.co/blog/filbench) · [paper](https://arxiv.org/abs/2508.03523)
- [SEA-LION paper](https://arxiv.org/html/2504.05747v4)
- [Benchmarking OSS LLMs on Code-Switched Tagalog-English (JAIT 2025)](https://www.jait.us/articles/2025/JAIT-V16N2-233.pdf)
- [Anthropic Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)
- [pgvector 0.8.0 iterative scans](https://docs.pgedge.com/pgvector/v0-8-0/iterative-index-scans/)
- [Supabase Hybrid Search guide](https://supabase.com/docs/guides/ai/hybrid-search)
- [Agentic RAG survey arXiv:2501.09136](https://arxiv.org/abs/2501.09136)
