import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  after: vi.fn((task: () => unknown) => {
    void task()
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mocks.from }),
}))

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return { ...actual, after: mocks.after }
})

function sign(raw: string) {
  return `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}`
}

function webhookRequest(payload: unknown) {
  const raw = JSON.stringify(payload)
  return new Request('https://app.test/api/webhooks/facebook', {
    method: 'POST',
    body: raw,
    headers: { 'x-hub-signature-256': sign(raw) },
  })
}

function pageLookup(data = { facebook_connections: { user_id: 'user-1' } }) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({
          data: {
            id: 'page-row',
            name: 'WhatStage',
            picture_url: null,
            page_access_token: 'encrypted',
            connection_id: 'connection-1',
            ...data,
          },
          error: null,
        })),
      })),
    })),
  }
}

function profilesLookup(status: 'active' | 'pending' | 'paused' = 'active') {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: { status }, error: null })),
      })),
    })),
  }
}

function makeCommentAdminMock(options: { ownerStatus?: 'active' | 'pending' | 'paused' } = {}) {
  const commentUpsert = vi.fn<(payload: unknown, options: unknown) => unknown>(() => ({
    select: vi.fn(() => ({
      maybeSingle: vi.fn(async () => ({ data: { id: 'comment-job-1' }, error: null })),
    })),
  }))

  mocks.from.mockImplementation((table: string) => {
    if (table === 'facebook_pages') return pageLookup()
    if (table === 'profiles') return profilesLookup(options.ownerStatus ?? 'active')
    if (table === 'facebook_comment_jobs') {
      return { upsert: commentUpsert }
    }
    throw new Error(`unexpected table ${table}`)
  })

  return { commentUpsert }
}

function makeMessengerAdminMock(
  options: {
    ownerStatus?: 'active' | 'pending' | 'paused'
    threadOverrides?: Record<string, unknown>
    autoClassifyEnabled?: boolean
  } = {},
) {
  const messengerJobInsert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(async () => ({ data: { id: 'messenger-job-1' }, error: null })),
    })),
  }))

  mocks.from.mockImplementation((table: string) => {
    if (table === 'facebook_pages') return pageLookup()
    if (table === 'profiles') return profilesLookup(options.ownerStatus ?? 'active')
    if (table === 'messenger_threads') {
      return {
        upsert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: {
                id: 'thread-1',
                auto_reply_enabled: true,
                bot_paused_until: null,
                lead_id: null,
                ...options.threadOverrides,
              },
              error: null,
            })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
        })),
      }
    }
    if (table === 'messenger_messages') {
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { id: 'message-1' }, error: null })),
          })),
        })),
      }
    }
    if (table === 'messenger_jobs') {
      return { insert: messengerJobInsert }
    }
    if (table === 'chatbot_configs') {
      const autoClassify = options.autoClassifyEnabled ?? false
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: autoClassify ? { auto_classify_enabled: true } : null,
              error: null,
            })),
          })),
        })),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })

  return { messengerJobInsert }
}

async function postWebhook(payload: unknown) {
  const { POST } = await import('./route')
  return POST(webhookRequest(payload) as Parameters<typeof POST>[0])
}

