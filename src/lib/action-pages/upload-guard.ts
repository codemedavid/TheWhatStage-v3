import { createHash } from 'node:crypto'

/**
 * Shared hardening for the PUBLIC, unauthenticated action-page upload routes
 * (`customer-images` and `payment-proofs`). These routes use the service-role
 * admin client and are reachable by anonymous visitors, so they cannot require
 * a logged-in user or a deeplink (legitimate clients send neither). Instead we
 * defend with magic-byte sniffing and a best-effort per-IP rate limit.
 */

export const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/**
 * Sniff the leading bytes of an uploaded buffer to confirm it really is one of
 * the allowed raster image formats. We do NOT trust the client-declared
 * `file.type`, since that is attacker-controlled. Returns the detected format
 * (used to pick the stored extension) or null when nothing matches.
 */
export function sniffImageType(
  buffer: Buffer,
): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png'
  }
  // WebP: "RIFF" .... "WEBP" (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

export function extForImageType(type: 'image/jpeg' | 'image/png' | 'image/webp'): string {
  return type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg'
}

/**
 * Derive a stable rate-limit identifier from the request headers. We hash the
 * client IP so we don't retain raw addresses in memory. Falls back to a shared
 * bucket when no forwarding header is present (best-effort).
 */
export function clientRateKey(headers: Headers, slug: string): string {
  const ip =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headers.get('x-real-ip') ??
    'unknown'
  const hashed = createHash('sha256').update(ip).digest('hex').slice(0, 16)
  return `${slug}:${hashed}`
}

// --- Minimal in-memory fixed-window rate limiter ---------------------------
// 10 uploads per IP+slug per 60s window. This is a sane default that lets a
// real visitor retry a few failed uploads but blocks scripted abuse of our
// ImageKit quota. NOTE: in-memory state is PER SERVER INSTANCE only — under
// horizontal scaling each instance keeps its own counters, so the effective
// global limit is `LIMIT * instances`. A Redis/Upstash-backed limiter would be
// the production-grade follow-up for a true global limit.
const RATE_LIMIT = 10
const WINDOW_MS = 60 * 1000

const buckets = new Map<string, { count: number; resetAt: number }>()

/**
 * Best-effort fixed-window check. Returns `true` when the caller is within the
 * limit (allowed) and `false` when it should be rejected with 429. Fails OPEN:
 * any internal error returns `true` so a limiter bug never hard-breaks uploads.
 */
export function checkRateLimit(key: string, nowMs: number = Date.now()): boolean {
  try {
    const existing = buckets.get(key)
    if (!existing || existing.resetAt <= nowMs) {
      buckets.set(key, { count: 1, resetAt: nowMs + WINDOW_MS })
      // Opportunistically evict stale buckets to bound memory growth.
      if (buckets.size > 10_000) {
        for (const [k, v] of buckets) {
          if (v.resetAt <= nowMs) buckets.delete(k)
        }
      }
      return true
    }
    if (existing.count >= RATE_LIMIT) return false
    existing.count += 1
    return true
  } catch {
    return true
  }
}
