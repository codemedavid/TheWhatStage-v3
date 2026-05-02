import { describe, it, expect } from 'vitest';
import { chunk } from './chunker';
import type { ParsedSource } from './types';

const src = (markdown: string, atomic = false): ParsedSource => ({
  kind: 'document',
  title: 'T',
  markdown,
  atomic,
});

describe('chunker', () => {
  it('returns no chunks for empty input', () => {
    expect(chunk(src(''))).toEqual([]);
    expect(chunk(src('   \n\n  '))).toEqual([]);
  });

  it('emits one chunk for an atomic source regardless of size', () => {
    const big = 'x '.repeat(5000);
    const out = chunk(src(`# Q\n\n${big}`, true));
    expect(out).toHaveLength(1);
    expect(out[0].isAtomic).toBe(true);
    expect(out[0].chunkIndex).toBe(0);
    expect(out[0].headingPath).toBe('Q');
  });

  it('keeps a small doc in a single chunk', () => {
    const out = chunk(src('# Title\n\nshort body'));
    expect(out).toHaveLength(1);
    expect(out[0].headingPath).toBe('Title');
    expect(out[0].content.startsWith('# Title')).toBe(true);
  });

  it('builds a hierarchical heading_path', () => {
    const md = [
      '# A',
      '',
      'preamble of A',
      '',
      '## B',
      '',
      'body of B',
      '',
      '### C',
      '',
      'body of C',
      '',
      '## D',
      '',
      'body of D',
    ].join('\n');
    const out = chunk(src(md));
    const paths = out.map((c) => c.headingPath);
    expect(paths).toEqual(['A', 'A > B', 'A > B > C', 'A > D']);
  });

  it('splits oversized sections', () => {
    const big = ('lorem ipsum dolor sit amet '.repeat(400)).trim();
    const out = chunk(src(`# Big\n\n${big}`), { targetTokens: 100, maxTokens: 120, overlapTokens: 0 });
    expect(out.length).toBeGreaterThan(2);
    for (const c of out) {
      expect(c.tokenCount).toBeLessThanOrEqual(125);
      expect(c.headingPath).toBe('Big');
    }
  });

  it('chunk_index is 0-based and contiguous', () => {
    const big = ('x '.repeat(2000)).trim();
    const out = chunk(src(`# A\n\n${big}\n\n## B\n\n${big}`), {
      targetTokens: 100,
      maxTokens: 120,
      overlapTokens: 0,
    });
    out.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  });

  it('content_hash is stable across runs and unique per content', () => {
    const a = chunk(src('# A\n\nhello'));
    const b = chunk(src('# A\n\nhello'));
    const c = chunk(src('# A\n\nworld'));
    expect(a[0].contentHash).toBe(b[0].contentHash);
    expect(a[0].contentHash).not.toBe(c[0].contentHash);
    expect(a[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records source_offset within the original markdown', () => {
    const md = '# A\n\nfirst para\n\n## B\n\nsecond para';
    const out = chunk(src(md));
    expect(out[1].sourceOffset).not.toBeNull();
    expect(out[1].sourceOffset!.end).toBeGreaterThan(out[1].sourceOffset!.start);
  });

  it('does not split inside a fenced code block', () => {
    const md = '# A\n\nbefore\n\n```ts\n# not a heading\nconst x = 1\n```\n\nafter';
    const out = chunk(src(md));
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain('# not a heading');
  });
});
