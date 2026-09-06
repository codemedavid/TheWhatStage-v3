import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

// Server-side fetch of a stored attachment URL so the client model can look at
// it directly. The URL always comes from our own database (Meta CDN, a signed
// storage URL, or an operator-supplied https URL) — never from tool arguments.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const ATTACHMENT_TIMEOUT_MS = 15_000

const TEXT_LIKE = new Set(['application/json', 'text/plain', 'text/csv', 'text/markdown', 'text/html'])

export type AttachmentFetchOutcome =
  | { kind: 'image'; mimeType: string; base64: string; bytes: number }
  | { kind: 'text'; mimeType: string; text: string; bytes: number }
  | { kind: 'blob'; mimeType: string; base64: string; bytes: number }
  | { kind: 'unavailable'; reason: string; likelyExpired: boolean }

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

function mimeOf(res: Response): string {
  return (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim().toLowerCase()
}

export async function fetchAttachment(
  url: string,
  opts: { fetchImpl?: FetchLike; maxBytes?: number; timeoutMs?: number } = {},
): Promise<AttachmentFetchOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const maxBytes = opts.maxBytes ?? MAX_ATTACHMENT_BYTES
  const timeoutMs = opts.timeoutMs ?? ATTACHMENT_TIMEOUT_MS

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { kind: 'unavailable', reason: 'Stored attachment URL is malformed.', likelyExpired: false }
  }
  if (parsed.protocol !== 'https:') {
    return { kind: 'unavailable', reason: 'Only https attachments can be fetched.', likelyExpired: false }
  }
  const isMetaCdn = /(^|\.)(fbcdn\.net|facebook\.com|fbsbx\.com)$/i.test(parsed.hostname)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(parsed.toString(), { signal: controller.signal, redirect: 'follow' })
    if (!res.ok) {
      const expired = isMetaCdn && (res.status === 403 || res.status === 404 || res.status === 410)
      return {
        kind: 'unavailable',
        reason: expired
          ? `Meta's CDN no longer serves this attachment (HTTP ${res.status}); Messenger media links expire.`
          : `Attachment fetch failed with HTTP ${res.status}.`,
        likelyExpired: expired,
      }
    }
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > maxBytes) {
      return { kind: 'unavailable', reason: `Attachment is ${declared} bytes, over the ${maxBytes}-byte limit.`, likelyExpired: false }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > maxBytes) {
      return { kind: 'unavailable', reason: `Attachment is ${buf.byteLength} bytes, over the ${maxBytes}-byte limit.`, likelyExpired: false }
    }
    const mimeType = mimeOf(res)
    if (mimeType.startsWith('image/')) {
      return { kind: 'image', mimeType, base64: buf.toString('base64'), bytes: buf.byteLength }
    }
    if (TEXT_LIKE.has(mimeType) || mimeType.startsWith('text/')) {
      return { kind: 'text', mimeType, text: buf.toString('utf8'), bytes: buf.byteLength }
    }
    return { kind: 'blob', mimeType, base64: buf.toString('base64'), bytes: buf.byteLength }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return {
      kind: 'unavailable',
      reason: aborted ? `Attachment fetch timed out after ${timeoutMs}ms.` : `Attachment fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      likelyExpired: false,
    }
  } finally {
    clearTimeout(timer)
  }
}

// Turn a fetch outcome into MCP content. Images become native image content
// (the model sees the picture); text is inlined; other binaries become an
// embedded resource blob; failures are explained in plain text.
export function attachmentToContent(
  outcome: AttachmentFetchOutcome,
  meta: { messageId: string; index: number; type: string; name: string | null },
): CallToolResult {
  const label = `Attachment ${meta.index} of message ${meta.messageId} (${meta.type}${meta.name ? `, "${meta.name}"` : ''})`
  const uri = `whatstage://message/${meta.messageId}/attachment/${meta.index}`
  switch (outcome.kind) {
    case 'image':
      return {
        content: [
          { type: 'text', text: `${label}: ${outcome.mimeType}, ${outcome.bytes} bytes.` },
          { type: 'image', data: outcome.base64, mimeType: outcome.mimeType },
        ],
      }
    case 'text':
      return {
        content: [
          { type: 'text', text: `${label}: ${outcome.mimeType}, ${outcome.bytes} bytes.` },
          { type: 'resource', resource: { uri, mimeType: outcome.mimeType, text: outcome.text } },
        ],
      }
    case 'blob':
      return {
        content: [
          { type: 'text', text: `${label}: ${outcome.mimeType}, ${outcome.bytes} bytes (binary, embedded below).` },
          { type: 'resource', resource: { uri, mimeType: outcome.mimeType, blob: outcome.base64 } },
        ],
      }
    case 'unavailable':
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `${label} could not be retrieved. ${outcome.reason}${outcome.likelyExpired ? ' Ask the customer to resend it if you need to see it.' : ''}`,
          },
        ],
      }
  }
}
