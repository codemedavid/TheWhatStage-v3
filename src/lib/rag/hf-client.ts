import { InferenceClient } from '@huggingface/inference';
import { ragConfig } from './config';
import { pMapLimit, withRetry } from './retry';

export interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface RerankItem {
  id: string;
  text: string;
}

export interface RerankResult {
  id: string;
  score: number;
}

export interface Reranker {
  rank(query: string, items: RerankItem[]): Promise<RerankResult[]>;
}

function assertProviderSegment(provider: string): void {
  if (provider.includes('/')) {
    throw new Error(
      `Invalid Hugging Face provider "${provider}": provider must be a provider id like "hf-inference" or "auto", not a model id. Use RAG_EMBED_MODEL or RAG_RERANK_MODEL for model ids.`,
    );
  }
}

type HfProvider = Parameters<InferenceClient['featureExtraction']>[0]['provider'];

export class HfEmbedder implements Embedder {
  private client: InferenceClient;
  private model: string;
  private provider: HfProvider;

  constructor(opts?: { token?: string; model?: string; provider?: string }) {
    const token = opts?.token ?? ragConfig.hfToken;
    this.model = opts?.model ?? ragConfig.embedModel;
    const provider = opts?.provider ?? ragConfig.embedProvider;
    assertProviderSegment(provider);
    this.provider = provider as HfProvider;
    this.client = new InferenceClient(token);
  }

  async embed(text: string): Promise<number[]> {
    return withRetry(async () => {
      const out = await this.client.featureExtraction({
        model: this.model,
        inputs: text,
        provider: this.provider,
      });
      return toVector(out);
    });
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const batchSize = ragConfig.embedBatchSize;
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      batches.push(texts.slice(i, i + batchSize));
    }
    const out = await pMapLimit(batches, ragConfig.embedConcurrency, async (batch) =>
      withRetry(async () => {
        const r = await this.client.featureExtraction({
          model: this.model,
          inputs: batch,
          provider: this.provider,
        });
        return toMatrix(r, batch.length);
      }),
    );
    return out.flat();
  }
}

export class HfReranker implements Reranker {
  private token: string;
  private model: string;
  private url: string;

  constructor(opts?: { token?: string; model?: string; baseUrl?: string; provider?: string }) {
    this.token = opts?.token ?? ragConfig.hfToken;
    this.model = opts?.model ?? ragConfig.rerankModel;
    const provider = opts?.provider ?? ragConfig.rerankProvider;
    assertProviderSegment(provider);
    const base = opts?.baseUrl ?? `https://router.huggingface.co/${provider}/models`;
    this.url = `${base}/${this.model}/pipeline/text-classification`;
  }

  async rank(query: string, items: RerankItem[]): Promise<RerankResult[]> {
    if (items.length === 0) return [];

    // bge-reranker-v2-m3 is a single-logit cross-encoder. The HF inference API
    // accepts batched text-pair inputs in one call; the previous implementation
    // fanned out one HTTP request per candidate which trips the free-tier rate
    // limit at >5 chunks.
    const batchSize = ragConfig.rerankBatchSize;
    const batches: RerankItem[][] = [];
    for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize));

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };

    const results = await pMapLimit(batches, ragConfig.rerankConcurrency, async (batch) =>
      withRetry(async () => {
        const body = JSON.stringify({
          inputs: batch.map((it) => ({ text: query, text_pair: it.text })),
        });
        const res = await fetch(this.url, { method: 'POST', headers, body });
        if (!res.ok) {
          const err = await res.text().catch(() => '');
          throw new Error(`reranker HTTP ${res.status}: ${err.slice(0, 200)}`);
        }
        const json = (await res.json()) as unknown;
        return mapRerankBatchResponse(json, batch);
      }),
    );

    const scored = results.flat();
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }
}

function toVector(out: unknown): number[] {
  if (Array.isArray(out) && out.length > 0 && typeof out[0] === 'number') return out as number[];
  // bge-m3 sometimes returns [[...]] for a single input.
  if (Array.isArray(out) && Array.isArray(out[0])) return (out[0] as number[]);
  throw new Error('Unexpected embedding shape');
}

function toMatrix(out: unknown, expected: number): number[][] {
  if (!Array.isArray(out)) throw new Error('Unexpected embedding shape');
  if (Array.isArray(out[0])) {
    const m = out as number[][];
    if (m.length !== expected) {
      throw new Error(`Expected ${expected} embeddings, got ${m.length}`);
    }
    return m;
  }
  // Single vector returned for batch of 1
  if (typeof out[0] === 'number' && expected === 1) return [out as number[]];
  throw new Error('Unexpected embedding shape');
}

function extractRerankerScore(out: unknown): number {
  // bge-reranker-v2-m3 is single-logit (num_labels=1) → exposed as
  // [{label:"LABEL_0", score: <relevance>}]. Other rerankers return the
  // explicit positive label; handle both.
  if (Array.isArray(out)) {
    if (out.length === 1) return Number((out[0] as { score?: number })?.score ?? 0);
    const positive = out.find((o) =>
      /^(LABEL_1|positive|yes|relevant|1)$/i.test(String((o as { label?: unknown }).label ?? '')),
    );
    if (positive) return Number((positive as { score: number }).score);
    const top = [...out].sort(
      (a, b) => Number((b as { score?: number })?.score ?? 0) - Number((a as { score?: number })?.score ?? 0),
    )[0];
    return Number((top as { score?: number })?.score ?? 0);
  }
  if (out && typeof out === 'object' && 'score' in out) return Number((out as { score: number }).score);
  return 0;
}

/**
 * Map a batched text-classification response back to per-item RerankResults.
 *
 * The HF inference router wraps batched results in an extra outer array.
 * Concrete shapes observed against bge-reranker-v2-m3 (single-logit cross-encoder):
 *   1 pair  -> [[{label,score}]]                        // outer[0] has 1 entry
 *   N pairs -> [[{label,score}, {label,score}, ...]]    // outer[0] has N entries
 * Other rerankers may return per-pair arrays (one entry per logit class):
 *   N pairs -> [[{l,s},{l,s}], [{l,s},{l,s}], ...]
 * We handle both.
 */
function mapRerankBatchResponse(json: unknown, batch: RerankItem[]): RerankResult[] {
  if (!Array.isArray(json)) {
    throw new Error('reranker: expected array response');
  }

  let perPair: unknown[];
  if (
    json.length === 1 &&
    Array.isArray(json[0]) &&
    (json[0] as unknown[]).length === batch.length
  ) {
    // Wrapped shape: [[per_pair, per_pair, ...]]
    perPair = json[0] as unknown[];
  } else if (json.length === batch.length) {
    // Flat shape: [per_pair, per_pair, ...]
    perPair = json as unknown[];
  } else {
    throw new Error(
      `reranker: expected ${batch.length} results, got ${json.length} (shape=${describeShape(json)})`,
    );
  }

  return perPair.map((row, i) => ({
    id: batch[i].id,
    score: extractRerankerScore(row),
  }));
}

function describeShape(v: unknown): string {
  if (!Array.isArray(v)) return typeof v;
  if (v.length === 0) return '[]';
  return `[${v.length}×${describeShape(v[0])}]`;
}
