import { describe, it, expect } from 'vitest';
import { gradeCandidates } from './grader';

describe('gradeCandidates', () => {
  it('partitions into useful / ambiguous / reject', () => {
    const payloads = new Map([
      ['a', { id: 'a', text: 'A' }],
      ['b', { id: 'b', text: 'B' }],
      ['c', { id: 'c', text: 'C' }],
      ['d', { id: 'd', text: 'D' }],
    ]);
    const ranked = [
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.55 },
      { id: 'c', score: 0.3 },
      { id: 'd', score: 0.05 },
    ];
    const r = gradeCandidates(ranked, payloads, { high: 0.7, low: 0.4 });
    expect(r.useful.map((x) => x.id)).toEqual(['a']);
    expect(r.ambiguous.map((x) => x.id)).toEqual(['b']);
    expect(r.reject.map((x) => x.id)).toEqual(['c', 'd']);
  });

  it('skips ranked entries with no payload', () => {
    const r = gradeCandidates(
      [{ id: 'missing', score: 1 }],
      new Map(),
      { high: 0.5, low: 0.2 },
    );
    expect(r.useful).toEqual([]);
  });
});
