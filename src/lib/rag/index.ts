// Public surface for the RAG pipeline.
export { ragConfig } from './config';
export { parse } from './parsers';
export { chunk } from './chunker';
export { contentHash, normalizeForHash } from './content-hash';
export { diffChunks } from './chunk-diff';
export { HfEmbedder, HfReranker } from './hf-client';
export { OpenRouterEmbedder, OpenRouterReranker } from './openrouter-client';
export { createEmbedder, createReranker } from './factory';
export { HfRouterLlm } from './llm';
export { planIngest, applyIngest, loadExistingChunks } from './ingest';
export { embedSourceNow } from './embed-now';
export { enqueueEmbedJob } from './queue';
export { runDueJobs, runJob } from './worker/embed-job';
export { retrieve } from './retriever';
export { gradeCandidates } from './grader';
export { buildPrompt } from './prompt-builder';
export type * from './types';
