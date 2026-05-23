import { createHash } from 'node:crypto'

export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

export function normalizeEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase()
  return v.length > 0 ? v : null
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D+/g, '')
  return digits.length > 0 ? digits : null
}

export function splitName(raw: string): { first: string | null; last: string | null } {
  const trimmed = raw.trim()
  if (!trimmed) return { first: null, last: null }
  const idx = trimmed.search(/\s+/)
  if (idx === -1) return { first: trimmed.toLowerCase(), last: null }
  const first = trimmed.slice(0, idx).toLowerCase()
  const last = trimmed.slice(idx).trim().toLowerCase()
  return { first: first || null, last: last || null }
}

/**
 * Hash pre-normalised values. Pass values through normalizeEmail /
 * normalizePhone / splitName before calling this function.
 */
export function hashList(values: Array<string | null | undefined>): string[] | null {
  const out: string[] = []
  for (const v of values) {
    if (!v) continue
    const trimmed = v.trim()
    if (!trimmed) continue
    out.push(sha256(trimmed))
  }
  return out.length > 0 ? out : null
}
