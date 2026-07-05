import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { takeThreadControl } from './messenger'

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

describe('takeThreadControl', () => {
  it('POSTs take_thread_control with the recipient PSID and page token', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { success: true }))

    await takeThreadControl('page-token-abc', 'psid-123')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/me/take_thread_control')
    expect(String(url)).toContain('access_token=page-token-abc')
    expect(init).toMatchObject({ method: 'POST' })
    expect(JSON.parse(init.body)).toEqual({ recipient: { id: 'psid-123' } })
  })

  it('throws when Graph rejects the take (e.g. not a receiver on the page)', async () => {
    fetchMock.mockResolvedValue(
      res(400, { error: { message: 'not authorized', code: 200 } }),
    )

    await expect(takeThreadControl('tok', 'psid-1')).rejects.toThrow()
  })
})
