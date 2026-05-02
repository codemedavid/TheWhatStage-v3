import { describe, it, expect } from 'vitest';
import { contentHash, normalizeForHash } from './content-hash';

describe('normalizeForHash', () => {
  it('strips trailing whitespace and collapses inner runs', () => {
    expect(normalizeForHash('hello   world  \nfoo\t\tbar')).toBe('hello world\nfoo bar');
  });
  it('normalizes line endings', () => {
    expect(normalizeForHash('a\r\nb\rc')).toBe('a\nb\nc');
  });
  it('caps consecutive blank lines at 2', () => {
    expect(normalizeForHash('a\n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('contentHash', () => {
  it('is stable and 64 hex chars', () => {
    const h = contentHash('hello world');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash('hello world')).toBe(h);
  });
  it('ignores cosmetic whitespace differences', () => {
    expect(contentHash('hello world')).toBe(contentHash('hello   world  '));
    expect(contentHash('a\nb')).toBe(contentHash('a\r\nb'));
  });
  it('differs when actual content changes', () => {
    expect(contentHash('hello')).not.toBe(contentHash('hellos'));
  });
});
