// Centralized config. Read once at module load, never per request.

const num = (v: string | undefined, fallback: number): number => {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

export const ragConfig = {
  hfToken: process.env.HF_TOKEN ?? '',
  // With `embedProvider: 'auto'` the HF router picks the best-latency connected
  // provider for this model. Free `hf-inference` (CPU) is ~200ms/chunk; auto
  // typically lands on a GPU provider when one is connected to your HF account.
  embedModel: process.env.RAG_EMBED_MODEL ?? 'BAAI/bge-m3',
  rerankModel: process.env.RAG_RERANK_MODEL ?? 'BAAI/bge-reranker-v2-m3',
  llmModel: process.env.RAG_LLM_MODEL ?? 'meta-llama/Llama-3.3-70B-Instruct:groq',
  classifierModel:
    process.env.RAG_CLASSIFIER_MODEL ?? 'meta-llama/Llama-3.1-8B-Instruct:groq',
  hfRouterBaseUrl: process.env.RAG_HF_ROUTER_URL ?? 'https://router.huggingface.co/v1',
  // LLM client (chat + classifier) is OpenAI-compatible. Defaults to the HF
  // router for backward compatibility; override to point at OpenRouter etc.
  llmBaseUrl:
    process.env.RAG_LLM_BASE_URL ??
    process.env.RAG_HF_ROUTER_URL ??
    'https://router.huggingface.co/v1',
  llmApiKey: process.env.RAG_LLM_API_KEY ?? process.env.HF_TOKEN ?? '',
  embedProvider: process.env.RAG_EMBED_PROVIDER ?? 'auto',
  rerankProvider: process.env.RAG_RERANK_PROVIDER ?? 'hf-inference',

  // Backend selection: 'hf' (HuggingFace inference router) or 'openrouter'.
  // OpenRouter exposes baai/bge-m3 (same 1024-dim embeddings; no DB change)
  // and cohere/rerank-4-pro via OpenAI-compatible / native rerank endpoints.
  embedBackend: (process.env.RAG_EMBED_BACKEND ?? 'hf') as 'hf' | 'openrouter',
  rerankBackend: (process.env.RAG_RERANK_BACKEND ?? 'hf') as 'hf' | 'openrouter',
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
  openrouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
  openrouterEmbedModel: process.env.OPENROUTER_EMBED_MODEL ?? 'baai/bge-m3',
  openrouterRerankModel: process.env.OPENROUTER_RERANK_MODEL ?? 'cohere/rerank-4-pro',
  openrouterReferer: process.env.OPENROUTER_REFERER ?? '',
  openrouterTitle: process.env.OPENROUTER_TITLE ?? '',

  chunkTargetTokens: num(process.env.RAG_CHUNK_TARGET_TOKENS, 800),
  chunkMaxTokens: num(process.env.RAG_CHUNK_MAX_TOKENS, 1024),
  chunkOverlapTokens: num(process.env.RAG_CHUNK_OVERLAP_TOKENS, 100),

  retrievalLimit: num(process.env.RAG_RETRIEVAL_LIMIT, 20),
  rerankTopK: num(process.env.RAG_RERANK_TOP_K, 8),
  rewriteTimeoutMs: num(process.env.RAG_REWRITE_TIMEOUT_MS, 1500),
  // bge-reranker-v2-m3 produces a bimodal sigmoid: ~0.95+ for relevant pairs
  // and ~0.0 for irrelevant. 0.3 keeps clearly-relevant FAQs (which often score
  // 0.6–0.99) without admitting noise.
  cragThreshold: num(process.env.RAG_CRAG_THRESHOLD, 0.3),

  embedBatchSize: num(process.env.RAG_EMBED_BATCH_SIZE, 16),
  embedConcurrency: num(process.env.RAG_EMBED_CONCURRENCY, 3),
  // Bumped from (4 attempts, 8s cap) → (6 attempts, 30s cap) so transient
  // HF ProviderApiError 503s clear within a single job run instead of bouncing
  // to the worker-level requeue (which has 60s+ minimum backoff).
  embedRetryMax: num(process.env.RAG_EMBED_RETRY_MAX, 6),
  embedRetryMaxWaitMs: num(process.env.RAG_EMBED_RETRY_MAX_WAIT_MS, 30_000),

  // Reranker: batch many text-pairs into a single HTTP call. The HF
  // free-tier rate limit makes one-call-per-candidate (the previous
  // behavior) unusable above ~5 candidates.
  rerankBatchSize: num(process.env.RAG_RERANK_BATCH_SIZE, 32),
  rerankConcurrency: num(process.env.RAG_RERANK_CONCURRENCY, 2),
  // When all reranked candidates fall below the CRAG threshold (common with
  // Taglish/Tagalog interrogatives the reranker scores near 0), promote this
  // many top-ranked candidates to the ambiguous bucket so the LLM sees them.
  rerankFloorK: num(process.env.RAG_RERANK_FLOOR_K, 3),

  // Prompt layout. `cache_friendly` puts the stable persona / rules /
  // grounding / fallback block FIRST and the volatile per-turn pieces
  // (funnel goal, instructions, summary, KB context) LAST, so providers
  // that cache long stable prefixes (Anthropic, vLLM) can hit the cache
  // on the bulk of the system prompt. `legacy` preserves the previous
  // order (volatile sections first) — kept as a one-release safety toggle.
  promptLayout:
    (process.env.RAG_PROMPT_LAYOUT ?? 'cache_friendly') as 'cache_friendly' | 'legacy',
};

export type RagConfig = typeof ragConfig;
