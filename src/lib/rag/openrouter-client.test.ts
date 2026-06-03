import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the OpenAI SDK so OpenRouterEmbedder.embed/embedBatch hit our spy
// instead of the network. The spy lets us assert the LRU cache prevents a
// second API call for an identical (model, text) pair.
const embeddingsCreateMock = vi.fn();

vi.mock('openai', () => ({
  default: class {
    embeddings = { create: embeddingsCreateMock };
  },
}));

// embedBatch slices by ragConfig.embedBatchSize; force a small size so the
// order-merging logic is exercised across multiple batches.
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.RAG_EMBED_BATCH_SIZE = '2';
  embeddingsCreateMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
  delete process.env.RAG_EMBED_BATCH_SIZE;
});

describe('OpenRouterEmbedder embedding cache', () => {
  it('embed() returns the cached vector on a second identical call without a second API hit', async () => {
    embeddingsCreateMock.mockResolvedValueOnce({
      data: [{ index: 0, embedding: [0.11, 0.22, 0.33] }],
    });

    const { OpenRouterEmbedder } = await import('./openrouter-client');
    const e = new OpenRouterEmbedder();

    const first = await e.embed('hello world');
    const second = await e.embed('hello world');

    expect(first).toEqual([0.11, 0.22, 0.33]);
    // Byte-identical vector on hit (same reference, unmutated contents).
    expect(second).toBe(first);
    expect(embeddingsCreateMock).toHaveBeenCalledTimes(1);
  });

  it('embed() treats a different model/text as a distinct key', async () => {
    embeddingsCreateMock
      .mockResolvedValueOnce({ data: [{ index: 0, embedding: [1, 0] }] })
      .mockResolvedValueOnce({ data: [{ index: 0, embedding: [0, 1] }] });

    const { OpenRouterEmbedder } = await import('./openrouter-client');
    const e = new OpenRouterEmbedder();

    expect(await e.embed('a')).toEqual([1, 0]);
    expect(await e.embed('b')).toEqual([0, 1]);
    expect(embeddingsCreateMock).toHaveBeenCalledTimes(2);
  });

  it('embedBatch() mixes cached + fresh correctly, preserving input order', async () => {
    const { OpenRouterEmbedder } = await import('./openrouter-client');
    const e = new OpenRouterEmbedder();

    // Warm the cache for 'b' and 'd' via single embeds.
    embeddingsCreateMock
      .mockResolvedValueOnce({ data: [{ index: 0, embedding: [2, 2] }] }) // b
      .mockResolvedValueOnce({ data: [{ index: 0, embedding: [4, 4] }] }); // d
    await e.embed('b');
    await e.embed('d');
    expect(embeddingsCreateMock).toHaveBeenCalledTimes(2);

    // Now batch ['a','b','c','d','e'] — only a,c,e are misses. With batchSize=2
    // the misses [a,c,e] split into [a,c] and [e]. The API echoes vectors per
    // input; we verify the merged output is in ORIGINAL order, not miss order.
    embeddingsCreateMock.mockImplementation(
      async ({ input }: { input: string[] }) => ({
        data: input.map((s, i) => ({
          index: i,
          embedding: [s.charCodeAt(0), s.charCodeAt(0)],
        })),
      }),
    );

    const out = await e.embedBatch(['a', 'b', 'c', 'd', 'e']);
    expect(out).toEqual([
      ['a'.charCodeAt(0), 'a'.charCodeAt(0)],
      [2, 2], // cached b
      ['c'.charCodeAt(0), 'c'.charCodeAt(0)],
      [4, 4], // cached d
      ['e'.charCodeAt(0), 'e'.charCodeAt(0)],
    ]);

    // 2 warm-up calls + 2 batch calls ([a,c] and [e]); 'b' and 'd' never refetched.
    expect(embeddingsCreateMock).toHaveBeenCalledTimes(4);
  });

  it('embedBatch() returns [] for empty input without an API call', async () => {
    const { OpenRouterEmbedder } = await import('./openrouter-client');
    const e = new OpenRouterEmbedder();
    expect(await e.embedBatch([])).toEqual([]);
    expect(embeddingsCreateMock).not.toHaveBeenCalled();
  });

  it('embedBatch() skips the API entirely when every item is a cache hit', async () => {
    const { OpenRouterEmbedder } = await import('./openrouter-client');
    const e = new OpenRouterEmbedder();

    embeddingsCreateMock.mockImplementation(
      async ({ input }: { input: string[] }) => ({
        data: input.map((s, i) => ({ index: i, embedding: [s.length] })),
      }),
    );

    await e.embedBatch(['x', 'yy']);
    const callsAfterWarm = embeddingsCreateMock.mock.calls.length;

    const out = await e.embedBatch(['x', 'yy']);
    expect(out).toEqual([[1], [2]]);
    // No new API calls on the fully-cached second pass.
    expect(embeddingsCreateMock.mock.calls.length).toBe(callsAfterWarm);
  });
});
