import { ragConfig } from './config';
import { HfEmbedder, HfReranker, type Embedder, type Reranker } from './hf-client';
import { OpenRouterEmbedder, OpenRouterReranker } from './openrouter-client';

export function createEmbedder(): Embedder {
  return ragConfig.embedBackend === 'openrouter' ? new OpenRouterEmbedder() : new HfEmbedder();
}

export function createReranker(): Reranker {
  return ragConfig.rerankBackend === 'openrouter' ? new OpenRouterReranker() : new HfReranker();
}
