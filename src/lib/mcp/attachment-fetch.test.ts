import { describe, expect, it } from 'vitest'
import { attachmentToContent, fetchAttachment } from './attachment-fetch'

const META = { messageId: 'm1', index: 0, type: 'image', name: null }

function response(body: Uint8Array | string, init: { status?: number; type?: string; length?: number } = {}) {
  const headers = new Headers()
  if (init.type) headers.set('content-type', init.type)
  if (init.length !== undefined) headers.set('content-length', String(init.length))
  return new Response(body as BodyInit, { status: init.status ?? 200, headers })
}

describe('fetchAttachment', () => {
  it('returns image bytes as base64 with mime type', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00])
    const out = await fetchAttachment('https://cdn.example/x.jpg', {
      fetchImpl: async () => response(bytes, { type: 'image/jpeg; charset=binary' }),
    })
    expect(out).toEqual({ kind: 'image', mimeType: 'image/jpeg', base64: Buffer.from(bytes).toString('base64'), bytes: 4 })
  })

  it('returns text-like bodies inline', async () => {
    const out = await fetchAttachment('https://x/y.txt', { fetchImpl: async () => response('hello', { type: 'text/plain' }) })
    expect(out).toMatchObject({ kind: 'text', mimeType: 'text/plain', text: 'hello' })
  })

  it('flags a 403 from the Meta CDN as an expired link', async () => {
    const out = await fetchAttachment('https://scontent.xx.fbcdn.net/v/x.jpg', {
      fetchImpl: async () => response('', { status: 403 }),
    })
    expect(out).toMatchObject({ kind: 'unavailable', likelyExpired: true })
  })

  it('does not call expired on a non-Meta 403', async () => {
    const out = await fetchAttachment('https://other.example/x.jpg', { fetchImpl: async () => response('', { status: 403 }) })
    expect(out).toMatchObject({ kind: 'unavailable', likelyExpired: false })
  })

  it('refuses oversize bodies by header and by actual size', async () => {
    const byHeader = await fetchAttachment('https://x/big', {
      fetchImpl: async () => response('x', { type: 'image/png', length: 999 }),
      maxBytes: 10,
    })
    expect(byHeader).toMatchObject({ kind: 'unavailable', likelyExpired: false })
    const byBody = await fetchAttachment('https://x/big', {
      fetchImpl: async () => response('x'.repeat(50), { type: 'image/png' }),
      maxBytes: 10,
    })
    expect(byBody).toMatchObject({ kind: 'unavailable' })
  })

  it('refuses non-https and malformed URLs without fetching', async () => {
    let called = false
    const fetchImpl = async () => { called = true; return response('') }
    expect(await fetchAttachment('http://x/y', { fetchImpl })).toMatchObject({ kind: 'unavailable' })
    expect(await fetchAttachment('not a url', { fetchImpl })).toMatchObject({ kind: 'unavailable' })
    expect(called).toBe(false)
  })

  it('reports a timeout as unavailable', async () => {
    const out = await fetchAttachment('https://x/slow', {
      timeoutMs: 5,
      fetchImpl: (_u, init) => new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      }),
    })
    expect(out).toMatchObject({ kind: 'unavailable', likelyExpired: false })
    expect((out as { reason: string }).reason).toMatch(/timed out/)
  })
})

describe('attachmentToContent', () => {
  it('emits native image content for images', () => {
    const result = attachmentToContent({ kind: 'image', mimeType: 'image/png', base64: 'AAAA', bytes: 3 }, META)
    expect(result.isError).toBeUndefined()
    expect(result.content[1]).toEqual({ type: 'image', data: 'AAAA', mimeType: 'image/png' })
  })

  it('emits an error result with the reason for unavailable attachments', () => {
    const result = attachmentToContent({ kind: 'unavailable', reason: 'gone', likelyExpired: true }, META)
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('gone')
    expect((result.content[0] as { text: string }).text).toContain('resend')
  })
})
