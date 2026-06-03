// src/lib/chatbot/attach-gate.test.ts
import { describe, expect, it } from 'vitest';
import { firstMentionGate, filterAttachableMedia, mediaAttachKey } from './attach-gate';
import type { SourceImage } from './source-images';

function img(key: string, score: number): SourceImage {
  return { sourceKey: key, imageUrl: `https://e.com/${key}.png`, rerankerScore: score };
}

describe('firstMentionGate', () => {
  it('lets first-mention items through unconditionally', () => {
    const r = firstMentionGate({
      attachedItemKeys: [],
      candidates: [img('product:a', 0.7), img('product:b', 0.6)],
      customerText: 'tell me about it',
    });
    expect(r.approved.map((c) => c.sourceKey)).toEqual(['product:a', 'product:b']);
    expect(r.newKeys).toEqual(['product:a', 'product:b']);
  });

  it('skips already-attached items without visual intent', () => {
    const r = firstMentionGate({
      attachedItemKeys: ['product:a'],
      candidates: [img('product:a', 0.7)],
      customerText: 'what is the price',
    });
    expect(r.approved).toEqual([]);
    expect(r.newKeys).toEqual([]);
  });

  it('re-attaches already-attached items when visual intent is present', () => {
    const r = firstMentionGate({
      attachedItemKeys: ['product:a'],
      candidates: [img('product:a', 0.7)],
      customerText: 'can you show me again',
    });
    expect(r.approved.map((c) => c.sourceKey)).toEqual(['product:a']);
    expect(r.newKeys).toEqual([]);
  });

  it('caps approvals at 3 per turn (highest scores win)', () => {
    const r = firstMentionGate({
      attachedItemKeys: [],
      candidates: [
        img('a', 0.5), img('b', 0.9), img('c', 0.7),
        img('d', 0.8), img('e', 0.6),
      ],
      customerText: 'show me',
    });
    expect(r.approved).toHaveLength(3);
    expect(r.approved.map((c) => c.sourceKey)).toEqual(['b', 'd', 'c']);
  });
});

const asset = (id: string) => ({ id });

describe('filterAttachableMedia', () => {
  it('sends all candidates on first mention (none seen yet)', () => {
    const out = filterAttachableMedia({
      candidates: [asset('a1'), asset('a2')],
      sentAssetIds: [],
      attachedItemKeys: [],
      customerText: 'do you have proof of payment?',
    });
    expect(out.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('skips an asset already shown on a prior turn without visual intent', () => {
    const out = filterAttachableMedia({
      candidates: [asset('a1'), asset('a2')],
      sentAssetIds: [],
      attachedItemKeys: [mediaAttachKey('a1')],
      customerText: 'how much is shipping?',
    });
    expect(out.map((a) => a.id)).toEqual(['a2']);
  });

  it('re-sends a prior-turn asset when the customer asks to see it again', () => {
    const out = filterAttachableMedia({
      candidates: [asset('a1')],
      sentAssetIds: [],
      attachedItemKeys: [mediaAttachKey('a1')],
      customerText: 'pakita mo ulit yung proof',
    });
    expect(out.map((a) => a.id)).toEqual(['a1']);
  });

  it('never re-sends an asset already sent earlier in the same job, even on visual intent', () => {
    const out = filterAttachableMedia({
      candidates: [asset('a1'), asset('a2')],
      sentAssetIds: ['a1'],
      attachedItemKeys: [],
      customerText: 'show me the photos again',
    });
    expect(out.map((a) => a.id)).toEqual(['a2']);
  });

  it('caps the number of eligible assets per turn', () => {
    const out = filterAttachableMedia({
      candidates: [asset('a1'), asset('a2'), asset('a3'), asset('a4'), asset('a5')],
      sentAssetIds: [],
      attachedItemKeys: [],
      customerText: 'send me the screenshots',
      maxPerTurn: 4,
    });
    expect(out.map((a) => a.id)).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  it('does not collide with source-image keys (product:/payment:) in the same array', () => {
    const out = filterAttachableMedia({
      candidates: [asset('a1')],
      sentAssetIds: [],
      // a product key that happens to share the raw id must NOT dedup the media asset
      attachedItemKeys: ['product:a1', 'payment:a1'],
      customerText: 'what is this?',
    });
    expect(out.map((a) => a.id)).toEqual(['a1']);
  });
});
