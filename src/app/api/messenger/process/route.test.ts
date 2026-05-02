import { describe, expect, it, vi } from 'vitest'

process.env.FB_TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64')
process.env.MESSENGER_WORKER_SECRET ??= 'test-secret'

const { resolveCommentBridgesForThread } = await import('./route')

describe('resolveCommentBridgesForThread', () => {
  it('links unresolved same-page bridge rows to an existing lead', async () => {
    const updates: unknown[] = []
    const admin = {
      from: vi.fn((table: string) => {
        if (table === 'facebook_comment_bridges') {
          return {
            update: (payload: unknown) => {
              updates.push(payload)
              return {
                eq: () => ({
                  eq: () => ({
                    is: () => ({ gt: async () => ({ error: null }) }),
                  }),
                }),
              }
            },
          }
        }
        throw new Error(table)
      }),
    }

    await resolveCommentBridgesForThread(admin as never, {
      pageId: 'page-1',
      psid: 'psid-1',
      leadId: 'lead-1',
    })

    expect(updates).toEqual([{ lead_id: 'lead-1', resolved_at: expect.any(String) }])
  })

  it('does nothing when leadId is null', async () => {
    const admin = { from: vi.fn() }
    await resolveCommentBridgesForThread(admin as never, {
      pageId: 'page-1',
      psid: 'psid-1',
      leadId: null,
    })
    expect(admin.from).not.toHaveBeenCalled()
  })
})
