import 'server-only'

/**
 * Tolerant JSON extraction for LLM output.
 * Handles: ```json fences, leading/trailing prose, and slicing the largest
 * `{...}` substring as a last resort.
 */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] ?? raw).trim()
  try {
    return JSON.parse(candidate)
  } catch {
    /* fall through */
  }
  const first = candidate.indexOf('{')
  const last = candidate.lastIndexOf('}')
  if (first !== -1 && last > first) {
    return JSON.parse(candidate.slice(first, last + 1))
  }
  throw new Error('invalid_json')
}

const RETRYABLE_FRAGMENTS = [
  'invalid_json',
  'schema_mismatch',
  'llm_call',           // HF router 5xx, OpenAI socket hangup, etc.
  'fetch failed',       // node undici network blip
  'ECONNRESET',
  'ETIMEDOUT',
  'rate_limit',
] as const

/**
 * Run an LLM-backed generator with one retry on transient failures: JSON
 * parse / schema mismatch (very common formatting blip) and LLM transport
 * errors (5xx, connection reset, rate-limit). Non-transient errors propagate
 * unchanged.
 */
export async function withJsonRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (RETRYABLE_FRAGMENTS.some((f) => msg.includes(f))) {
      return await fn()
    }
    throw err
  }
}
