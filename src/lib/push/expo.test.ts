import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendExpoPush, EXPO_PUSH_URL, EXPO_PUSH_CHUNK } from './expo'

function ok(count: number) {
  return Array.from({ length: count }, (_, i) => ({ status: 'ok', id: `ticket-${i}` }))
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('sendExpoPush', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns a zero result without calling Expo when there are no messages', async () => {
    // Arrange / Act
    const result = await sendExpoPush([])

    // Assert
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({ sent: 0, failed: 0, deadTokens: [] })
  })

  it('posts one batch and counts the ok tickets', async () => {
    // Arrange
    fetchMock.mockResolvedValue(jsonResponse({ data: ok(2) }))
    const messages = [
      { to: 'ExponentPushToken[a]', title: 'Ada', body: 'hi' },
      { to: 'ExponentPushToken[b]', title: 'Bo', body: 'yo' },
    ]

    // Act
    const result = await sendExpoPush(messages)

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(EXPO_PUSH_URL)
    expect(JSON.parse(String(init.body))).toEqual(messages)
    expect(result).toEqual({ sent: 2, failed: 0, deadTokens: [] })
  })

  it('splits more than one chunk worth of messages into separate requests', async () => {
    // Arrange
    const messages = Array.from({ length: EXPO_PUSH_CHUNK + 5 }, (_, i) => ({
      to: `ExponentPushToken[${i}]`,
      title: 'x',
      body: 'y',
    }))
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: ok(EXPO_PUSH_CHUNK) }))
      .mockResolvedValueOnce(jsonResponse({ data: ok(5) }))

    // Act
    const result = await sendExpoPush(messages)

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))).toHaveLength(5)
    expect(result.sent).toBe(EXPO_PUSH_CHUNK + 5)
  })

  it('reports DeviceNotRegistered tokens as dead so the caller can prune them', async () => {
    // Arrange
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          { status: 'ok', id: 't1' },
          {
            status: 'error',
            message: '"ExponentPushToken[b]" is not a registered push notification recipient',
            details: { error: 'DeviceNotRegistered' },
          },
        ],
      }),
    )

    // Act
    const result = await sendExpoPush([
      { to: 'ExponentPushToken[a]', title: 'a', body: 'a' },
      { to: 'ExponentPushToken[b]', title: 'b', body: 'b' },
    ])

    // Assert
    expect(result).toEqual({ sent: 1, failed: 1, deadTokens: ['ExponentPushToken[b]'] })
  })

  it('counts a non-DeviceNotRegistered ticket error as failed but keeps the token', async () => {
    // Arrange
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [{ status: 'error', message: 'rate limited', details: { error: 'MessageRateExceeded' } }],
      }),
    )

    // Act
    const result = await sendExpoPush([{ to: 'ExponentPushToken[a]', title: 'a', body: 'a' }])

    // Assert
    expect(result).toEqual({ sent: 0, failed: 1, deadTokens: [] })
  })

  it('counts the whole chunk as failed when Expo returns a non-2xx response', async () => {
    // Arrange
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ code: 'INTERNAL_SERVER_ERROR' }] }, 500))

    // Act
    const result = await sendExpoPush([
      { to: 'ExponentPushToken[a]', title: 'a', body: 'a' },
      { to: 'ExponentPushToken[b]', title: 'b', body: 'b' },
    ])

    // Assert
    expect(result).toEqual({ sent: 0, failed: 2, deadTokens: [] })
  })

  it('counts the whole chunk as failed when the request throws', async () => {
    // Arrange
    fetchMock.mockRejectedValue(new Error('socket hang up'))

    // Act
    const result = await sendExpoPush([{ to: 'ExponentPushToken[a]', title: 'a', body: 'a' }])

    // Assert
    expect(result).toEqual({ sent: 0, failed: 1, deadTokens: [] })
  })

  it('keeps going through later chunks after one chunk fails', async () => {
    // Arrange
    const messages = Array.from({ length: EXPO_PUSH_CHUNK + 1 }, (_, i) => ({
      to: `ExponentPushToken[${i}]`,
      title: 'x',
      body: 'y',
    }))
    fetchMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(jsonResponse({ data: ok(1) }))

    // Act
    const result = await sendExpoPush(messages)

    // Assert
    expect(result).toEqual({ sent: 1, failed: EXPO_PUSH_CHUNK, deadTokens: [] })
  })

  it('sends the EXPO_ACCESS_TOKEN as a bearer header when one is configured', async () => {
    // Arrange
    vi.stubEnv('EXPO_ACCESS_TOKEN', 'secret-token')
    fetchMock.mockResolvedValue(jsonResponse({ data: ok(1) }))

    // Act
    await sendExpoPush([{ to: 'ExponentPushToken[a]', title: 'a', body: 'a' }])

    // Assert
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret-token')
    vi.unstubAllEnvs()
  })
})
