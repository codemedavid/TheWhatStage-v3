import { beforeEach, describe, expect, it, vi } from 'vitest'

const enqueueEmbedJob = vi.fn()
vi.mock('@/lib/rag', () => ({ enqueueEmbedJob: (...args: unknown[]) => enqueueEmbedJob(...args) }))

const processSourceInline = vi.fn()
vi.mock('@/lib/rag/process-now', () => ({
  processSourceInline: (...args: unknown[]) => processSourceInline(...args),
}))

// `after` defers to the response being flushed in production; here it runs the
// callback immediately so the test can assert on the embedding it schedules.
const afterCallbacks: (() => unknown)[] = []
vi.mock('next/server', () => ({ after: (cb: () => unknown) => afterCallbacks.push(cb) }))

import { publishUploadedAssets } from './upload-publish'

const LANDED = {
  id: 'asset-1',
  name: 'Shop front',
  slug: 'shop-front',
  storage_path: 'u1/folder-1/asset-1-shop-front.png',
  mime_type: 'image/png',
  version: 3,
}
const NEVER_ARRIVED = { ...LANDED, id: 'asset-2', storage_path: 'u1/folder-1/asset-2-gone.png' }
const STILL_PENDING = { ...LANDED, id: 'asset-3', storage_path: 'pending' }

function makeClient(rows: (typeof LANDED)[], objectsInStorage: string[] = [LANDED.storage_path]) {
  const updated: string[] = []
  const deleted: string[][] = []

  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            in: () => ({ returns: async () => ({ data: rows, error: null }) }),
          }),
        }),
      }),
      update: () => ({
        eq: async (_column: string, id: string) => {
          updated.push(id)
          return { error: null }
        },
      }),
      delete: () => ({
        in: async (_column: string, ids: string[]) => {
          deleted.push(ids)
          return { error: null }
        },
      }),
    }),
    storage: {
      from: () => ({
        list: async (prefix: string, opts: { search: string }) => ({
          data: objectsInStorage
            .filter((path) => path === `${prefix}/${opts.search}`)
            .map((path) => ({ name: path.slice(path.lastIndexOf('/') + 1) })),
        }),
      }),
    },
  }
  return { client: client as never, updated, deleted }
}

beforeEach(() => {
  enqueueEmbedJob.mockReset()
  processSourceInline.mockReset()
  processSourceInline.mockResolvedValue(undefined)
  afterCallbacks.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('publishUploadedAssets', () => {
  it('publishes an asset whose object is in storage and queues it for embedding', async () => {
    const { client, updated } = makeClient([LANDED])
    const result = await publishUploadedAssets(client, 'u1', ['asset-1'])

    expect(result).toEqual({
      ok: true,
      assets: [
        {
          id: 'asset-1',
          name: 'Shop front',
          slug: 'shop-front',
          storage_path: LANDED.storage_path,
          mime_type: 'image/png',
        },
      ],
      failed: [],
    })
    expect(updated).toEqual(['asset-1'])
    expect(enqueueEmbedJob).toHaveBeenCalledWith(expect.anything(), {
      kind: 'media_asset',
      sourceId: 'asset-1',
      userId: 'u1',
      sourceVersion: 3,
    })
  })

  it('embeds published assets after the response rather than inline', async () => {
    const { client } = makeClient([LANDED])
    await publishUploadedAssets(client, 'u1', ['asset-1'])

    expect(processSourceInline).not.toHaveBeenCalled()
    expect(afterCallbacks).toHaveLength(1)
    await afterCallbacks[0]()
    expect(processSourceInline).toHaveBeenCalledWith({ kind: 'media_asset', sourceId: 'asset-1' })
  })

  it('deletes rows whose bytes never arrived and keeps the ones that did', async () => {
    const { client, updated, deleted } = makeClient([LANDED, NEVER_ARRIVED, STILL_PENDING])
    const result = await publishUploadedAssets(client, 'u1', ['asset-1', 'asset-2', 'asset-3'])

    expect(result).toMatchObject({ ok: true, failed: ['asset-2', 'asset-3'] })
    expect(updated).toEqual(['asset-1'])
    expect(deleted).toEqual([['asset-2', 'asset-3']])
  })

  it('fails the request when nothing could be published', async () => {
    const { client, deleted } = makeClient([NEVER_ARRIVED], [])
    const result = await publishUploadedAssets(client, 'u1', ['asset-2'])

    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(deleted).toEqual([['asset-2']])
    expect(afterCallbacks).toHaveLength(0)
  })
})
