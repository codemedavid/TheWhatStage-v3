import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { sendMessengerAttachment, sendMessengerButton, sendMessengerImage } from './messenger'

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

function lastBody(): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return JSON.parse(init.body as string)
}

describe('sendMessengerAttachment', () => {
  it.each(['image', 'video', 'audio', 'file'] as const)(
    'builds a %s attachment payload with is_reusable',
    async (attachmentType) => {
      fetchMock.mockResolvedValueOnce(res(200, { message_id: 'm1' }))
      const r = await sendMessengerAttachment({
        pageAccessToken: 'tok',
        recipientPsid: 'psid-1',
        attachmentType,
        url: 'https://cdn.example.com/file',
      })
      expect(r.message_id).toBe('m1')
      const body = lastBody()
      expect(body).toMatchObject({
        recipient: { id: 'psid-1' },
        messaging_type: 'RESPONSE',
        message: {
          attachment: {
            type: attachmentType,
            payload: { url: 'https://cdn.example.com/file', is_reusable: true },
          },
        },
      })
      expect(body.tag).toBeUndefined()
    },
  )

  it('applies the HUMAN_AGENT tag and MESSAGE_TAG messaging_type when provided', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { message_id: 'm2' }))
    await sendMessengerAttachment({
      pageAccessToken: 'tok',
      recipientPsid: 'psid-1',
      attachmentType: 'file',
      url: 'https://cdn.example.com/doc.pdf',
      messagingType: 'MESSAGE_TAG',
      tag: 'HUMAN_AGENT',
    })
    expect(lastBody()).toMatchObject({
      messaging_type: 'MESSAGE_TAG',
      tag: 'HUMAN_AGENT',
    })
  })
})

describe('sendMessengerImage', () => {
  it('delegates to an image attachment payload', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { message_id: 'm3' }))
    await sendMessengerImage({ pageAccessToken: 'tok', recipientPsid: 'p', imageUrl: 'https://x/y.png' })
    expect(lastBody()).toMatchObject({
      message: { attachment: { type: 'image', payload: { url: 'https://x/y.png', is_reusable: true } } },
    })
  })
})

describe('sendMessengerButton', () => {
  it('passes through HUMAN_AGENT tag for out-of-window operator sends', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { message_id: 'm4' }))
    await sendMessengerButton({
      pageAccessToken: 'tok',
      recipientPsid: 'p',
      text: 'See this page',
      url: 'https://app.example.com/a/page?sig=1',
      ctaLabel: 'Open',
      messagingType: 'MESSAGE_TAG',
      tag: 'HUMAN_AGENT',
    })
    const body = lastBody()
    expect(body).toMatchObject({ messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' })
    const message = body.message as { attachment: { payload: { buttons: Array<{ title: string; url: string }> } } }
    expect(message.attachment.payload.buttons[0]).toMatchObject({
      title: 'Open',
      url: 'https://app.example.com/a/page?sig=1',
    })
  })

  it('defaults to RESPONSE messaging_type with no tag', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { message_id: 'm5' }))
    await sendMessengerButton({
      pageAccessToken: 'tok',
      recipientPsid: 'p',
      text: 't',
      url: 'https://x/y',
      ctaLabel: 'Go',
    })
    const body = lastBody()
    expect(body.messaging_type).toBe('RESPONSE')
    expect(body.tag).toBeUndefined()
  })
})
