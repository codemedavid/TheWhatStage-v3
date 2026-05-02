import { describe, it, expect } from 'vitest';
import { enqueuePendingSources, runJob, type EmbedJobRow, type SourceFetchers } from './embed-job';
import type { Embedder } from '../hf-client';
import type { SupabaseLike } from '../ingest';

type TestRecord = Record<string, unknown>;

function fakeClient() {
  const updates: Array<{ table: string; patch: Record<string, unknown>; eq?: [string, unknown] }> = [];
  const upserts: Array<{ table: string; rows: unknown[] }> = [];
  const deletes: Array<{ table: string; col: string; ids: number[] }> = [];

  const client = {
    from(table: string) {
      const builder: TestRecord = {};
      builder.select = () => ({
        eq: () => Promise.resolve({ data: [] as Array<{ chunk_index: number; content_hash: string }>, error: null }),
      });
      builder.upsert = (rows: unknown[]) => {
        upserts.push({ table, rows });
        return Promise.resolve({ error: null });
      };
      builder.update = (patch: Record<string, unknown>) => {
        const chain: TestRecord = {
          eq: (col: string, val: unknown) => {
            updates.push({ table, patch, eq: [col, val] });
            return chain;
          },
          select: () => Promise.resolve({ data: [{ id: 'updated' }], error: null }),
          then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
        };
        return chain;
      };
      builder.delete = () => {
        const filters: Array<[string, unknown]> = []
        const deleteChain: TestRecord = {
          eq: (col: string, val: unknown) => {
            filters.push([col, val])
            return deleteChain
          },
          in: (_col: string, ids: number[]) => {
            const [, val] = filters[0] ?? ['', '']
            deletes.push({ table, col: String(val), ids });
            return Promise.resolve({ error: null });
          },
          then: (resolve: (value: { error: null }) => unknown) => {
            const [, val] = filters[0] ?? ['', '']
            deletes.push({ table, col: String(val), ids: [] })
            return resolve({ error: null })
          },
        };
        return deleteChain
      };
      return builder;
    },
  };
  return { client, updates, upserts, deletes };
}

const embedder: Embedder = {
  embed: async () => Array(1024).fill(0),
  embedBatch: async (texts) => texts.map(() => Array(1024).fill(0)),
};

const fetchers: SourceFetchers = {
  fetchDocument: async () => ({
    title: 'T',
    contentJson: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    },
  }),
  fetchFaq: async () => ({ question: 'Q?', answer: 'A.' }),
  fetchBusinessItem: async () => ({ title: 'Starter Kit', ragText: 'Useful product notes.' }),
};

