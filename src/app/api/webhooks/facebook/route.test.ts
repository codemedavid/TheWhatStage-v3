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

function makeCommentAdminMock() {
  const commentUpsert = vi.fn<(payload: unknown, options: unknown) => unknown>(() => ({
    select: vi.fn(() => ({
      maybeSingle: vi.fn(async () => ({ data: { id: 'comment-job-1' }, error: null })),
    })),
  }))

  mocks.from.mockImplementation((table: string) => {
    if (table === 'facebook_pages') return pageLookup()
    if (table === 'facebook_comment_jobs') {
      return { upsert: commentUpsert }
    }
    throw new Error(`unexpected table ${table}`)
  })

  return { commentUpsert }
}

function makeMessengerAdminMock() {
  const messengerJobInsert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(async () => ({ data: { id: 'messenger-job-1' }, error: null })),
    })),
  }))

  mocks.from.mockImplementation((table: string) => {
    if (table === 'facebook_pages') return pageLookup()
    if (table === 'messenger_threads') {
      return {
        upsert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { id: 'thread-1', auto_reply_enabled: true, lead_id: null },
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
})
