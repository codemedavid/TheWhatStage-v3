import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { sendMessengerText } from './messenger'
import { MESSENGER_TEXT_LIMIT } from './messenger-split'

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function bodies(): Array<Record<string, unknown>> {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))
}

function sentTexts(): string[] {
  return bodies().map((b) => (b.message as { text: string }).text)
}

describe('sendMessengerText — single message within limit', () => {
  it('sends one request with the full text and returns its message_id', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { message_id: 'm1' }))
    const r = await sendMessengerText({
      pageAccessToken: 'tok',
      recipientPsid: 'psid-1',
      text: 'Hello there!',
    })
    expect(r.message_id).toBe('m1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sentTexts()).toEqual(['Hello there!'])
  })
})

describe('sendMessengerText — long text chunking (Messenger 2000-char hard limit)', () => {
  it('splits a >2000-char reply into multiple ordered sends, each within the limit', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, { message_id: 'part-1' }))
      .mockResolvedValueOnce(res(200, { message_id: 'part-2' }))
      .mockResolvedValueOnce(res(200, { message_id: 'part-3' }))

    const longText = 'Para one. '.repeat(MESSENGER_TEXT_LIMIT / 5) // well over 2000 chars
    const r = await sendMessengerText({
      pageAccessToken: 'tok',
      recipientPsid: 'psid-1',
      text: longText,
    })

    const texts = sentTexts()
    expect(texts.length).toBeGreaterThan(1)
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(MESSENGER_TEXT_LIMIT)
    // No non-whitespace content dropped across the parts.
    expect(texts.join('').replace(/\s+/g, '')).toBe(longText.replace(/\s+/g, ''))
    // Returns the FIRST part's id so the worker's idempotency stamp stays stable.
    expect(r.message_id).toBe('part-1')
  })

  it('carries the HUMAN_AGENT tag/messaging_type onto every chunk', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, { message_id: 'part-1' }))
      .mockResolvedValueOnce(res(200, { message_id: 'part-2' }))

    const longText = 'x'.repeat(MESSENGER_TEXT_LIMIT + 100)
    await sendMessengerText({
      pageAccessToken: 'tok',
      recipientPsid: 'psid-1',
      text: longText,
      messagingType: 'MESSAGE_TAG',
      tag: 'HUMAN_AGENT',
    })

    const all = bodies()
    expect(all.length).toBe(2)
    for (const b of all) {
      expect(b.messaging_type).toBe('MESSAGE_TAG')
      expect(b.tag).toBe('HUMAN_AGENT')
    }
  })
})
