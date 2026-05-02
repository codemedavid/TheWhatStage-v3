import { createHash } from 'node:crypto';

/**
 * Normalize content before hashing so cosmetic edits (whitespace, line endings)
 * don't trigger re-embeds. We collapse runs of whitespace per line and strip
 * trailing whitespace, but preserve blank lines as paragraph separators.
 */
export function normalizeForHash(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').replace(/[ \t]{2,}/g, ' '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function contentHash(s: string): string {
  return createHash('sha256').update(normalizeForHash(s), 'utf8').digest('hex');
}
