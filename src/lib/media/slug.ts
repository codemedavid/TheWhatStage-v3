export function makeSlug(input: string, fallback = 'item', maxLength = 80): string {
  const normalized = normalizeSlugPart(input, maxLength)

  if (normalized.length >= 2) return normalized

  return makeValidFallbackSlug(fallback, maxLength)
}

function normalizeSlugPart(input: string, maxLength: number): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, maxLength)
    .replace(/-+$/g, '')
}

function makeValidFallbackSlug(fallback: string, maxLength: number): string {
  const normalizedFallback = normalizeSlugPart(fallback, maxLength)

  if (normalizedFallback.length >= 2) return normalizedFallback

  const base = normalizedFallback || normalizeSlugPart('item', maxLength)
  if (base.length >= 2) return base
  if (maxLength === 2) return `${base || 'i'}1`

  return `${base || 'i'}-1`.slice(0, Math.max(2, maxLength))
}
