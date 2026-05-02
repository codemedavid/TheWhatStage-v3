import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteComment,
  fetchComment,
  hideComment,
  replyToComment,
  sendPrivateCommentReply,
} from './comments'

afterEach(() => {
  vi.restoreAllMocks()
})

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response)
}

describe('facebook comment helpers', () => {
  it('fetches a comment with moderation capability fields', async () => {
    const fetchMock = mockFetchOnce({
      id: 'c_1',
      message: 'How much?',
      from: { id: 'u_1', name: 'Ada' },
      parent: { id: 'post_1' },
      can_hide: true,
      can_remove: false,
      can_reply_privately: true,
      is_hidden: false,
      created_time: '2026-05-01T00:00:00+0000',
    })

    const comment = await fetchComment({ pageAccessToken: 'tok', commentId: 'c_1' })

    expect(comment).toMatchObject({
      id: 'c_1',
      message: 'How much?',
      commenterId: 'u_1',
      commenterName: 'Ada',
      canHide: true,
      canRemove: false,
      canReplyPrivately: true,
      isHidden: false,
    })
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.pathname).toBe('/v19.0/c_1')
    expect(url.searchParams.get('access_token')).toBe('tok')
    expect(url.searchParams.get('fields')).toContain('can_reply_privately')
  })

  it('posts a public comment reply', async () => {
    const fetchMock = mockFetchOnce({ id: 'reply_1' })
    await expect(
      replyToComment({ pageAccessToken: 'tok', commentId: 'c_1', message: 'Thanks' }),
    ).resolves.toEqual({ id: 'reply_1' })

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      message: 'Thanks',
    })
  })

  it('sends a private reply via /me/messages with comment_id recipient', async () => {
    const fetchMock = mockFetchOnce({ message_id: 'm_1', recipient_id: 'u_1' })
    await expect(
      sendPrivateCommentReply({
        pageAccessToken: 'tok',
        commentId: 'c_1',
        message: 'Sent you details.',
      }),
    ).resolves.toEqual({ id: 'm_1' })
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.pathname).toBe('/v19.0/me/messages')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.recipient).toEqual({ comment_id: 'c_1' })
    expect(body.messaging_type).toBe('RESPONSE')
  })

  it('hides a comment by updating is_hidden', async () => {
    const fetchMock = mockFetchOnce({ success: true })
    await expect(hideComment({ pageAccessToken: 'tok', commentId: 'c_1' })).resolves.toEqual({
      success: true,
    })
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      is_hidden: true,
    })
  })

  it('deletes a comment', async () => {
    const fetchMock = mockFetchOnce({ success: true })
    await expect(deleteComment({ pageAccessToken: 'tok', commentId: 'c_1' })).resolves.toEqual({
      success: true,
    })
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
  })

  it('throws a stable error on graph failure', async () => {
    mockFetchOnce({ error: { message: 'Permissions error', code: 200 } }, false, 403)
    await expect(fetchComment({ pageAccessToken: 'tok', commentId: 'c_1' })).rejects.toThrow(
      'Graph 403',
    )
  })
})
