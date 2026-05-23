// src/lib/chatbot/attach-gate.test.ts
import { describe, expect, it } from 'vitest';
import { firstMentionGate } from './attach-gate';
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
