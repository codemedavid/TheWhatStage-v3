import { createHash } from 'node:crypto';

/**
 * Bounded, insertion-order LRU for query embeddings. Keyed by
 * `${model}:${sha256(text)}` so the same text under the same model returns the
 * exact vector that was first computed (byte-identical on hit). Values are the
 * vectors themselves — we store the reference and never mutate it, so callers
 * see the same array contents they would have received from the API.
 *
 * This is intentionally tiny: a Map preserves insertion order, so the oldest
 * key is the first key returned by `keys()`. On a hit we re-insert to mark the
 * entry most-recently-used. We do NOT cache reranks.
 */
export class EmbedCache {
  private readonly map = new Map<string, number[]>();
  private readonly max: number;

  constructor(max = 500) {
    this.max = Math.max(1, max);
  }

  static keyFor(model: string, text: string): string {
    const h = createHash('sha256').update(text, 'utf8').digest('hex');
    return `${model}:${h}`;
  }

  get(key: string): number[] | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // Mark most-recently-used.
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: number[]): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}
