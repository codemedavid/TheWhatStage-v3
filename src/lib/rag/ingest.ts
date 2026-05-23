import { parse, type ParseInput } from './parsers';
import { chunk } from './chunker';
import { diffChunks, type ExistingChunk } from './chunk-diff';
import type { Chunk, ChunkDiff, SourceKind } from './types';
import type { Embedder } from './hf-client';
import { ragConfig } from './config';

export interface SupabaseLike {
  // Supabase query builders intentionally remain structurally loose here:
  // tests use small chainable fakes and production passes SupabaseClient.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc?: (fn: string, args?: Record<string, unknown>) => any;
}

export interface IngestSource {
  kind: SourceKind;
  /** knowledge_documents.id, knowledge_faqs.id, business_items.id, or media_assets.id */
  sourceId: string;
  userId: string;
  sourceVersion?: number;
  useAtomicRpc?: boolean;
  parseInput: ParseInput;
}

export interface IngestResult {
  diff: { insert: number; update: number; delete: number; skip: number };
  totalChunks: number;
}

export class StaleSourceVersionError extends Error {
  constructor(public readonly currentVersion: number) {
    super(`source version is stale; current version is ${currentVersion}`);
    this.name = 'StaleSourceVersionError';
  }
}

function sourceColumns(kind: SourceKind): {
  sourceCol: 'document_id' | 'faq_id' | 'business_item_id' | 'media_asset_id' | 'payment_method_id';
  nullCols: Array<'document_id' | 'faq_id' | 'business_item_id' | 'media_asset_id' | 'payment_method_id'>;
} {
  switch (kind) {
    case 'document':
      return { sourceCol: 'document_id', nullCols: ['faq_id', 'business_item_id', 'media_asset_id', 'payment_method_id'] };
    case 'faq':
      return { sourceCol: 'faq_id', nullCols: ['document_id', 'business_item_id', 'media_asset_id', 'payment_method_id'] };
    case 'business_item':
      return { sourceCol: 'business_item_id', nullCols: ['document_id', 'faq_id', 'media_asset_id', 'payment_method_id'] };
    case 'media_asset':
      return { sourceCol: 'media_asset_id', nullCols: ['document_id', 'faq_id', 'business_item_id', 'payment_method_id'] };
    case 'payment_method':
      return { sourceCol: 'payment_method_id', nullCols: ['document_id', 'faq_id', 'business_item_id', 'media_asset_id'] };
  }
}

/**
 * Pure planning step: takes existing chunks for a source and the new ParseInput,
 * returns the diff. Used by the worker; isolated from Supabase for testability.
 */
export function planIngest(input: ParseInput, existing: ExistingChunk[]): {
  chunks: Chunk[];
  diff: ChunkDiff;
} {
  const parsed = parse(input);
  const chunks = chunk(parsed, {
    targetTokens: ragConfig.chunkTargetTokens,
    maxTokens: ragConfig.chunkMaxTokens,
    overlapTokens: ragConfig.chunkOverlapTokens,
  });
  const diff = diffChunks(existing, chunks);
  return { chunks, diff };
}

/**
 * Apply a diff against Supabase: embed only insert+update, upsert by
 * (source, chunk_index), delete tombstoned indexes. Runs serially per source
 * but batches embedding calls.
 */
export async function applyIngest(
  client: SupabaseLike,
  source: IngestSource,
  diff: ChunkDiff,
  embedder: Embedder,
): Promise<IngestResult> {
  const { sourceCol, nullCols } = sourceColumns(source.kind);

  const toEmbed = [...diff.insert, ...diff.update];
  const vectors = toEmbed.length
    ? await embedder.embedBatch(toEmbed.map((c) => c.content))
    : [];

  const rows = toEmbed.map((c, i) => ({
    [sourceCol]: source.sourceId,
    ...Object.fromEntries(nullCols.map((col) => [col, null])),
    user_id: source.userId,
    chunk_index: c.chunkIndex,
    content: c.content,
    heading_path: c.headingPath,
    source_offset: c.sourceOffset
      ? `[${c.sourceOffset.start},${c.sourceOffset.end})`
      : null,
    token_count: c.tokenCount,
    content_hash: c.contentHash,
    is_atomic: c.isAtomic,
    embedding: vectors[i],
  }));

  if (source.useAtomicRpc && client.rpc) {
    const { data, error } = await client.rpc('apply_knowledge_ingest', {
      p_kind: source.kind,
      p_source_id: source.sourceId,
      p_user_id: source.userId,
      p_source_version: source.sourceVersion ?? 0,
      p_rows: rows,
      p_delete_indexes: diff.delete,
    });
    if (error) throw new Error(`apply ingest failed: ${error.message ?? error}`);
    const resultRow = Array.isArray(data) ? data[0] : data;
    if (resultRow && resultRow.applied === false) {
      throw new StaleSourceVersionError(Number(resultRow.current_version ?? 0));
    }
    return {
      diff: {
        insert: diff.insert.length,
        update: diff.update.length,
        delete: diff.delete.length,
        skip: diff.skip.length,
      },
      totalChunks: diff.insert.length + diff.update.length + diff.skip.length,
    };
  }

  if (rows.length) {
    const { error } = await client
      .from('knowledge_chunks')
      .upsert(rows, { onConflict: `${sourceCol},chunk_index` });
    if (error) throw new Error(`upsert chunks failed: ${error.message ?? error}`);
  }

  if (diff.delete.length) {
    const { error } = await client
      .from('knowledge_chunks')
      .delete()
      .eq(sourceCol, source.sourceId)
      .in('chunk_index', diff.delete);
    if (error) throw new Error(`delete tombstoned chunks failed: ${error.message ?? error}`);
  }

  return {
    diff: {
      insert: diff.insert.length,
      update: diff.update.length,
      delete: diff.delete.length,
      skip: diff.skip.length,
    },
    totalChunks: diff.insert.length + diff.update.length + diff.skip.length,
  };
}

/**
 * Read existing chunk hashes for a source.
 */
export async function loadExistingChunks(
  client: SupabaseLike,
  source: { kind: SourceKind; sourceId: string },
): Promise<ExistingChunk[]> {
  const { sourceCol } = sourceColumns(source.kind);
  const { data, error } = await client
    .from('knowledge_chunks')
    .select('chunk_index, content_hash')
    .eq(sourceCol, source.sourceId);
  if (error) throw new Error(`load existing chunks failed: ${error.message ?? error}`);
  return (data ?? []).map((r: { chunk_index: number; content_hash: string }) => ({
    chunkIndex: r.chunk_index,
    contentHash: r.content_hash,
  }));
}
