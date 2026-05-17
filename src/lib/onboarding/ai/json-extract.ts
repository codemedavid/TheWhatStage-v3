import 'server-only'

/**
 * Tolerant JSON extraction for LLM output.
 * Handles: ```json fences, leading/trailing prose, and slicing the largest
 * `{...}` substring as a last resort.
 *
 * Optional `ctx.kind` is logged on failure so the dev server log identifies
 * which generation kind produced the unparseable output. Backward-compat:
 * callers may omit the second argument.
 */
export function extractJson(raw: string, ctx?: { kind?: string }): unknown {
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
    try {
      return JSON.parse(candidate.slice(first, last + 1))
    } catch {
      const tag = ctx?.kind ? `ai.${ctx.kind}.invalid_json` : 'ai.invalid_json'
      console.error(`[${tag}] head:`, raw.slice(0, 200))
      throw new Error('invalid_json')
    }
  }
  const tag = ctx?.kind ? `ai.${ctx.kind}.invalid_json` : 'ai.invalid_json'
  console.error(`[${tag}] head:`, raw.slice(0, 200))
  throw new Error('invalid_json')
}

/**
 * Defensive sanitiser for user-supplied strings inlined into LLM prompts.
 * Strips control chars, backtick fences, and obvious jailbreak phrasings;
 * clamps length to bound the prompt and limit prompt-injection blast radius.
 */
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g')
export function sanitizeForPrompt(s: string | null | undefined, max: number = 400): string {
  if (!s) return ''
  return s
    .replace(CONTROL_CHARS, ' ')
    .replace(/```+/g, "'''")
    .replace(/\b(ignore|disregard|forget)\b[^.\n]{0,80}\b(previous|prior|above|system|instructions?)\b/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
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
