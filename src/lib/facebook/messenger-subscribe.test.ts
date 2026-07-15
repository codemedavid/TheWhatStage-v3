import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { subscribePageToWebhook, unsubscribePageFromWebhook } from './messenger'

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: { get: () => null },
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

describe('subscribePageToWebhook', () => {
  it('POSTs to /me/subscribed_apps with the page token', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { success: true }))

    await subscribePageToWebhook('page-token-abc')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/me/subscribed_apps')
    expect(String(url)).toContain('access_token=page-token-abc')
    expect(init).toMatchObject({ method: 'POST' })
  })
})

describe('unsubscribePageFromWebhook', () => {
  it('DELETEs /me/subscribed_apps with the page token to pause delivery', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { success: true }))

    await unsubscribePageFromWebhook('page-token-xyz')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/me/subscribed_apps')
    expect(String(url)).toContain('access_token=page-token-xyz')
    expect(init).toMatchObject({ method: 'DELETE' })
  })

  it('throws when Graph rejects the unsubscribe', async () => {
    fetchMock.mockResolvedValue(res(400, { error: { message: 'bad token', code: 190 } }))

    await expect(unsubscribePageFromWebhook('tok')).rejects.toThrow()
  })
})
