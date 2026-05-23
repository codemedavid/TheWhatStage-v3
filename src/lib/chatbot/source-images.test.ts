// src/lib/chatbot/source-images.test.ts
import { describe, expect, it, vi } from 'vitest';
import { resolveSourceImages } from './source-images';

type BuilderChain = {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

function makeFakeSupabase(handlers: Record<string, (val: unknown) => unknown>) {
  return {
    from: vi.fn((table: string) => {
      const state: { val?: unknown } = {};
      const builder: BuilderChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((_col: string, val: unknown) => { state.val = val; return builder; }),
        in: vi.fn((_col: string, vals: unknown) => { state.val = vals; return builder; }),
        maybeSingle: vi.fn(async () => ({ data: handlers[table]?.(state.val), error: null })),
      };
      // make in() return a Promise (for multi-row fetches)
      builder.in = vi.fn((_col: string, vals: unknown) => {
        state.val = vals;
        return Promise.resolve({ data: [handlers[table]?.(vals)].flat().filter(Boolean), error: null });
      });
      return builder;
    }),
  };
}

describe('resolveSourceImages', () => {
  it('resolves product cover image from a business_item chunk', async () => {
    const supabase = makeFakeSupabase({
      business_items: () => ({
        id: 'bi-1', kind: 'product', title: 'X10 Runner',
        cover_image_url: 'https://example.com/x10.png',
      }),
    });
    const out = await resolveSourceImages(supabase as never, [
      { business_item_id: 'bi-1', payment_method_id: null,
        document_id: null, faq_id: null, media_asset_id: null,
        content: 'X10 is great', rrf_score: 0.8 },
    ]);
    expect(out).toEqual([
      { sourceKey: 'product:bi-1', imageUrl: 'https://example.com/x10.png',
        rerankerScore: 0.8, altText: 'X10 Runner' },
    ]);
  });

  it('resolves payment QR url from a payment_method chunk', async () => {
    const supabase = makeFakeSupabase({
      payment_methods: () => ({ id: 'pm-1', name: 'GCash · Main',
        details: { qr_image_url: 'https://example.com/qr.png' } }),
    });
    const out = await resolveSourceImages(supabase as never, [
      { payment_method_id: 'pm-1', business_item_id: null,
        document_id: null, faq_id: null, media_asset_id: null,
        content: 'GCash', rrf_score: 0.7 },
    ]);
    expect(out[0]).toMatchObject({
      sourceKey: 'payment:pm-1',
      imageUrl: 'https://example.com/qr.png',
    });
  });

  it('deduplicates same source across multiple chunks, keeping highest score', async () => {
    const supabase = makeFakeSupabase({
      business_items: () => ({
        id: 'bi-1', kind: 'product', title: 'X10',
        cover_image_url: 'https://example.com/x10.png',
      }),
    });
    const out = await resolveSourceImages(supabase as never, [
      { business_item_id: 'bi-1', payment_method_id: null,
        document_id: null, faq_id: null, media_asset_id: null,
        content: 'X10 part 1', rrf_score: 0.6 },
      { business_item_id: 'bi-1', payment_method_id: null,
        document_id: null, faq_id: null, media_asset_id: null,
        content: 'X10 part 2', rrf_score: 0.9 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].rerankerScore).toBe(0.9);
  });

  it('skips chunks without an image', async () => {
    const supabase = makeFakeSupabase({
      business_items: () => ({ id: 'bi-1', kind: 'product', title: 'X10',
        cover_image_url: null }),
    });
    const out = await resolveSourceImages(supabase as never, [
      { business_item_id: 'bi-1', payment_method_id: null,
        document_id: null, faq_id: null, media_asset_id: null,
        content: 'X10', rrf_score: 0.5 },
    ]);
    expect(out).toEqual([]);
  });

  it('skips document and faq chunks', async () => {
    const supabase = makeFakeSupabase({});
    const out = await resolveSourceImages(supabase as never, [
      { document_id: 'd-1', business_item_id: null, payment_method_id: null,
        faq_id: null, media_asset_id: null, content: 'doc', rrf_score: 0.7 },
      { faq_id: 'f-1', document_id: null, business_item_id: null,
        payment_method_id: null, media_asset_id: null, content: 'faq', rrf_score: 0.6 },
    ]);
    expect(out).toEqual([]);
  });
});
