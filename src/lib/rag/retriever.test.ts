import { describe, it, expect, vi } from 'vitest';
import { retrieve, type RetrieverDeps } from './retriever';

const fakeClient = (rpcData: unknown) => ({
  from: () => ({}),
  rpc: vi.fn().mockResolvedValue({ data: rpcData, error: null }),
});

const embedder = {
  embed: vi.fn().mockResolvedValue([0, 0, 0]),
  embedBatch: vi.fn().mockResolvedValue([]),
};

describe('retrieve', () => {
  it('returns empty buckets when RPC returns nothing', async () => {
    const reranker = { rank: vi.fn().mockResolvedValue([]) };
    const r = await retrieve(
      { client: fakeClient([]), embedder, reranker } as unknown as RetrieverDeps,
      { userId: 'u1', query: 'hi' },
    );
    expect(r.buckets.useful).toEqual([]);
    expect(reranker.rank).not.toHaveBeenCalled();
  });

  it('partitions reranked results into buckets when pool is large enough', async () => {
    // 4 candidates > rerankFloorK (3), so reranker is consulted.
    const candidates = [
      { chunk_id: '1', document_id: 'd', faq_id: null, content: 'x', heading_path: null },
      { chunk_id: '2', document_id: 'd', faq_id: null, content: 'y', heading_path: null },
      { chunk_id: '3', document_id: 'd', faq_id: null, content: 'z', heading_path: null },
      { chunk_id: '4', document_id: 'd', faq_id: null, content: 'w', heading_path: null },
    ];
    const client = fakeClient(candidates);
    const reranker = {
      rank: vi.fn().mockResolvedValue([
        { id: '1', score: 0.9 },
        { id: '2', score: 0 },
        { id: '3', score: 0 },
        { id: '4', score: 0 },
      ]),
    };
    const r = await retrieve(
      { client, embedder, reranker } as unknown as RetrieverDeps,
      { userId: 'u', query: 'q' },
    );
    expect(r.buckets.useful.map((x) => x.id)).toEqual(['1']);
    expect(r.buckets.reject.map((x) => x.id).sort()).toEqual(['2', '3', '4']);
    expect(r.rewrote).toBe(false);
  });

  it('skips reranker when candidate pool is at or below floor', async () => {
    const candidates = [
      { chunk_id: '1', document_id: 'd', faq_id: null, content: 'x', heading_path: null },
      { chunk_id: '2', document_id: 'd', faq_id: null, content: 'y', heading_path: null },
    ];
    const client = fakeClient(candidates);
    const reranker = { rank: vi.fn().mockResolvedValue([]) };
    const r = await retrieve(
      { client, embedder, reranker } as unknown as RetrieverDeps,
      { userId: 'u', query: 'q' },
    );
    expect(reranker.rank).not.toHaveBeenCalled();
    // Both surfaced into the prompt context (useful bucket via synthetic scores).
    expect(r.buckets.useful.map((x) => x.id).sort()).toEqual(['1', '2']);
  });

  it('triggers one rewrite only when first search returns zero candidates', async () => {
    const candidates2 = [
      { id: '2', document_id: 'd', faq_id: null, content: 'y', heading_path: null },
    ];
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: candidates2, error: null });
    const client = { from: () => ({}), rpc };
    const reranker = {
      rank: vi.fn().mockResolvedValueOnce([{ id: '2', score: 0.95 }]),
    };
    const rewriteQuery = vi.fn().mockResolvedValue('rewritten');

    const r = await retrieve(
      { client, embedder, reranker, rewriteQuery } as unknown as RetrieverDeps,
      { userId: 'u', query: 'orig' },
    );
    expect(rewriteQuery).toHaveBeenCalledWith('orig');
    expect(r.rewrote).toBe(true);
    expect(r.effectiveQuery).toBe('rewritten');
    expect(r.buckets.useful.map((x) => x.id)).toEqual(['2']);
  });

  it('does NOT rewrite when first pass returned candidates but low scores', async () => {
    // 4 candidates > floorK so the reranker actually runs and rejects them.
    const candidates1 = [
      { id: '1', document_id: 'd', faq_id: null, content: 'x', heading_path: null },
      { id: '2', document_id: 'd', faq_id: null, content: 'y', heading_path: null },
      { id: '3', document_id: 'd', faq_id: null, content: 'z', heading_path: null },
      { id: '4', document_id: 'd', faq_id: null, content: 'w', heading_path: null },
    ];
    const rpc = vi.fn().mockResolvedValue({ data: candidates1, error: null });
    const client = { from: () => ({}), rpc };
    const reranker = {
      rank: vi.fn().mockResolvedValue([
        { id: '1', score: 0.05 },
        { id: '2', score: 0.04 },
        { id: '3', score: 0.03 },
        { id: '4', score: 0.02 },
      ]),
    };
    const rewriteQuery = vi.fn().mockResolvedValue('rewritten');

    const r = await retrieve(
      { client, embedder, reranker, rewriteQuery } as unknown as RetrieverDeps,
      { userId: 'u', query: 'orig' },
    );
    expect(rewriteQuery).not.toHaveBeenCalled();
    expect(r.rewrote).toBe(false);
    // Floor still promotes top reranked hits so the LLM sees something.
    expect(r.buckets.ambiguous.length).toBeGreaterThan(0);
  });
});