describe('runJob', () => {
  it('embeds a fresh document and marks the source indexed', async () => {
    const { client, updates, upserts } = fakeClient();
    const job: EmbedJobRow = {
      id: 'j1',
      document_id: 'd1',
      faq_id: null,
      business_item_id: null,
      media_asset_id: null,
      user_id: 'u1',
      attempts: 0,
      source_version: 0,
    };
    await runJob(client as unknown as SupabaseLike, job, fetchers, embedder);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].table).toBe('knowledge_chunks');
    expect((upserts[0].rows[0] as TestRecord).document_id).toBe('d1');
    expect(updates.find((u) => u.table === 'knowledge_documents')?.patch.embedding_status).toBe('indexed');
    const jobUpdate = updates.find((u) => u.table === 'knowledge_embedding_jobs');
    expect(jobUpdate?.patch.status).toBe('done');
    expect(jobUpdate?.patch.last_error).toBeNull();
  });

  it('marks job failed after max attempts', async () => {
    const { client, updates } = fakeClient();
    const broken: SourceFetchers = {
      ...fetchers,
      fetchDocument: async () => {
        throw new Error('boom');
      },
    };
    const job: EmbedJobRow = {
      id: 'j2',
      document_id: 'd1',
      faq_id: null,
      business_item_id: null,
      media_asset_id: null,
      user_id: 'u1',
      attempts: 4, // one short of MAX_ATTEMPTS=5
      source_version: 0,
    };
    await runJob(client as unknown as SupabaseLike, job, broken, embedder);
    const jobUpdate = updates.find((u) => u.table === 'knowledge_embedding_jobs');
    expect(jobUpdate?.patch.status).toBe('failed');
    expect(jobUpdate?.patch.attempts).toBe(5);
  });

  it('requeues with backoff before max attempts', async () => {
    const { client, updates } = fakeClient();
    const broken: SourceFetchers = {
      ...fetchers,
      fetchDocument: async () => {
        throw new Error('boom');
      },
    };
    const job: EmbedJobRow = {
      id: 'j3',
      document_id: 'd1',
      faq_id: null,
      business_item_id: null,
      media_asset_id: null,
      user_id: 'u1',
      attempts: 1,
      source_version: 0,
    };
    await runJob(client as unknown as SupabaseLike, job, broken, embedder);
    const jobUpdate = updates.find((u) => u.table === 'knowledge_embedding_jobs');
    expect(jobUpdate?.patch.status).toBe('queued');
    expect(jobUpdate?.patch.attempts).toBe(2);
  });

  it('requeues stale jobs without writing chunks', async () => {
    const { client, updates, upserts } = fakeClient();
    const newer: SourceFetchers = {
      ...fetchers,
      fetchDocument: async () => ({
        title: 'T',
        version: 2,
        contentJson: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'newer' }] }],
        },
      }),
    };
    const job: EmbedJobRow = {
      id: 'j4',
      document_id: 'd1',
      faq_id: null,
      business_item_id: null,
      media_asset_id: null,
      user_id: 'u1',
      attempts: 0,
      source_version: 1,
    };

    await runJob(client as unknown as SupabaseLike, job, newer, embedder);

    expect(upserts).toHaveLength(0);
    const jobUpdate = updates.find((u) => u.table === 'knowledge_embedding_jobs');
    expect(jobUpdate?.patch.status).toBe('queued');
    expect(jobUpdate?.patch.source_version).toBe(2);
  });

  it('embeds a fresh business item and marks the item indexed', async () => {
    const { client, updates, upserts } = fakeClient();
    const job: EmbedJobRow = {
      id: 'j5',
      document_id: null,
      faq_id: null,
      business_item_id: 'bi1',
      media_asset_id: null,
      user_id: 'u1',
      attempts: 0,
      source_version: 0,
    };
    await runJob(client as unknown as SupabaseLike, job, fetchers, embedder);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].table).toBe('knowledge_chunks');
    const row = upserts[0].rows[0] as TestRecord;
    expect(row.business_item_id).toBe('bi1');
    expect(row.document_id).toBeNull();
    expect(row.faq_id).toBeNull();
    expect(updates.find((u) => u.table === 'business_items')?.patch.embedding_status).toBe('indexed');
  });

  it('finishes stale business item jobs without embedding when the item is no longer indexable', async () => {
    const { client, deletes, updates, upserts } = fakeClient();
    const disabled: SourceFetchers = {
      ...fetchers,
      fetchBusinessItem: async () => ({
        title: 'Archived Kit',
        ragText: 'Archived product notes.',
        version: 2,
        status: 'archived',
        ragEnabled: false,
      }),
    };
    const job: EmbedJobRow = {
      id: 'j6',
      document_id: null,
      faq_id: null,
      business_item_id: 'bi2',
      media_asset_id: null,
      user_id: 'u1',
      attempts: 0,
      source_version: 1,
    };

    await runJob(client as unknown as SupabaseLike, job, disabled, embedder);

    expect(upserts).toHaveLength(0);
    expect(deletes).toHaveLength(1);
    expect(updates.find((u) => u.table === 'business_items')?.patch.embedding_status).toBe('pending');
    expect(updates.find((u) => u.table === 'knowledge_embedding_jobs')?.patch.status).toBe('done');
  });

  it('embeds a fresh media asset and marks the asset indexed', async () => {
    const { client, updates, upserts } = fakeClient();
    const mediaFetchers: SourceFetchers = {
      ...fetchers,
      fetchMediaAsset: async () => ({
        name: 'Ryan Engineer Review',
        version: 3,
        isArchived: false,
        ragText:
          '# Ryan Engineer Review\n\nMedia folder: Reviews\nFolder slug: #image-review\nImage slug: @new-review-customer-ryan',
      }),
    };
    const job: EmbedJobRow = {
      id: 'j-media',
      document_id: null,
      faq_id: null,
      business_item_id: null,
      media_asset_id: 'ma1',
      user_id: 'u1',
      attempts: 0,
      source_version: 3,
    };

    await runJob(client as unknown as SupabaseLike, job, mediaFetchers, embedder);

    expect(upserts).toHaveLength(1);
    const row = upserts[0].rows[0] as TestRecord;
    expect(row.media_asset_id).toBe('ma1');
    expect(row.document_id).toBeNull();
    expect(row.faq_id).toBeNull();
    expect(row.business_item_id).toBeNull();
    expect(updates.find((u) => u.table === 'media_assets')?.patch.embedding_status).toBe('indexed');
  });

  it('finishes media asset jobs without embedding when the asset is archived or empty', async () => {
    const { client, deletes, updates, upserts } = fakeClient();
    const archived: SourceFetchers = {
      ...fetchers,
      fetchMediaAsset: async () => ({
        name: 'Old Review',
        ragText: '',
        version: 4,
        isArchived: true,
      }),
    };
    const job: EmbedJobRow = {
      id: 'j-media-archived',
      document_id: null,
      faq_id: null,
      business_item_id: null,
      media_asset_id: 'ma2',
      user_id: 'u1',
      attempts: 0,
      source_version: 4,
    };

    await runJob(client as unknown as SupabaseLike, job, archived, embedder);

    expect(upserts).toHaveLength(0);
    expect(deletes).toHaveLength(1);
    expect(updates.find((u) => u.table === 'media_assets')?.patch.embedding_status).toBe('pending');
    expect(updates.find((u) => u.table === 'knowledge_embedding_jobs')?.patch.status).toBe('done');
  });
});

