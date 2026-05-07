import type { SupabaseClient } from '@supabase/supabase-js';
import { applyIngest, loadExistingChunks, planIngest, type SupabaseLike } from './ingest';
import { type Embedder } from './hf-client';
import { createEmbedder } from './factory';
import type { SourceKind } from './types';
import type { ParseInput } from './parsers';

export interface EmbedNowInput {
  kind: SourceKind;
  sourceId: string;
  userId: string;
}

export interface EmbedNowResult {
  ok: true;
  diff: { insert: number; update: number; delete: number; skip: number };
  totalChunks: number;
}

export interface EmbedNowFailure {
  ok: false;
  error: string;
}

async function fetchSource(
  supabase: SupabaseLike,
  input: EmbedNowInput,
): Promise<{ parseInput: ParseInput; sourceVersion: number }> {
  if (input.kind === 'document') {
    const { data, error } = await supabase
      .from('knowledge_documents')
      .select('title, content_json, content_text, version')
      .eq('id', input.sourceId)
      .single();
    if (error || !data) throw new Error(`document ${input.sourceId} missing: ${error?.message}`);
    return {
      parseInput: {
        kind: 'document',
        title: data.title,
        contentJson: data.content_json,
        contentText: data.content_text,
      },
      sourceVersion: Number(data.version ?? 0),
    };
  }
  const { data, error } = await supabase
    .from('knowledge_faqs')
    .select('question, answer, version')
    .eq('id', input.sourceId)
    .single();
  if (error || !data) throw new Error(`faq ${input.sourceId} missing: ${error?.message}`);
  return {
    parseInput: { kind: 'faq', question: data.question, answer: data.answer },
    sourceVersion: Number(data.version ?? 0),
  };
}

/**
 * Embed (or re-embed) a single source synchronously. Idempotent — safe to call
 * multiple times; unchanged chunks are skipped via content_hash.
 *
 * Manual/dev helper for embedding a source synchronously. Production saves
 * should enqueue a `knowledge_embedding_jobs` row so retries, stale-version
 * checks, and cron processing all use the same path. On success the source
 * row is marked `embedding_status='indexed'`; on failure it stays `'stale'`.
 */
export async function embedSourceNow(
  supabase: SupabaseClient,
  input: EmbedNowInput,
  embedder: Embedder = createEmbedder(),
): Promise<EmbedNowResult | EmbedNowFailure> {
  const client = supabase as unknown as SupabaseLike;
  const sourceTable = input.kind === 'document' ? 'knowledge_documents' : 'knowledge_faqs';

  try {
    const { parseInput, sourceVersion } = await fetchSource(client, input);
    const existing = await loadExistingChunks(client, { kind: input.kind, sourceId: input.sourceId });
    const { diff } = planIngest(parseInput, existing);

    const result = await applyIngest(
      client,
      { kind: input.kind, sourceId: input.sourceId, userId: input.userId, sourceVersion, parseInput },
      diff,
      embedder,
    );

    await supabase
      .from(sourceTable)
      .update({ embedding_status: 'indexed', embedded_at: new Date().toISOString() })
      .eq('id', input.sourceId)
      .eq('version', sourceVersion);

    console.log('[rag] embed_done', {
      kind: input.kind,
      sourceId: input.sourceId,
      ...result.diff,
    });

    return { ok: true, diff: result.diff, totalChunks: result.totalChunks };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[rag] embed_failed', {
      kind: input.kind,
      sourceId: input.sourceId,
      error: message,
    });
    // Leave embedding_status='stale' so the UI shows "needs indexing".
    return { ok: false, error: message };
  }
}
