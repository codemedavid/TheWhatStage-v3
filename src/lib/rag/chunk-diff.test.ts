import { describe, it, expect } from 'vitest';
import { diffChunks } from './chunk-diff';
import type { Chunk } from './types';

const c = (chunkIndex: number, contentHash: string): Chunk => ({
  chunkIndex,
  content: `chunk ${chunkIndex}`,
  headingPath: null,
  tokenCount: 1,
  contentHash,
  isAtomic: false,
  sourceOffset: null,
});

describe('diffChunks', () => {
  it('all insert when nothing exists', () => {
    const d = diffChunks([], [c(0, 'a'), c(1, 'b')]);
    expect(d.insert.map((x) => x.chunkIndex)).toEqual([0, 1]);
    expect(d.update).toEqual([]);
    expect(d.delete).toEqual([]);
    expect(d.skip).toEqual([]);
  });

  it('all skip when hashes match', () => {
    const existing = [
      { chunkIndex: 0, contentHash: 'a' },
      { chunkIndex: 1, contentHash: 'b' },
    ];
    const d = diffChunks(existing, [c(0, 'a'), c(1, 'b')]);
    expect(d.skip).toEqual([0, 1]);
    expect(d.insert).toEqual([]);
    expect(d.update).toEqual([]);
    expect(d.delete).toEqual([]);
  });

  it('updates when hash changes for the same index', () => {
    const existing = [{ chunkIndex: 0, contentHash: 'old' }];
    const d = diffChunks(existing, [c(0, 'new')]);
    expect(d.update).toHaveLength(1);
    expect(d.update[0].contentHash).toBe('new');
    expect(d.insert).toEqual([]);
    expect(d.delete).toEqual([]);
    expect(d.skip).toEqual([]);
  });

  it('deletes indexes missing from next', () => {
    const existing = [
      { chunkIndex: 0, contentHash: 'a' },
      { chunkIndex: 1, contentHash: 'b' },
      { chunkIndex: 2, contentHash: 'c' },
    ];
    const d = diffChunks(existing, [c(0, 'a')]);
    expect(d.skip).toEqual([0]);
    expect(d.delete.sort()).toEqual([1, 2]);
  });

  it('mixed: insert + update + delete + skip in one pass', () => {
    const existing = [
      { chunkIndex: 0, contentHash: 'a' },     // skip
      { chunkIndex: 1, contentHash: 'old' },   // update
      { chunkIndex: 2, contentHash: 'gone' },  // delete
    ];
    const next = [c(0, 'a'), c(1, 'new'), c(3, 'fresh')]; // insert at 3
    const d = diffChunks(existing, next);
    expect(d.skip).toEqual([0]);
    expect(d.update.map((x) => x.chunkIndex)).toEqual([1]);
    expect(d.insert.map((x) => x.chunkIndex)).toEqual([3]);
    expect(d.delete).toEqual([2]);
  });
});