describe('enqueuePendingSources', () => {
  it('enqueues pending documents, faqs, business items, and media assets without active jobs', async () => {
    const inserted: unknown[] = [];
    const staleUpdates: Array<{ table: string; id: string }> = [];
    const sources = {
      knowledge_documents: [{ id: 'd1', user_id: 'u1', version: 3 }],
      knowledge_faqs: [{ id: 'f1', user_id: 'u1', version: 2 }],
      business_items: [{ id: 'bi1', user_id: 'u1', version: 4 }],
      media_assets: [{ id: 'ma1', user_id: 'u1', version: 5 }],
      knowledge_embedding_jobs: [],
    };

    const client = {
      from(table: string) {
        const builder: TestRecord = {
          select: () => builder,
          in: () => builder,
          not: () => builder,
          neq: () => builder,
          eq: (col: string, val: unknown) => {
            builder.lastEq = [col, val];
            return builder;
          },
          limit: () => {
            if (table === 'knowledge_embedding_jobs') return Promise.resolve({ data: [], error: null });
            return Promise.resolve({ data: sources[table as keyof typeof sources], error: null });
          },
          insert: (row: unknown) => {
            inserted.push(row);
            return Promise.resolve({ error: null });
          },
          update: () => ({
            eq: (_col: string, id: string) => {
              staleUpdates.push({ table, id });
              return Promise.resolve({ error: null });
            },
          }),
        };
        return builder;
      },
    };

    const result = await enqueuePendingSources(client as unknown as SupabaseLike, { limit: 10 });

    expect(result.enqueued).toBe(4);
    expect(inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ document_id: 'd1', user_id: 'u1', source_version: 3 }),
        expect.objectContaining({ faq_id: 'f1', user_id: 'u1', source_version: 2 }),
        expect.objectContaining({ business_item_id: 'bi1', user_id: 'u1', source_version: 4 }),
        expect.objectContaining({ media_asset_id: 'ma1', user_id: 'u1', source_version: 5 }),
      ]),
    );
    expect(staleUpdates).toEqual(
      expect.arrayContaining([
        { table: 'knowledge_documents', id: 'd1' },
        { table: 'knowledge_faqs', id: 'f1' },
        { table: 'business_items', id: 'bi1' },
        { table: 'media_assets', id: 'ma1' },
      ]),
    );
  });
});
