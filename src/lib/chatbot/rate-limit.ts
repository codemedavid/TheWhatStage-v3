// Per-server-instance best-effort rate limiter using an in-memory sliding window.
// NOTE: This only works correctly within a single Node.js process. In a serverless
// or multi-instance environment each instance has its own Map, so limits are not
// globally enforced. A shared store (Redis/DB) would be needed for global enforcement.

const windows = new Map<string, number[]>()

export function checkRateLimit(
  key: string,
  opts?: { limit?: number; windowMs?: number },
): { ok: boolean; retryAfterMs: number; remaining: number } {
  const limit = opts?.limit ?? 20
  const windowMs = opts?.windowMs ?? 60_000
  const now = Date.now()
  const cutoff = now - windowMs

  // Retrieve or initialise the timestamp list for this key.
  let timestamps = windows.get(key)
  if (!timestamps) {
    timestamps = []
    windows.set(key, timestamps)
  }

  // Prune timestamps that have fallen outside the current window.
  let start = 0
  while (start < timestamps.length && timestamps[start] < cutoff) {
    start++
  }
  if (start > 0) {
    timestamps.splice(0, start)
  }

  if (timestamps.length >= limit) {
    // oldest in-window timestamp is timestamps[0]; it expires at timestamps[0] + windowMs
    const retryAfterMs = timestamps[0] + windowMs - now
    return { ok: false, retryAfterMs: Math.max(retryAfterMs, 0), remaining: 0 }
  }

  timestamps.push(now)
  return { ok: true, retryAfterMs: 0, remaining: limit - timestamps.length }
}
