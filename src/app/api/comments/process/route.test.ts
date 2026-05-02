import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  adminClient: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
  decryptToken: vi.fn(),
  fetchComment: vi.fn(),
  deleteComment: vi.fn(),
  hideComment: vi.fn(),
  replyToComment: vi.fn(),
  sendPrivateCommentReply: vi.fn(),
  classifyComment: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mocks.adminClient,
}))

vi.mock('@/lib/facebook/crypto', () => ({
  decryptToken: mocks.decryptToken,
}))

vi.mock('@/lib/facebook/comments', () => ({
  fetchComment: mocks.fetchComment,
  deleteComment: mocks.deleteComment,
  hideComment: mocks.hideComment,
  replyToComment: mocks.replyToComment,
  sendPrivateCommentReply: mocks.sendPrivateCommentReply,
}))

vi.mock('@/lib/comments/classify', () => ({
  classifyComment: mocks.classifyComment,
}))

function workerRequest(secret = 'comment-secret') {
  return new Request('https://app.test/api/comments/process', {
    method: 'POST',
    headers: { 'x-worker-secret': secret },
  })
}

describe('comment worker decisions', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('deletes high-confidence spam when removable', async () => {
    const { chooseGraphAction } = await import('./route')

    expect(
      chooseGraphAction({
        decision: {
          category: 'spam',
          confidence: 'high',
          moderationAction: 'delete',
          publicReply: null,
          privateReply: null,
          reason: 'Scam',
        },
        comment: { canRemove: true, canHide: true, canReplyPrivately: false },
      }),
    ).toBe('delete')
  })

  it('hides when delete requested but remove unavailable', async () => {
    const { chooseGraphAction } = await import('./route')

    expect(
      chooseGraphAction({
        decision: {
          category: 'abusive',
          confidence: 'high',
          moderationAction: 'delete',
          publicReply: null,
          privateReply: null,
          reason: 'Attack',
        },
        comment: { canRemove: false, canHide: true, canReplyPrivately: false },
      }),
    ).toBe('hide')
  })

  it('does nothing destructive for low confidence', async () => {
    const { chooseGraphAction } = await import('./route')

    expect(
      chooseGraphAction({
        decision: {
          category: 'spam',
          confidence: 'low',
          moderationAction: 'delete',
          publicReply: null,
          privateReply: null,
          reason: 'Unclear',
        },
        comment: { canRemove: true, canHide: true, canReplyPrivately: false },
      }),
    ).toBe('none')
  })

  it('falls back from private reply to public reply only when public copy exists', async () => {
    const { chooseGraphAction } = await import('./route')
    const decision = {
      category: 'question' as const,
      confidence: 'high' as const,
      moderationAction: 'private_reply' as const,
      publicReply: 'We can help with that.',
      privateReply: 'Please send us your details.',
      reason: 'Question',
    }

    expect(
      chooseGraphAction({
        decision,
        comment: { canRemove: false, canHide: false, canReplyPrivately: false },
      }),
    ).toBe('public_reply')
    expect(
      chooseGraphAction({
        decision: { ...decision, publicReply: null },
        comment: { canRemove: false, canHide: false, canReplyPrivately: false },
      }),
    ).toBe('none')
  })

  it('persists lead-linked comments and private-reply bridge cases, but not random comments', async () => {
    const { shouldPersistComment } = await import('./route')

    expect(
      shouldPersistComment({
        leadId: 'lead-1',
        attemptedPrivateReply: false,
        failedAction: false,
      }),
    ).toBe(true)
    expect(
      shouldPersistComment({
        leadId: null,
        attemptedPrivateReply: true,
        failedAction: false,
      }),
    ).toBe(true)
    expect(
      shouldPersistComment({
        leadId: null,
        attemptedPrivateReply: false,
        failedAction: true,
      }),
    ).toBe(true)
    expect(
      shouldPersistComment({
        leadId: null,
        attemptedPrivateReply: false,
        failedAction: false,
      }),
    ).toBe(false)
  })
})

describe('POST /api/comments/process', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.COMMENT_WORKER_SECRET = 'comment-secret'
  })

  it('rejects missing worker config', async () => {
    delete process.env.COMMENT_WORKER_SECRET
    const { POST } = await import('./route')

    const res = await POST(workerRequest() as Parameters<typeof POST>[0])

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'worker not configured' })
    expect(mocks.adminClient.rpc).not.toHaveBeenCalled()
  })

  it('rejects wrong worker secret', async () => {
    const { POST } = await import('./route')

    const res = await POST(workerRequest('wrong-secret') as Parameters<typeof POST>[0])

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' })
    expect(mocks.adminClient.rpc).not.toHaveBeenCalled()
  })

  it('claims comment jobs with worker limits', async () => {
    mocks.adminClient.rpc.mockResolvedValue({ data: [], error: null })
    const { POST } = await import('./route')

    const res = await POST(workerRequest() as Parameters<typeof POST>[0])

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ processed: 0 })
    expect(mocks.adminClient.rpc).toHaveBeenCalledWith('claim_facebook_comment_jobs', {
      p_limit: 5,
      p_stale_seconds: 300,
    })
  })
})
