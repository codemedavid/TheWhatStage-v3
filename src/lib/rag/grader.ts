import type { RerankResult } from './hf-client';

export interface GradedCandidate {
  id: string;
  score: number;
  payload: unknown;
}

/**
 * Bounded CRAG grader. Filters reranked candidates to those above the
 * threshold. Returns three buckets:
 *   - useful: above the high threshold, send straight to the LLM
 *   - ambiguous: between low and high — keep but flag for the LLM
 *   - reject: below low, drop entirely
 *
 * The retriever uses (useful + ambiguous) as context. If both are empty,
 * the retriever will trigger a one-shot query rewrite.
 */
export interface GradedBuckets<T> {
  useful: Array<T & { score: number }>;
  ambiguous: Array<T & { score: number }>;
  reject: Array<T & { score: number }>;
}

export function gradeCandidates<T extends { id: string }>(
  ranked: RerankResult[],
  payloadById: Map<string, T>,
  thresholds: { high: number; low: number },
): GradedBuckets<T> {
  const useful: Array<T & { score: number }> = [];
  const ambiguous: Array<T & { score: number }> = [];
  const reject: Array<T & { score: number }> = [];
  for (const r of ranked) {
    const item = payloadById.get(r.id);
    if (!item) continue;
    const enriched = { ...item, score: r.score };
    if (r.score >= thresholds.high) useful.push(enriched);
    else if (r.score >= thresholds.low) ambiguous.push(enriched);
    else reject.push(enriched);
  }
  return { useful, ambiguous, reject };
}
