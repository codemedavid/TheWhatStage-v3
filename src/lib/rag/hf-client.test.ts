import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn<typeof fetch>();
const featureExtractionMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

vi.mock('@huggingface/inference', () => ({
  InferenceClient: class {
    featureExtraction = featureExtractionMock;
  },
}));

beforeEach(() => {
  fetchMock.mockReset();
  featureExtractionMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.RAG_EMBED_BATCH_SIZE;
});

describe('HfEmbedder', () => {
  it('embed() returns a flat number[]', async () => {
    featureExtractionMock.mockResolvedValueOnce([0.1, 0.2, 0.3]);
    const { HfEmbedder } = await import('./hf-client');
    const v = await new HfEmbedder({ token: 't' }).embed('hi');
    expect(v).toEqual([0.1, 0.2, 0.3]);
  });

  it('embed() unwraps a [[...]] shape', async () => {
    featureExtractionMock.mockResolvedValueOnce([[0.4, 0.5]]);
    const { HfEmbedder } = await import('./hf-client');
    const v = await new HfEmbedder({ token: 't' }).embed('hi');
    expect(v).toEqual([0.4, 0.5]);
  });

  it('embedBatch() preserves order across batches', async () => {
    process.env.RAG_EMBED_BATCH_SIZE = '2';
    featureExtractionMock.mockImplementation(async ({ inputs }: { inputs: string[] }) =>
      inputs.map((s) => [s.length, 0]),
    );

    const { HfEmbedder } = await import('./hf-client');
    const v = await new HfEmbedder({ token: 't' }).embedBatch(['a', 'bb', 'ccc', 'dddd']);
    expect(v).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ]);
  });

  it('embedBatch() returns [] for empty input', async () => {
    const { HfEmbedder } = await import('./hf-client');
    const v = await new HfEmbedder({ token: 't' }).embedBatch([]);
    expect(v).toEqual([]);
    expect(featureExtractionMock).not.toHaveBeenCalled();
  });

  it('rejects a model id passed as the provider', async () => {
    const { HfEmbedder } = await import('./hf-client');
    expect(() => new HfEmbedder({ token: 't', provider: 'BAAI/bge-m3' })).toThrow(
      /provider.*not a model id/i,
    );
  });

  it('retries on failure', async () => {
    featureExtractionMock
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce([1, 2]);
    const { HfEmbedder } = await import('./hf-client');
    const v = await new HfEmbedder({ token: 't' }).embed('hi');
    expect(v).toEqual([1, 2]);
    expect(featureExtractionMock).toHaveBeenCalledTimes(2);
  }, 20000);
});

describe('HfReranker', () => {
  it('returns scores sorted desc', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        inputs: Array<{ text_pair: string }>;
      };
      return jsonResponse(
        body.inputs.map((input) => {
          const score = input.text_pair.includes('best')
            ? 0.9
            : input.text_pair.includes('mid')
              ? 0.5
              : 0.1;
          return [{ label: 'LABEL_0', score }];
        }),
      );
    });

    const { HfReranker } = await import('./hf-client');
    const r = await new HfReranker({ token: 't' }).rank('q', [
      { id: 'a', text: 'low' },
      { id: 'b', text: 'best' },
      { id: 'c', text: 'mid' },
    ]);
    expect(r.map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(r[0].score).toBeCloseTo(0.9);
  });

  it('handles single-response shape', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ label: 'positive', score: 0.7 }]));
    const { HfReranker } = await import('./hf-client');
    const r = await new HfReranker({ token: 't' }).rank('q', [{ id: 'a', text: 'x' }]);
    expect(r[0].score).toBeCloseTo(0.7);
  });

  it('returns [] for empty input', async () => {
    const { HfReranker } = await import('./hf-client');
    const r = await new HfReranker({ token: 't' }).rank('q', []);
    expect(r).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
