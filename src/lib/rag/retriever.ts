import type { Embedder, Reranker } from './hf-client';
import { gradeCandidates, type GradedBuckets } from './grader';
import { ragConfig } from './config';
import type { SupabaseLike } from './ingest';

export interface RetrievedChunk {
  id: string;
  document_id: string | null;
  faq_id: string | null;
  business_item_id?: string | null;
  content: string;
  heading_path: string | null;
}

type RawRetrievedChunk = Omit<RetrievedChunk, 'id'> & {
  id?: string;
  chunk_id?: string;
};

export interface RetrievalContext {
  query: string;
  effectiveQuery: string;
  rewrote: boolean;
  buckets: GradedBuckets<RetrievedChunk>;
}

export interface RetrieverDeps {
  client: SupabaseLike;
  embedder: Embedder;
  /** Optional cross-encoder reranker. When omitted, hybrid-search order is
   *  used directly (synthetic descending scores). */
  reranker?: Reranker;
  /** Optional one-shot rewriter. If omitted, no rewrite step runs. */
  rewriteQuery?: (q: string) => Promise<string>;
  /**
   * Override for the hybrid-search RPC. Defaults to `match_knowledge_hybrid`
   * (security-invoker, requires `auth.uid()`). Pass
   * `match_knowledge_hybrid_service` from server-side workers that run with
   * the service-role key and have no auth context.
   */
  rpcName?: string;
}

async function searchOnce(
  deps: RetrieverDeps,
  userId: string,
  query: string,
): Promise<RetrievedChunk[]> {
  const tEmbed = Date.now();
  const qvec = await deps.embedder.embed(query);
  console.log('[rag.timing] embed', { ms: Date.now() - tEmbed });

  if (!deps.client.rpc) throw new Error('Supabase client missing rpc()');
  const tRpc = Date.now();
  const rpcName = deps.rpcName ?? 'match_knowledge_hybrid';
  const { data, error } = await deps.client.rpc(rpcName, {
    p_user_id: userId,
    p_query_text: query,
    p_query_embed: qvec,
    p_match_limit: ragConfig.retrievalLimit,
  });
  console.log('[rag.timing] rpc', { ms: Date.now() - tRpc });
  if (error) throw new Error(`hybrid_search failed: ${error.message ?? error}`);
  return ((data ?? []) as RawRetrievedChunk[])
    .map((row) => ({
      id: row.id ?? row.chunk_id ?? '',
      document_id: row.document_id,
      faq_id: row.faq_id,
      business_item_id: row.business_item_id,
      content: row.content,
      heading_path: row.heading_path,
    }))
    .filter((row) => row.id);
}

interface GradedPass {
  buckets: GradedBuckets<RetrievedChunk>;
  ranked: { id: string; score: number }[];
  byId: Map<string, RetrievedChunk>;
}

async function rankAndGrade(
  deps: RetrieverDeps,
  query: string,
  candidates: RetrievedChunk[],
  thresholds: { high: number; low: number },
): Promise<GradedPass> {
  // No reranker, or pool ≤ floor: use hybrid-search order with synthetic
  // descending scores. The previous cross-encoder rerank added 500ms–4s of
  // latency for marginal gain over the hybrid (BM25 + vector) ordering.
  if (!deps.reranker || candidates.length <= ragConfig.rerankFloorK) {
    const ranked = candidates.map((c, i) => ({ id: c.id, score: 1 - i * 0.01 }));
    const byId = new Map(candidates.map((c) => [c.id, c]));
    return { buckets: gradeCandidates(ranked, byId, thresholds), ranked, byId };
  }
  const tRerank = Date.now();
  const ranked = await deps.reranker.rank(
    query,
    candidates.map((c) => ({ id: c.id, text: c.content })),
  );
  console.log('[rag.timing] rerank', { ms: Date.now() - tRerank, n: candidates.length });
  const top = ranked.slice(0, ragConfig.rerankTopK);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return { buckets: gradeCandidates(top, byId, thresholds), ranked: top, byId };
}

function applyFloor(pass: GradedPass): GradedBuckets<RetrievedChunk> {
  const buckets = pass.buckets;
  if (buckets.useful.length > 0 || buckets.ambiguous.length > 0) return buckets;
  const floorN = Math.min(ragConfig.rerankFloorK, pass.ranked.length);
  // bge-reranker-v2-m3 scores near zero for Taglish/Tagalog interrogatives even
  // when chunks are clearly relevant. When both the original and rewritten
  // queries leave the buckets empty, promote the top few hybrid-ranked chunks
  // to `ambiguous` so the LLM at least sees them. The system prompt still
  // instructs it to fall back if the context doesn't answer the question.
  for (const r of pass.ranked.slice(0, floorN)) {
    const item = pass.byId.get(r.id);
    if (item) buckets.ambiguous.push({ ...item, score: r.score });
  }
  return buckets;
}

const emptyPass = (): GradedPass => ({
  buckets: { useful: [], ambiguous: [], reject: [] },
  ranked: [],
  byId: new Map(),
});

export async function retrieve(
  deps: RetrieverDeps,
  args: { userId: string; query: string },
): Promise<RetrievalContext> {
  const high = ragConfig.cragThreshold;
  const low = Math.max(0, high - 0.2);

  const candidates = await searchOnce(deps, args.userId, args.query);
  const firstPass: GradedPass =
    candidates.length === 0
      ? emptyPass()
      : await rankAndGrade(deps, args.query, candidates, { high, low });

  console.log('[rag.retrieve] first pass', {
    query: args.query,
    candidates: candidates.length,
    useful: firstPass.buckets.useful.length,
    ambiguous: firstPass.buckets.ambiguous.length,
    reject: firstPass.buckets.reject.length,
  });

  // CRAG fallback: only when the first hybrid search returned ZERO candidates.
  // (Previously also fired on zero useful/ambiguous, which made the rewrite +
  // re-embed + re-search + re-rerank loop the common case — too slow for chat.)
  // The rewrite LLM call itself is bounded by a short timeout.
  if (candidates.length === 0 && deps.rewriteQuery) {
    const tRewrite = Date.now();
    const rewritePromise = deps.rewriteQuery(args.query).then((s) => s.trim());
    const timeoutPromise = new Promise<string>((resolve) =>
      setTimeout(() => resolve(''), ragConfig.rewriteTimeoutMs),
    );
    const rewritten = await Promise.race([rewritePromise, timeoutPromise]);
    console.log('[rag.timing] rewrite', { ms: Date.now() - tRewrite, gotRewrite: !!rewritten });
    if (rewritten && rewritten !== args.query.trim()) {
      const second = await searchOnce(deps, args.userId, rewritten);
      const secondPass: GradedPass =
        second.length === 0
          ? emptyPass()
          : await rankAndGrade(deps, rewritten, second, { high, low });
      console.log('[rag.retrieve] rewrite pass', {
        rewritten,
        candidates: second.length,
        useful: secondPass.buckets.useful.length,
        ambiguous: secondPass.buckets.ambiguous.length,
      });
      const stillEmpty =
        secondPass.buckets.useful.length === 0 && secondPass.buckets.ambiguous.length === 0;
      // Floor: prefer the rewrite pass's candidates; if it found none, fall
      // back to the first pass before giving up entirely.
      const flooredPass = stillEmpty && firstPass.ranked.length > 0 ? firstPass : secondPass;
      return {
        query: args.query,
        effectiveQuery: rewritten,
        rewrote: true,
        buckets: applyFloor(flooredPass),
      };
    }
  }

  return {
    query: args.query,
    effectiveQuery: args.query,
    rewrote: false,
    buckets: applyFloor(firstPass),
  };
}
