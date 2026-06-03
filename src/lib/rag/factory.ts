import { ragConfig } from './config';
import { HfEmbedder, HfReranker, type Embedder, type Reranker } from './hf-client';
import { OpenRouterEmbedder, OpenRouterReranker } from './openrouter-client';

// Process-level singletons so the OpenRouter embedder's in-memory LRU persists
// across calls and we don't reallocate API clients per retrieve(). Keyed by the
// config that actually selects the implementation (backend + model) so a config
// change still yields the right instance. ragConfig is read once at module load
// today, so in practice there is one entry per kind — the keying is defensive.
const embedderCache = new Map<string, Embedder>();
const rerankerCache = new Map<string, Reranker>();

export function createEmbedder(): Embedder {
  const backend = ragConfig.embedBackend;
  const model = backend === 'openrouter' ? ragConfig.openrouterEmbedModel : ragConfig.embedModel;
  const key = `${backend}:${model}`;
  let inst = embedderCache.get(key);
  if (!inst) {
    inst = backend === 'openrouter' ? new OpenRouterEmbedder() : new HfEmbedder();
    embedderCache.set(key, inst);
  }
  return inst;
}

export function createReranker(): Reranker {
  const backend = ragConfig.rerankBackend;
  const model = backend === 'openrouter' ? ragConfig.openrouterRerankModel : ragConfig.rerankModel;
  const key = `${backend}:${model}`;
  let inst = rerankerCache.get(key);
  if (!inst) {
    inst = backend === 'openrouter' ? new OpenRouterReranker() : new HfReranker();
    rerankerCache.set(key, inst);
  }
  return inst;
}
