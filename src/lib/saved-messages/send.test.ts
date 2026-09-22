import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { OperatorSendSpec, OperatorThread } from '@/lib/messenger/operator-send'
import { sendSavedMessageFor } from './send'
import type { SavedButton, SavedCard } from './template'

const dispatch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/messenger/operator-send', () => ({ dispatchOperatorSendFor: dispatch }))

const USER = 'user-1'
const LEAD = 'lead-1'
const THREAD: OperatorThread = { id: 'thread-1', psid: 'PSID-9', page_id: 'page-row-1' }

interface Rows {
  saved: Record<string, unknown> | null
  pages: Array<{ id: string; slug: string; signing_secret: string }>
  assets: Array<{ id: string; storage_path: string }>
  lead: { name: string | null } | null
}

/**
 * The narrow slice of PostgREST these functions use: one maybeSingle() row per
 * table, and one `.in()` list for the batch lookups.
 */
function makeClient(rows: Rows) {
  const client = {
    from(table: string) {
      const result = () => {
        if (table === 'action_pages') return { data: rows.pages, error: null }
        if (table === 'media_assets') return { data: rows.assets, error: null }
        return { data: null, error: null }
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => Promise.resolve(result()),
        maybeSingle: async () => {
          if (table === 'saved_messages') return { data: rows.saved, error: null }
          if (table === 'leads') return { data: rows.lead, error: null }
          return { data: null, error: null }
        },
      }
      return chain
    },
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((path) => ({ path, signedUrl: `https://signed.test/${path}?token=t` })),
          error: null,
        }),
      }),
    },
  }
  return client as unknown as SupabaseClient
}

/** Run the send and return the spec the dispatcher was asked to deliver. */
async function specFor(rows: Rows): Promise<OperatorSendSpec> {
  let spec: OperatorSendSpec | null = null
  dispatch.mockImplementation(async (args: { build: (t: OperatorThread) => Promise<OperatorSendSpec> }) => {
    spec = await args.build(THREAD)
    return { ok: true }
  })
  await sendSavedMessageFor(makeClient(rows), USER, LEAD, 'saved-1')
  if (!spec) throw new Error('build was never called')
  return spec
}

const base: Rows = { saved: null, pages: [], assets: [], lead: { name: 'Juan Dela Cruz' } }

const link: SavedButton = { type: 'url', label: 'See pricing', url: 'https://acme.test/pricing' }

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
})

beforeEach(() => {
  dispatch.mockReset()
})

describe('sendSavedMessageFor', () => {
  test('sends a plain saved message as text', async () => {
    const spec = await specFor({
      ...base,
      saved: { id: 'saved-1', title: 'Hi', body: 'Hello there', layout: 'text', buttons: [], cards: [] },
    })
    expect(spec.payload).toEqual({ kind: 'text', text: 'Hello there' })
    expect(spec.attachments).toBeUndefined()
  })

  test('renders merge tags against the lead', async () => {
    const spec = await specFor({
      ...base,
      saved: { id: 'saved-1', title: 'Hi', body: 'Hi [first_name]!', layout: 'text', buttons: [], cards: [] },
    })
    expect(spec.body).toBe('Hi Juan!')
  })

  test('a lead with no name still gets a readable greeting', async () => {
    const spec = await specFor({
      ...base,
      lead: { name: null },
      saved: { id: 'saved-1', title: 'Hi', body: 'Hi [first_name]!', layout: 'text', buttons: [], cards: [] },
    })
    expect(spec.body).toBe('Hi there!')
  })

  test('sends a button layout as a button template and records its labels', async () => {
    const spec = await specFor({
      ...base,
      saved: { id: 'saved-1', title: 'Hi', body: 'Pick one', layout: 'buttons', buttons: [link], cards: [] },
    })
    expect(spec.payload).toMatchObject({ kind: 'buttons', text: 'Pick one' })
    expect(spec.attachments).toEqual([{ type: 'buttons', buttons: [{ label: 'See pricing', url: link.url }] }])
  })

  test('signs an action-page button for this recipient', async () => {
    const button: SavedButton = { type: 'action_page', label: 'Book', action_page_id: 'page-uuid' }
    const spec = await specFor({
      ...base,
      pages: [{ id: 'page-uuid', slug: 'book-a-call', signing_secret: 'secret' }],
      saved: { id: 'saved-1', title: 'Hi', body: 'Book in', layout: 'buttons', buttons: [button], cards: [] },
    })
    const url = (spec.payload as { buttons: Array<{ url: string }> }).buttons[0].url
    expect(url).toContain('https://app.test/a/book-a-call?')
    expect(url).toContain(THREAD.psid)
  })

  test('an unpublished action page drops its button instead of failing the send', async () => {
    const button: SavedButton = { type: 'action_page', label: 'Book', action_page_id: 'page-uuid' }
    const spec = await specFor({
      ...base,
      pages: [],
      saved: { id: 'saved-1', title: 'Hi', body: 'Book in', layout: 'buttons', buttons: [button], cards: [] },
    })
    expect(spec.payload).toEqual({ kind: 'text', text: 'Book in' })
  })

  test('signs a card image from the media library at send time', async () => {
    const card: SavedCard = { title: 'Studio unit', image_asset_id: 'asset-uuid', buttons: [link] }
    const spec = await specFor({
      ...base,
      assets: [{ id: 'asset-uuid', storage_path: 'user-1/studio.png' }],
      saved: { id: 'saved-1', title: 'Units', body: '', layout: 'card', buttons: [], cards: [card] },
    })
    const elements = (spec.payload as { elements: Array<{ imageUrl?: string }> }).elements
    expect(elements[0].imageUrl).toBe('https://signed.test/user-1/studio.png?token=t')
    expect(spec.body).toBe('Studio unit')
    expect(spec.attachments?.[0].type).toBe('card')
  })

  test('a carousel sends every card and previews the count', async () => {
    const cards: SavedCard[] = [
      { title: 'Studio unit', buttons: [] },
      { title: 'One bedroom', buttons: [] },
    ]
    const spec = await specFor({
      ...base,
      saved: { id: 'saved-1', title: 'Units', body: '', layout: 'carousel', buttons: [], cards },
    })
    expect((spec.payload as { elements: unknown[] }).elements).toHaveLength(2)
    expect(spec.body).toBe('Studio unit (+1 more)')
  })

  test('the composer edit replaces the stored body on a text layout', async () => {
    dispatch.mockImplementation(async (args: { build: (t: OperatorThread) => Promise<OperatorSendSpec> }) => {
      const spec = await args.build(THREAD)
      expect(spec.body).toBe('A one-off reply')
      return { ok: true }
    })
    const rows: Rows = {
      ...base,
      saved: { id: 'saved-1', title: 'Hi', body: 'Stored body', layout: 'text', buttons: [], cards: [] },
    }
    await sendSavedMessageFor(makeClient(rows), USER, LEAD, 'saved-1', 'A one-off reply')
    expect(dispatch).toHaveBeenCalledOnce()
  })

  test('throws when the saved message does not belong to the caller', async () => {
    await expect(sendSavedMessageFor(makeClient(base), USER, LEAD, 'saved-1')).rejects.toThrow(/not found/)
  })
})
