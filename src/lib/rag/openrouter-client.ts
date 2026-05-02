import OpenAI from 'openai';
import { ragConfig } from './config';
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
    return withRetry(async () => {
      const res = await this.client.embeddings.create({
        model: this.model,
        input: text,
        encoding_format: 'float',
      });
      return res.data[0].embedding as number[];
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
    return out.flat();
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
