import { createHash } from 'node:crypto'

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? value.trim() : value
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  const obj = value as Record<string, unknown>
  const sortedKeys = Object.keys(obj).sort()
  const out: Record<string, unknown> = {}
  for (const k of sortedKeys) out[k] = canonicalize(obj[k])
  return out
}

export function canonicalHash(input: unknown): string {
  const json = JSON.stringify(canonicalize(input))
  return createHash('sha256').update(json).digest('hex')
}
