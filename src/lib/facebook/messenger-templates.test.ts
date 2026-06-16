import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  createMessengerTemplate,
  fetchAllMessengerTemplates,
  MetaTemplateError,
} from './messenger-templates'

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
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

describe('createMessengerTemplate', () => {
  it('returns the created template on success', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { id: 'tpl_1', status: 'APPROVED' }))
    const r = await createMessengerTemplate({
      fbPageId: 'p1',
      pageAccessToken: 'tok',
      name: 'order_update',
      language: 'en_US',
      bodyText: 'Hi {{1}}',
      sampleValues: ['Maria'],
    })
    expect(r).toEqual({ id: 'tpl_1', status: 'APPROVED' })
  })

  it('throws a MetaTemplateError carrying the structured code (permission error)', async () => {
    fetchMock.mockResolvedValueOnce(
      res(403, { error: { message: '(#200) Requires pages_utility_messaging', code: 200, error_subcode: 33 } }),
    )
    await expect(
      createMessengerTemplate({
        fbPageId: 'p1',
        pageAccessToken: 'tok',
        name: 'order_update',
        language: 'en_US',
        bodyText: 'Hi {{1}}',
        sampleValues: ['Maria'],
      }),
    ).rejects.toMatchObject({ code: 200, httpStatus: 403 })

    fetchMock.mockResolvedValueOnce(
      res(403, { error: { message: '(#200) perms', code: 200 } }),
    )
    try {
      await createMessengerTemplate({ fbPageId: 'p1', pageAccessToken: 'tok', name: 'n', language: 'en_US', bodyText: 'b', sampleValues: [] })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(MetaTemplateError)
      expect((e as MetaTemplateError).isPermissionError).toBe(true)
    }
  })
})

describe('fetchAllMessengerTemplates', () => {
  it('follows paging.next and concatenates all pages', async () => {
    fetchMock
      .mockResolvedValueOnce(
        res(200, {
          data: [{ id: 't1', name: 'a', language: 'en_US', status: 'APPROVED' }],
          paging: { next: 'https://graph.facebook.com/next-page&access_token=tok' },
        }),
      )
      .mockResolvedValueOnce(
        res(200, {
          data: [{ id: 't2', name: 'b', language: 'en_US', status: 'PENDING', rejected_reason: null }],
        }),
      )

    const rows = await fetchAllMessengerTemplates({ fbPageId: 'p1', pageAccessToken: 'tok' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // second call uses the absolute paging.next URL verbatim
    expect(fetchMock.mock.calls[1][0]).toContain('next-page')
    expect(rows.map((r) => r.id)).toEqual(['t1', 't2'])
    expect(rows[0].rejected_reason).toBeNull()
  })

  it('throws MetaTemplateError on a non-OK page', async () => {
    fetchMock.mockResolvedValueOnce(res(400, { error: { message: 'bad', code: 100 } }))
    await expect(fetchAllMessengerTemplates({ fbPageId: 'p1', pageAccessToken: 'tok' })).rejects.toBeInstanceOf(MetaTemplateError)
  })
})
