import OpenAI from 'openai';
import { ragConfig } from './config';
import { EmbedCache } from './embed-cache';
import type { Embedder, RerankItem, RerankResult, Reranker } from './hf-client';
import { pMapLimit, withRetry } from './retry';

function buildHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (ragConfig.openrouterReferer) h['HTTP-Referer'] = ragConfig.openrouterReferer;
  if (ragConfig.openrouterTitle) h['X-OpenRouter-Title'] = ragConfig.openrouterTitle;
  return h;
}

export class OpenRouterEmbedder implements Embedder {
  private client: OpenAI;
  private model: string;
  // Instance-local LRU. The factory singleton (see factory.ts) keeps one
  // embedder per process, so this cache persists across retrieve() calls and
  // returns byte-identical vectors on a repeated query.
  private cache = new EmbedCache(500);

  constructor(opts?: { apiKey?: string; baseUrl?: string; model?: string }) {
    const apiKey = opts?.apiKey ?? ragConfig.openrouterApiKey;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
    this.model = opts?.model ?? ragConfig.openrouterEmbedModel;
    this.client = new OpenAI({
      apiKey,
      baseURL: opts?.baseUrl ?? ragConfig.openrouterBaseUrl,
      defaultHeaders: buildHeaders(),
    });
  }

  async embed(text: string): Promise<number[]> {
    const key = EmbedCache.keyFor(this.model, text);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const vec = await withRetry(async () => {
      const res = await this.client.embeddings.create({
        model: this.model,
        input: text,
        encoding_format: 'float',
      });
      return res.data[0].embedding as number[];
    });
    this.cache.set(key, vec);
    return vec;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Resolve cache hits up front; only the misses are sent to the API. We
    // record each miss's original position so the merged result preserves
    // input order exactly.
    const out: number[][] = new Array(texts.length);
    const missTexts: string[] = [];
    const missPositions: number[] = [];
    const missKeys: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      const key = EmbedCache.keyFor(this.model, texts[i]);
      const hit = this.cache.get(key);
      if (hit !== undefined) {
        out[i] = hit;
      } else {
        missTexts.push(texts[i]);
        missPositions.push(i);
        missKeys.push(key);
      }
    }
    if (missTexts.length === 0) return out;

    const batchSize = ragConfig.embedBatchSize;
    const batches: string[][] = [];
    for (let i = 0; i < missTexts.length; i += batchSize) {
      batches.push(missTexts.slice(i, i + batchSize));
    }
    const fetched = await pMapLimit(batches, ragConfig.embedConcurrency, async (batch) =>
      withRetry(async () => {
        const res = await this.client.embeddings.create({
          model: this.model,
          input: batch,
          encoding_format: 'float',
        });
        if (res.data.length !== batch.length) {
          throw new Error(`Expected ${batch.length} embeddings, got ${res.data.length}`);
        }
        return res.data
          .slice()
          .sort((a, b) => a.index - b.index)
          .map((d) => d.embedding as number[]);
      }),
    );

    // Scatter the fetched vectors back into their original positions and cache
    // each one keyed by its text.
    const fetchedFlat = fetched.flat();
    for (let m = 0; m < fetchedFlat.length; m++) {
      const pos = missPositions[m];
      out[pos] = fetchedFlat[m];
      this.cache.set(missKeys[m], fetchedFlat[m]);
    }
    return out;
  }
}

interface OpenRouterRerankResponse {
  results: Array<{
    index: number;
    relevance_score: number;
  }>;
}

export class OpenRouterReranker implements Reranker {
  private apiKey: string;
  private model: string;
  private url: string;

  constructor(opts?: { apiKey?: string; baseUrl?: string; model?: string }) {
    this.apiKey = opts?.apiKey ?? ragConfig.openrouterApiKey;
    if (!this.apiKey) throw new Error('OPENROUTER_API_KEY is not set');
    this.model = opts?.model ?? ragConfig.openrouterRerankModel;
    const base = opts?.baseUrl ?? ragConfig.openrouterBaseUrl;
    this.url = `${base.replace(/\/$/, '')}/rerank`;
  }

  async rank(query: string, items: RerankItem[]): Promise<RerankResult[]> {
    if (items.length === 0) return [];

    const batchSize = ragConfig.rerankBatchSize;
    const batches: RerankItem[][] = [];
    for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize));

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      ...buildHeaders(),
    };

    const results = await pMapLimit(batches, ragConfig.rerankConcurrency, async (batch) =>
      withRetry(async () => {
        const body = JSON.stringify({
          model: this.model,
          query,
          documents: batch.map((it) => it.text),
          top_n: batch.length,
        });
        const res = await fetch(this.url, { method: 'POST', headers, body });
        if (!res.ok) {
          const err = await res.text().catch(() => '');
          throw new Error(`openrouter rerank HTTP ${res.status}: ${err.slice(0, 200)}`);
        }
        const json = (await res.json()) as OpenRouterRerankResponse;
        if (!json?.results || !Array.isArray(json.results)) {
          throw new Error('openrouter rerank: missing results array');
        }
        return json.results.map((r) => ({
          id: batch[r.index].id,
          score: Number(r.relevance_score ?? 0),
        }));
      }),
    );

    const scored = results.flat();
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }
}
