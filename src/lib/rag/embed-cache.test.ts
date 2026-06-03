import { describe, expect, it } from 'vitest';
import { EmbedCache } from './embed-cache';

describe('EmbedCache', () => {
  it('keyFor is stable and namespaced by model', () => {
    const a = EmbedCache.keyFor('m1', 'hello');
    const b = EmbedCache.keyFor('m1', 'hello');
    const c = EmbedCache.keyFor('m2', 'hello');
    const d = EmbedCache.keyFor('m1', 'world');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });

  it('returns the same reference that was stored', () => {
    const cache = new EmbedCache(10);
    const vec = [1, 2, 3];
    cache.set('k', vec);
    expect(cache.get('k')).toBe(vec);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('evicts the least-recently-used entry past capacity', () => {
    const cache = new EmbedCache(2);
    cache.set('a', [1]);
    cache.set('b', [2]);
    // Touch 'a' so 'b' becomes least-recently-used.
    expect(cache.get('a')).toEqual([1]);
    cache.set('c', [3]); // evicts 'b'
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toEqual([1]);
    expect(cache.get('c')).toEqual([3]);
    expect(cache.size).toBe(2);
  });
});
