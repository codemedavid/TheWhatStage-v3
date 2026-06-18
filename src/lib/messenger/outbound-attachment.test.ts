import { describe, expect, it, vi, beforeEach } from 'vitest'

type Args = Record<string, unknown>
const sendMessengerText = vi.fn(async (_a: Args) => ({ message_id: 'text-1' }))
const sendMessengerButton = vi.fn(async (_a: Args) => ({ message_id: 'btn-1' }))
const sendMessengerImage = vi.fn(async (_a: Args) => ({ message_id: 'img-1' }))
const sendMessengerAttachment = vi.fn(async (_a: Args) => ({ message_id: 'att-1' }))
const sendMessengerGenericTemplate = vi.fn(async (_a: Args) => ({ message_id: 'gen-1' }))
const sendMessengerUtilityTemplate = vi.fn(async (_a: Args) => ({ message_id: 'util-1' }))

vi.mock('@/lib/facebook/messenger', () => ({
  sendMessengerText: (a: Args) => sendMessengerText(a),
  sendMessengerButton: (a: Args) => sendMessengerButton(a),
  sendMessengerImage: (a: Args) => sendMessengerImage(a),
  sendMessengerAttachment: (a: Args) => sendMessengerAttachment(a),
  sendMessengerGenericTemplate: (a: Args) => sendMessengerGenericTemplate(a),
  sendMessengerUtilityTemplate: (a: Args) => sendMessengerUtilityTemplate(a),
}))

import { sendOutbound } from './outbound'

// Minimal chainable admin stub — sendOutbound only calls
// admin.from('messenger_threads').update({...}).eq(...) for operator sends
// inside/outside the window (no optin/otn lookups on the operator path).
function adminStub() {
  const eq = vi.fn(async () => ({ data: null, error: null }))
  const update = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ update }))
  return { from } as never
}

const OUT_OF_WINDOW = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
const IN_WINDOW = new Date(Date.now() - 60_000).toISOString()

const baseThread = { id: 't1', psid: 'psid-1' }

beforeEach(() => {
  sendMessengerText.mockClear()
  sendMessengerButton.mockClear()
  sendMessengerImage.mockClear()
  sendMessengerAttachment.mockClear()
})

describe('sendOutbound — operator media/button HUMAN_AGENT tagging', () => {
  it('tags an out-of-window operator image send with HUMAN_AGENT', async () => {
    const r = await sendOutbound({
      admin: adminStub(),
      thread: { ...baseThread, last_inbound_at: OUT_OF_WINDOW },
      pageToken: 'tok',
      payload: { kind: 'image', imageUrl: 'https://x/y.png' },
      kind: 'operator',
    })
    expect(r).toEqual({ sent: true, messageId: 'img-1' })
    expect(sendMessengerImage).toHaveBeenCalledWith(
      expect.objectContaining({ messagingType: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' }),
    )
  })

  it.each(['video', 'audio', 'file'] as const)(
    'routes an out-of-window operator %s send through sendMessengerAttachment with the tag',
    async (kind) => {
      const r = await sendOutbound({
        admin: adminStub(),
        thread: { ...baseThread, last_inbound_at: OUT_OF_WINDOW },
        pageToken: 'tok',
        payload: { kind, url: 'https://x/media' },
        kind: 'operator',
      })
      expect(r).toEqual({ sent: true, messageId: 'att-1' })
      expect(sendMessengerAttachment).toHaveBeenCalledWith(
        expect.objectContaining({ attachmentType: kind, messagingType: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' }),
      )
    },
  )

  it('tags an out-of-window operator button (action page) send with HUMAN_AGENT', async () => {
    await sendOutbound({
      admin: adminStub(),
      thread: { ...baseThread, last_inbound_at: OUT_OF_WINDOW },
      pageToken: 'tok',
      payload: { kind: 'button', text: 't', url: 'https://app/a/p', ctaLabel: 'Open' },
      kind: 'operator',
    })
    expect(sendMessengerButton).toHaveBeenCalledWith(
      expect.objectContaining({ messagingType: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' }),
    )
  })

  it('does NOT tag an in-window operator image send (RESPONSE window suffices)', async () => {
    await sendOutbound({
      admin: adminStub(),
      thread: { ...baseThread, last_inbound_at: IN_WINDOW },
      pageToken: 'tok',
      payload: { kind: 'image', imageUrl: 'https://x/y.png' },
      kind: 'operator',
    })
    const arg = sendMessengerImage.mock.calls[0][0]
    expect(arg.tag).toBeUndefined()
    expect(arg.messagingType).toBeUndefined()
  })
})