describe('facebook webhook comment events', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.FB_APP_SECRET = 'app-secret'
    process.env.FB_APP_ID = '424242424242'
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
    process.env.MESSENGER_WORKER_SECRET = 'messenger-secret'
    process.env.COMMENT_WORKER_SECRET = 'comment-secret'
    global.fetch = vi.fn(async () => new Response(null, { status: 204 }))
  })

  it('enqueues a Page feed comment add event and triggers only the comment worker', async () => {
    const { commentUpsert } = makeCommentAdminMock()

    const change = {
      field: 'feed',
      value: {
        item: 'comment',
        verb: 'add',
        comment_id: 'comment-1',
        parent_id: 'parent-1',
        post_id: 'post-1',
        message: 'Interested',
      },
    }
    const res = await postWebhook({
      object: 'page',
      entry: [{ id: 'fb-page-1', changes: [change] }],
    })

    await Promise.resolve()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ received: true })
    expect(mocks.from).toHaveBeenCalledWith('facebook_comment_jobs')
    expect(commentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        page_id: 'page-row',
        user_id: 'user-1',
        fb_comment_id: 'comment-1',
        fb_parent_id: 'parent-1',
        fb_post_id: 'post-1',
        webhook_event: change,
        status: 'queued',
        started_at: null,
        finished_at: null,
      }),
      { onConflict: 'fb_comment_id', ignoreDuplicates: true },
    )
    expect(commentUpsert.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ scheduled_at: expect.any(String) }),
    )
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledWith('https://app.test/api/comments/process', {
      method: 'POST',
      headers: { 'x-worker-secret': 'comment-secret' },
    })
  })

  it('requeues an edited Page feed comment event for an existing comment job', async () => {
    const { commentUpsert } = makeCommentAdminMock()

    const change = {
      field: 'feed',
      value: {
        item: 'comment',
        verb: 'edited',
        comment_id: 'comment-1',
        parent_id: 'parent-1',
        post_id: 'post-1',
        message: 'Updated interest',
      },
    }
    const res = await postWebhook({
      object: 'page',
      entry: [{ id: 'fb-page-1', changes: [change] }],
    })

    await Promise.resolve()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ received: true })
    expect(commentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        fb_comment_id: 'comment-1',
        webhook_event: change,
        status: 'queued',
        started_at: null,
        finished_at: null,
      }),
      { onConflict: 'fb_comment_id', ignoreDuplicates: false },
    )
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledWith('https://app.test/api/comments/process', {
      method: 'POST',
      headers: { 'x-worker-secret': 'comment-secret' },
    })
  })

  it("ignores the page's own comment replies to break the self-reply loop", async () => {
    // Wire a stricter mock: if the webhook tries to enqueue this comment we
    // want the test to fail loudly, not silently pass through.
    mocks.from.mockImplementation((table: string) => {
      if (table === 'facebook_comment_jobs') {
        throw new Error('should not enqueue own-page comment')
      }
      throw new Error(`unexpected table ${table}`)
    })

    const res = await postWebhook({
      object: 'page',
      entry: [
        {
          id: 'fb-page-1',
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: 'self-comment-1',
                parent_id: 'parent-1',
                post_id: 'post-1',
                from: { id: 'fb-page-1', name: 'WhatStage' },
                message: 'Bot reply to its own comment',
              },
            },
          ],
        },
      ],
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ received: true })
    expect(mocks.from).not.toHaveBeenCalledWith('facebook_comment_jobs')
    expect(mocks.after).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('ignores non-comment feed events', async () => {
    const res = await postWebhook({
      object: 'page',
      entry: [{ id: 'fb-page-1', changes: [{ field: 'feed', value: { item: 'post', verb: 'add' } }] }],
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ received: true })
    expect(mocks.from).not.toHaveBeenCalledWith('facebook_comment_jobs')
    expect(mocks.after).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('keeps Messenger webhook events on the Messenger worker only', async () => {
    const { messengerJobInsert } = makeMessengerAdminMock()

    const res = await postWebhook({
      object: 'page',
      entry: [
        {
          id: 'fb-page-1',
          messaging: [
            {
              sender: { id: 'psid-1' },
              recipient: { id: 'fb-page-1' },
              message: { mid: 'mid-1', text: 'Hello' },
            },
          ],
        },
      ],
    })

    await Promise.resolve()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ received: true })
    expect(messengerJobInsert).toHaveBeenCalledWith({
      thread_id: 'thread-1',
      inbound_msg_id: 'message-1',
      user_id: 'user-1',
    })
    expect(mocks.from).not.toHaveBeenCalledWith('facebook_comment_jobs')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledWith('https://app.test/api/messenger/process', {
      method: 'POST',
      headers: { 'x-worker-secret': 'messenger-secret' },
    })
  })

  it('skips messenger jobs when the page owner is paused', async () => {
    const { messengerJobInsert } = makeMessengerAdminMock({ ownerStatus: 'paused' })

    const res = await postWebhook({
      object: 'page',
      entry: [
        {
          id: 'fb-page-1',
          messaging: [
            {
              sender: { id: 'psid-1' },
              recipient: { id: 'fb-page-1' },
              message: { mid: 'mid-paused', text: 'Hello' },
            },
          ],
        },
      ],
    })

    await Promise.resolve()

    expect(res.status).toBe(200)
    expect(messengerJobInsert).not.toHaveBeenCalled()
    // No worker fetch fired because nothing was enqueued.
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('skips comment jobs when the page owner is paused', async () => {
    const { commentUpsert } = makeCommentAdminMock({ ownerStatus: 'paused' })

    const res = await postWebhook({
      object: 'page',
      entry: [
        {
          id: 'fb-page-1',
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: 'comment-paused',
                parent_id: 'parent-1',
                post_id: 'post-1',
                message: 'Interested',
              },
            },
          ],
        },
      ],
    })

    await Promise.resolve()

    expect(res.status).toBe(200)
    expect(commentUpsert).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('takes classify-only fallback when bot_paused_until is in the future', async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour from now
    const { messengerJobInsert } = makeMessengerAdminMock({
      threadOverrides: { auto_reply_enabled: true, bot_paused_until: futureDate },
      autoClassifyEnabled: false,
    })

    const res = await postWebhook({
      object: 'page',
      entry: [
        {
          id: 'fb-page-1',
          messaging: [
            {
              sender: { id: 'psid-1' },
              recipient: { id: 'fb-page-1' },
              message: { mid: 'mid-paused-bot', text: 'Hello during takeover' },
            },
          ],
        },
      ],
    })

    await Promise.resolve()

    expect(res.status).toBe(200)
    expect(messengerJobInsert).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('drops echoes of our own sends (app_id matches FB_APP_ID) without engaging takeover', async () => {
    // Wire a strict mock: any DB touch from the echo path fails the test.
    mocks.from.mockImplementation((table: string) => {
      throw new Error(`should not touch ${table} for our own echo`)
    })

    const res = await postWebhook({
      object: 'page',
      entry: [
        {
          id: 'fb-page-1',
          messaging: [
            {
              sender: { id: 'fb-page-1' },
              recipient: { id: 'psid-1' },
              message: {
                mid: 'mid-our-bot-echo',
                text: 'Bot reply',
                is_echo: true,
                app_id: 424242424242,
              },
            },
          ],
        },
      ],
    })

    expect(res.status).toBe(200)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('engages human takeover on echoes from a foreign app_id (Business Suite / other tools)', async () => {
    const threadUpdatePatches: Record<string, unknown>[] = []

    mocks.from.mockImplementation((table: string) => {
      if (table === 'facebook_pages') return pageLookup()
      if (table === 'profiles') return profilesLookup('active')
      if (table === 'messenger_threads') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { id: 'thread-1', controlled_by_run_id: null },
                  error: null,
                })),
              })),
            })),
          })),
          update: vi.fn((patch: Record<string, unknown>) => {
            threadUpdatePatches.push(patch)
            return { eq: vi.fn(async () => ({ error: null })) }
          }),
        }
      }
      if (table === 'messenger_messages') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: { id: 'message-op-3' }, error: null })),
            })),
          })),
        }
      }
      if (table === 'chatbot_configs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { human_takeover_minutes: 60 },
                error: null,
              })),
            })),
          })),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })

    const res = await postWebhook({
      object: 'page',
      entry: [
        {
          id: 'fb-page-1',
          messaging: [
            {
              sender: { id: 'fb-page-1' },
              recipient: { id: 'psid-1' },
              message: {
                mid: 'mid-business-suite',
                text: 'Operator reply via Business Suite',
                is_echo: true,
                // Meta first-party app id — NOT ours.
                app_id: 263902037430900,
              },
            },
          ],
        },
      ],
    })

    expect(res.status).toBe(200)
    expect(threadUpdatePatches.some((p) => 'bot_paused_until' in p)).toBe(true)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('engages human takeover on echoes without app_id (Meta UI replies)', async () => {
    const threadUpdateSpy = vi.fn(async () => ({ error: null }))
    const messageInsertSpy = vi.fn<(row: Record<string, unknown>) => void>()
    const threadUpdatePatches: Record<string, unknown>[] = []

    mocks.from.mockImplementation((table: string) => {
      if (table === 'facebook_pages') return pageLookup()
      if (table === 'profiles') return profilesLookup('active')
      if (table === 'messenger_threads') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { id: 'thread-1', controlled_by_run_id: null },
                  error: null,
                })),
              })),
            })),
          })),
          update: vi.fn((patch: Record<string, unknown>) => {
            threadUpdatePatches.push(patch)
            return { eq: threadUpdateSpy }
          }),
        }
      }
      if (table === 'messenger_messages') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            messageInsertSpy(row)
            return {
              select: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: { id: 'message-op-1' }, error: null })),
              })),
            }
          }),
        }
      }
      if (table === 'chatbot_configs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { human_takeover_minutes: 90 },
                error: null,
              })),
            })),
          })),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })

    const t0 = Date.now()
    const res = await postWebhook({
      object: 'page',
      entry: [
        {
          id: 'fb-page-1',
          messaging: [
            {
              sender: { id: 'fb-page-1' },
              recipient: { id: 'psid-1' },
              message: {
                mid: 'mid-meta-ui',
                text: 'Hey, this is the operator',
                is_echo: true,
              },
            },
          ],
        },
      ],
    })
    const t1 = Date.now()

    expect(res.status).toBe(200)
    expect(messageInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        thread_id: 'thread-1',
        user_id: 'user-1',
        direction: 'outbound',
        sender: 'operator',
        fb_message_id: 'mid-meta-ui',
        body: 'Hey, this is the operator',
      }),
    )
    const pausePatch = threadUpdatePatches.find((p) => 'bot_paused_until' in p)
    expect(pausePatch).toBeDefined()
    const pausedAt = Date.parse(pausePatch?.bot_paused_until as string)
    expect(pausedAt).toBeGreaterThanOrEqual(t0 + 90 * 60_000 - 50)
    expect(pausedAt).toBeLessThanOrEqual(t1 + 90 * 60_000 + 50)
    expect(pausePatch?.last_message_preview).toBe('Hey, this is the operator')
    // No messenger worker fetch — echoes never feed the reply worker.
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('records the operator echo but skips bot_paused_until when takeover is disabled (0 minutes)', async () => {
    const threadUpdatePatches: Record<string, unknown>[] = []

    mocks.from.mockImplementation((table: string) => {
      if (table === 'facebook_pages') return pageLookup()
      if (table === 'profiles') return profilesLookup('active')
      if (table === 'messenger_threads') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { id: 'thread-1', controlled_by_run_id: null },
                  error: null,
                })),
              })),
            })),
          })),
          update: vi.fn((patch: Record<string, unknown>) => {
            threadUpdatePatches.push(patch)
            return { eq: vi.fn(async () => ({ error: null })) }
          }),
        }
      }
      if (table === 'messenger_messages') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: { id: 'message-op-2' }, error: null })),
            })),
          })),
        }
      }
      if (table === 'chatbot_configs') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { human_takeover_minutes: 0 },
                error: null,
              })),
            })),
          })),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })

    const res = await postWebhook({
      object: 'page',
      entry: [
        {
          id: 'fb-page-1',
          messaging: [
            {
              sender: { id: 'fb-page-1' },
              recipient: { id: 'psid-1' },
              message: { mid: 'mid-no-pause', text: 'ok', is_echo: true },
            },
          ],
        },
      ],
    })

    expect(res.status).toBe(200)
    expect(threadUpdatePatches.some((p) => 'bot_paused_until' in p)).toBe(false)
    // Tail still bumped so the dashboard timeline reflects the reply.
    expect(threadUpdatePatches.some((p) => 'last_message_at' in p)).toBe(true)
  })

  it('skips operator echo when no matching thread exists', async () => {
    const messageInsertSpy = vi.fn()

    mocks.from.mockImplementation((table: string) => {
      if (table === 'facebook_pages') return pageLookup()
      if (table === 'profiles') return profilesLookup('active')
      if (table === 'messenger_threads') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: null, error: null })),
              })),
            })),
          })),
        }
      }
      if (table === 'messenger_messages') {
        return { insert: messageInsertSpy }
      }
      throw new Error(`unexpected table ${table}`)
    })

    const res = await postWebhook({
      object: 'page',
      entry: [
        {
          id: 'fb-page-1',
          messaging: [
            {
              sender: { id: 'fb-page-1' },
              recipient: { id: 'psid-new' },
              message: { mid: 'mid-new-thread', text: 'first contact', is_echo: true },
            },
          ],
        },
      ],
    })

    expect(res.status).toBe(200)
    expect(messageInsertSpy).not.toHaveBeenCalled()
  })

  it('enqueues normally when bot_paused_until is in the past', async () => {
    const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1 hour ago
    const { messengerJobInsert } = makeMessengerAdminMock({
      threadOverrides: { auto_reply_enabled: true, bot_paused_until: pastDate },
    })

    const res = await postWebhook({
      object: 'page',
      entry: [
        {
          id: 'fb-page-1',
          messaging: [
            {
              sender: { id: 'psid-1' },
              recipient: { id: 'fb-page-1' },
              message: { mid: 'mid-expired-pause', text: 'Hello after takeover ended' },
            },
          ],
        },
      ],
    })

    await Promise.resolve()

    expect(res.status).toBe(200)
    expect(messengerJobInsert).toHaveBeenCalledWith({
      thread_id: 'thread-1',
      inbound_msg_id: 'message-1',
      user_id: 'user-1',
    })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledWith('https://app.test/api/messenger/process', {
      method: 'POST',
      headers: { 'x-worker-secret': 'messenger-secret' },
    })
  })
})
