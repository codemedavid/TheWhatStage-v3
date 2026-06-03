// Shared slug helper (pure; safe in client + server). Produces a value that
// satisfies the DB check `^[a-z0-9][a-z0-9-]{1,79}$` (min length 2). Returns ''
// when the input has no usable characters — callers must validate before use.
export function slugify(input: string): string {
  const s = (input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return s.length >= 2 ? s : ''
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,79}$/
export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s)
}
