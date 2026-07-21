import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { sendMessengerTextSequence, bubbleDelayMs } from './messenger'
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

describe('bubbleDelayMs', () => {
  it('scales with length but stays within [800, 2200] ms', () => {
    expect(bubbleDelayMs('')).toBeGreaterThanOrEqual(800)
    expect(bubbleDelayMs('x'.repeat(1000))).toBeLessThanOrEqual(2200)
    const short = bubbleDelayMs('Hi po!')
    const long = bubbleDelayMs('Ano po ang pangalan ng inyong negosyo?')
    expect(long).toBeGreaterThanOrEqual(short)
  })
})

describe('sendMessengerTextSequence', () => {
  it('sends each bubble in order and returns one part per delivered bubble', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, { message_id: 'b1' }))
      .mockResolvedValueOnce(res(200, { recipient_id: 'r' })) // typing_on before bubble 2
      .mockResolvedValueOnce(res(200, { message_id: 'b2' }))

    const sleep = vi.fn().mockResolvedValue(undefined)
    const r = await sendMessengerTextSequence({
      pageAccessToken: 'tok',
      recipientPsid: 'psid-1',
      segments: ['Hello po bossing!', 'Ano po name ng business niyo?'],
      sleep,
    })

    expect(r.parts.map((p) => p.message_id)).toEqual(['b1', 'b2'])
    expect(r.parts.map((p) => p.text)).toEqual([
      'Hello po bossing!',
      'Ano po name ng business niyo?',
    ])
  })

  it('shows a typing indicator and waits before every bubble AFTER the first', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, { message_id: 'b1' }))
      .mockResolvedValueOnce(res(200, { recipient_id: 'r' }))
      .mockResolvedValueOnce(res(200, { message_id: 'b2' }))

    const sleep = vi.fn().mockResolvedValue(undefined)
    await sendMessengerTextSequence({
      pageAccessToken: 'tok',
      recipientPsid: 'psid-1',
      segments: ['First bubble.', 'Second bubble?'],
      sleep,
    })

    // No delay before bubble 1; exactly one paced wait before bubble 2.
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep.mock.calls[0][0]).toBeGreaterThan(0)

    // A typing_on sender_action was emitted between the two text sends.
    const actions = bodies().map((b) => b.sender_action).filter(Boolean)
    expect(actions).toEqual(['typing_on'])
  })

  it('further splits a bubble that exceeds the 2000-char Graph limit', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, { message_id: 'p1' }))
      .mockResolvedValueOnce(res(200, { recipient_id: 'r' })) // typing_on between chunks
      .mockResolvedValueOnce(res(200, { message_id: 'p2' }))

    const huge = 'x'.repeat(MESSENGER_TEXT_LIMIT + 100)
    const sleep = vi.fn().mockResolvedValue(undefined)
    const r = await sendMessengerTextSequence({
      pageAccessToken: 'tok',
      recipientPsid: 'psid-1',
      segments: [huge],
      sleep,
    })

    expect(r.parts.length).toBe(2)
    for (const p of r.parts) expect(p.text.length).toBeLessThanOrEqual(MESSENGER_TEXT_LIMIT)
  })

  it('carries the HUMAN_AGENT tag/messaging_type onto every text bubble', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, { message_id: 'b1' }))
      .mockResolvedValueOnce(res(200, { recipient_id: 'r' }))
      .mockResolvedValueOnce(res(200, { message_id: 'b2' }))

    const sleep = vi.fn().mockResolvedValue(undefined)
    await sendMessengerTextSequence({
      pageAccessToken: 'tok',
      recipientPsid: 'psid-1',
      segments: ['One.', 'Two?'],
      messagingType: 'MESSAGE_TAG',
      tag: 'HUMAN_AGENT',
      sleep,
    })

    const textBodies = bodies().filter((b) => b.message)
    expect(textBodies.length).toBe(2)
    for (const b of textBodies) {
      expect(b.messaging_type).toBe('MESSAGE_TAG')
      expect(b.tag).toBe('HUMAN_AGENT')
    }
  })
})
