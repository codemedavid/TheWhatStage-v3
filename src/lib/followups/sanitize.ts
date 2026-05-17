// src/lib/followups/sanitize.ts
//
// Strip every dash glyph (project rule: follow-ups must contain no dashes),
// flatten to a single line, cap at 200 chars. Idempotent.

const DASH_RE = /[-‐‑‒–—―]/g
const WS_RE = /\s+/g
const SURROUNDING_QUOTES_RE = /^["']|["']$/g

const MAX_LEN = 200

export function sanitizeFollowup(input: string): string {
  if (!input) return ''
  const dropped = input.replace(DASH_RE, ' ')
  const oneLine = dropped.replace(WS_RE, ' ').trim()
  const dequoted = oneLine.replace(SURROUNDING_QUOTES_RE, '').trim()
  if (!dequoted) return ''
  return dequoted.length > MAX_LEN ? dequoted.slice(0, MAX_LEN) : dequoted
}
