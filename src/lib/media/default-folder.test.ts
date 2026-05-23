import { describe, expect, it } from 'vitest'
import { ensureDefaultFolder } from './default-folder'

function makeClient(opts: {
  existing?: { id: string } | null
  insertResult?: { id: string } | { error: string }
}) {
  let insertCalled = false
  const client = {
    from(table: string) {
      if (table !== 'media_folders') throw new Error(`unexpected table: ${table}`)
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.order = () => chain
      chain.limit = () => chain
      chain.maybeSingle = async () => ({ data: opts.existing ?? null, error: null })
      chain.insert = () => ({
        select: () => ({
          single: async () => {
            insertCalled = true
            if ('error' in (opts.insertResult ?? {})) {
              return { data: null, error: new Error((opts.insertResult as { error: string }).error) }
            }
            return { data: opts.insertResult ?? { id: 'created-1' }, error: null }
          },
        }),
      })
      return chain
    },
  }
  return { client, wasInserted: () => insertCalled }
}

describe('ensureDefaultFolder', () => {
  it('returns the first existing folder without inserting', async () => {
    const { client, wasInserted } = makeClient({ existing: { id: 'existing-1' } })
    const id = await ensureDefaultFolder(client as never, 'u1')
    expect(id).toBe('existing-1')
    expect(wasInserted()).toBe(false)
  })

  it('inserts a new "Auto Follow-Up" folder when the user has none', async () => {
    const { client, wasInserted } = makeClient({ existing: null, insertResult: { id: 'fresh-1' } })
    const id = await ensureDefaultFolder(client as never, 'u1')
    expect(id).toBe('fresh-1')
    expect(wasInserted()).toBe(true)
  })

  it('throws when the insert fails', async () => {
    const { client } = makeClient({ existing: null, insertResult: { error: 'unique violation' } })
    await expect(ensureDefaultFolder(client as never, 'u1')).rejects.toThrow(/Failed to create default folder/)
  })
})
