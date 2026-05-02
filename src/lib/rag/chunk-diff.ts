import type { Chunk, ChunkDiff } from './types';

export interface ExistingChunk {
  chunkIndex: number;
  contentHash: string;
}

/**
 * Compare new chunks against existing rows for the same source.
 * Stable key is chunk_index. A matching index with matching hash is `skip`;
 * matching index but different hash is `update`; missing on either side is
 * `insert` or `delete`.
 *
 * This is what guarantees no-duplicate-on-edit: we never produce a fresh row
 * for an existing chunk_index, only upserts.
 */
export function diffChunks(existing: ExistingChunk[], next: Chunk[]): ChunkDiff {
  const existingByIndex = new Map<number, ExistingChunk>();
  for (const e of existing) existingByIndex.set(e.chunkIndex, e);

  const nextIndexes = new Set<number>(next.map((c) => c.chunkIndex));

  const insert: Chunk[] = [];
  const update: Chunk[] = [];
  const skip: number[] = [];

  for (const c of next) {
    const prev = existingByIndex.get(c.chunkIndex);
    if (!prev) {
      insert.push(c);
    } else if (prev.contentHash !== c.contentHash) {
      update.push(c);
    } else {
      skip.push(c.chunkIndex);
    }
  }

  const del: number[] = [];
  for (const e of existing) {
    if (!nextIndexes.has(e.chunkIndex)) del.push(e.chunkIndex);
  }

  return { insert, update, delete: del, skip };
}
