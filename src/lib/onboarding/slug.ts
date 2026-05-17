import { randomUUID } from 'node:crypto'

/**
 * Build a URL-safe slug from a free-text seed plus a high-entropy suffix.
 * Uses `crypto.randomUUID()` (~128 bits) instead of `Math.random()` (~31 bits)
 * so slug collisions across users are effectively impossible without a unique
 * constraint guarding inserts.
 */
export function uniqueSlug(seed: string, fallback = 'page'): string {
  const base = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || fallback
  return `${base}-${randomUUID().replace(/-/g, '').slice(0, 8)}`
}
