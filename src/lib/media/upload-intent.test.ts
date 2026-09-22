import { beforeEach, describe, expect, it, vi } from 'vitest'

const ensureDefaultFolder = vi.fn()
vi.mock('./default-folder', () => ({
  ensureDefaultFolder: (...args: unknown[]) => ensureDefaultFolder(...args),
}))

import { createUploadIntent } from './upload-intent'

const PNG = { name: 'shop front.png', type: 'image/png', size: 2048 }

interface Insert {
  user_id: string
  folder_id: string
  name: string
  slug: string
  description: string | null
  storage_path: string
  mime_type: string
  byte_size: number
  is_archived: boolean
}

interface ClientOptions {
  folderFound?: boolean
  signOk?: boolean
  insertOk?: boolean
}

function makeClient({ folderFound = true, signOk = true, insertOk = true }: ClientOptions = {}) {
  const inserts: Insert[] = []
  const deleted: string[] = []
  const updates: { id: string; storage_path: string }[] = []
  let nextId = 0

  const client = {
    from(table: string) {
      if (table === 'media_folders') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: folderFound ? { id: 'folder-1' } : null }),
              }),
            }),
          }),
        }
      }
      return {
        insert: (row: Insert) => {
          inserts.push(row)
          return {
            select: () => ({
              single: async () =>
                insertOk
                  ? { data: { id: `asset-${++nextId}` }, error: null }
                  : { data: null, error: { message: 'insert blew up' } },
            }),
          }
        },
        update: (patch: { storage_path: string }) => ({
          eq: async (_column: string, id: string) => {
            updates.push({ id, storage_path: patch.storage_path })
            return { error: null }
          },
        }),
        delete: () => ({
          eq: async (_column: string, id: string) => {
            deleted.push(id)
            return { error: null }
          },
        }),
      }
    },
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) =>
          signOk
            ? { data: { token: `tok-${path}`, signedUrl: `https://storage/${path}?token=tok`, path }, error: null }
            : { data: null, error: { message: 'no grant' } },
      }),
    },
  }
  return { client: client as never, inserts, deleted, updates }
}

beforeEach(() => {
  ensureDefaultFolder.mockReset()
  ensureDefaultFolder.mockResolvedValue('default-folder')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('createUploadIntent', () => {
  it('rejects a file the library does not accept without touching the database', async () => {
    const { client, inserts } = makeClient()
    const result = await createUploadIntent(client, 'u1', {
      folderId: 'folder-1',
      files: [{ name: 'contract.pdf', type: 'application/pdf', size: 1000 }],
    })

    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(inserts).toHaveLength(0)
  })

  it('registers a hidden row and returns a signed grant per file', async () => {
    const { client, inserts, updates } = makeClient()
    const result = await createUploadIntent(client, 'u1', {
      folderId: 'folder-1',
      description: '  storefront  ',
      files: [PNG],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.folderId).toBe('folder-1')
    expect(result.uploads).toHaveLength(1)
    expect(result.uploads[0]).toMatchObject({
      assetId: 'asset-1',
      contentType: 'image/png',
      path: 'u1/folder-1/asset-1-shop-front.png',
    })
    expect(result.uploads[0].signedUrl).toContain('token=')

    // Hidden until upload-complete says the bytes landed.
    expect(inserts[0]).toMatchObject({
      user_id: 'u1',
      folder_id: 'folder-1',
      mime_type: 'image/png',
      byte_size: 2048,
      storage_path: 'pending',
      is_archived: true,
      description: 'storefront',
    })
    expect(updates).toEqual([{ id: 'asset-1', storage_path: 'u1/folder-1/asset-1-shop-front.png' }])
  })

  it('falls back to the default folder when the client has no folder picker', async () => {
    const { client, inserts } = makeClient()
    const result = await createUploadIntent(client, 'u1', { files: [PNG] })

    expect(result).toMatchObject({ ok: true, folderId: 'default-folder' })
    expect(ensureDefaultFolder).toHaveBeenCalledOnce()
    expect(inserts[0].folder_id).toBe('default-folder')
  })

  it('404s on a folder the caller does not own', async () => {
    const { client, inserts } = makeClient({ folderFound: false })
    const result = await createUploadIntent(client, 'u1', { folderId: 'someone-elses', files: [PNG] })

    expect(result).toMatchObject({ ok: false, status: 404 })
    expect(inserts).toHaveLength(0)
  })

  it('deletes the row it just created when the grant cannot be signed', async () => {
    const { client, deleted } = makeClient({ signOk: false })
    const result = await createUploadIntent(client, 'u1', { folderId: 'folder-1', files: [PNG] })

    expect(result).toMatchObject({ ok: false, status: 500 })
    expect(deleted).toEqual(['asset-1'])
  })

  it('gives each file in one batch a distinct slug', async () => {
    const { client, inserts } = makeClient()
    const result = await createUploadIntent(client, 'u1', { folderId: 'folder-1', files: [PNG, PNG] })

    expect(result.ok).toBe(true)
    expect(inserts).toHaveLength(2)
    expect(inserts[0].slug).not.toBe(inserts[1].slug)
  })
})
