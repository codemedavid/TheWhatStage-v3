import { describe, expect, it } from 'vitest'
import { handlePostback } from './_postback'

const FB_PAGE_ID = 'fb-page-1'
const PSID = 'PSID-1'
const USER_ID = '00000000-0000-4000-8000-000000000001'
const PAGE_ID = 'page-row-1'
const PROP_ID = 'item-1'
const PROP_SLUG = 'property_abc-123'
const PROP_TITLE = 'Sunny 3BR House'

interface DbState {
  page: { id: string; user_id: string } | null
  property: { id: string; title: string } | null
  thread: { id: string } | null
  insertConflict: boolean
}

function makeAdmin(state: DbState) {
  const calls: { table: string; op: string; payload: unknown }[] = []

  function from(table: string) {
    // Build a chainable eq object that resolves to the right maybeSingle/single
    function makeEqChain(depth: number): Record<string, unknown> {
      const chain: Record<string, unknown> = {
        eq: () => makeEqChain(depth + 1),
        maybeSingle: async () => {
          if (table === 'facebook_pages')
            return {
              data: state.page
                ? { id: state.page.id, facebook_connections: { user_id: state.page.user_id } }
                : null,
              error: null,
            }
          if (table === 'business_items')
            return state.property
              ? { data: state.property, error: null }
              : { data: null, error: null }
          return { data: null, error: null }
        },
        single: async () => ({ data: state.thread, error: null }),
      }
      return chain
    }

    return {
      select: () => makeEqChain(0),
      upsert: () => ({
        select: () => ({
          single: async () => ({ data: state.thread, error: null }),
        }),
      }),
      insert: (payload: unknown) => {
        calls.push({ table, op: 'insert', payload })
        return {
          select: () => ({
            maybeSingle: async () =>
              state.insertConflict
                ? { data: null, error: { code: '23505' } }
                : { data: { id: 'inserted-msg' }, error: null },
            single: async () => ({ data: { id: 'job-1' }, error: null }),
          }),
        }
      },
      update: (payload: unknown) => ({
        eq: () => {
          calls.push({ table, op: 'update', payload })
          return Promise.resolve({ data: null, error: null })
        },
      }),
    }
  }

  return { from, calls }
}

const baseState: DbState = {
  page: { id: PAGE_ID, user_id: USER_ID },
  property: { id: PROP_ID, title: PROP_TITLE },
  thread: { id: 'thread-1' },
  insertConflict: false,
}

describe('handlePostback', () => {
  it('returns null for malformed payloads', async () => {
    const admin = makeAdmin(baseState)
    const r = await handlePostback(
      admin as unknown as Parameters<typeof handlePostback>[0],
      FB_PAGE_ID,
      { sender: { id: PSID }, postback: { payload: 'not-a-known-prefix' }, timestamp: 1 } as never,
    )
    expect(r).toBeNull()
  })

  it('returns null when property slug is unknown', async () => {
    const admin = makeAdmin({ ...baseState, property: null })
    const r = await handlePostback(
      admin as unknown as Parameters<typeof handlePostback>[0],
      FB_PAGE_ID,
      { sender: { id: PSID }, postback: { payload: `rec_inquire:${PROP_SLUG}` }, timestamp: 1 } as never,
    )
    expect(r).toBeNull()
  })

  it('persists synthetic inbound message and returns a job id on success', async () => {
    const admin = makeAdmin(baseState)
    const r = await handlePostback(
      admin as unknown as Parameters<typeof handlePostback>[0],
      FB_PAGE_ID,
      { sender: { id: PSID }, postback: { payload: `rec_inquire:${PROP_SLUG}` }, timestamp: 1700000000 } as never,
    )
    expect(r).toBe('job-1')
    const insert = admin.calls.find((c) => c.table === 'messenger_messages' && c.op === 'insert')
    expect(insert).toBeTruthy()
    expect((insert!.payload as { body: string }).body).toContain(PROP_TITLE)
    expect((insert!.payload as { fb_message_id: string }).fb_message_id).toMatch(/^pb:/)
    expect((insert!.payload as { attachments: { kind: string } }).attachments.kind).toBe(
      'inquire_postback',
    )
  })

  it('returns null on dedup conflict (Meta retry)', async () => {
    const admin = makeAdmin({ ...baseState, insertConflict: true })
    const r = await handlePostback(
      admin as unknown as Parameters<typeof handlePostback>[0],
      FB_PAGE_ID,
      { sender: { id: PSID }, postback: { payload: `rec_inquire:${PROP_SLUG}` }, timestamp: 1700000000 } as never,
    )
    expect(r).toBeNull()
  })
})
