const GRAPH = 'https://graph.facebook.com/v19.0'

export interface FacebookComment {
  id: string
  message: string
  commenterId: string | null
  commenterName: string | null
  parentId: string | null
  canHide: boolean
  canRemove: boolean
  canReplyPrivately: boolean
  isHidden: boolean
  createdTime: string | null
}

interface GraphComment {
  id?: string
  message?: string
  from?: { id?: string; name?: string }
  parent?: { id?: string }
  can_hide?: boolean
  can_remove?: boolean
  can_reply_privately?: boolean
  is_hidden?: boolean
  created_time?: string
}

async function graphJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const text = await res.text()
  const parsed = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const msg =
      typeof parsed?.error?.message === 'string'
        ? parsed.error.message
        : typeof parsed?.message === 'string'
          ? parsed.message
          : text
    throw new Error(`Graph ${res.status}: ${msg}`)
  }
  return parsed as T
}

export async function fetchComment(args: {
  pageAccessToken: string
  commentId: string
}): Promise<FacebookComment> {
  const url = new URL(`${GRAPH}/${encodeURIComponent(args.commentId)}`)
  url.searchParams.set(
    'fields',
    'id,message,from,parent,can_hide,can_remove,can_reply_privately,is_hidden,created_time',
  )
  url.searchParams.set('access_token', args.pageAccessToken)
  const c = await graphJson<GraphComment>(url.toString())
  return {
    id: c.id ?? args.commentId,
    message: c.message ?? '',
    commenterId: c.from?.id ?? null,
    commenterName: c.from?.name ?? null,
    parentId: c.parent?.id ?? null,
    canHide: c.can_hide === true,
    canRemove: c.can_remove === true,
    canReplyPrivately: c.can_reply_privately === true,
    isHidden: c.is_hidden === true,
    createdTime: c.created_time ?? null,
  }
}

export async function replyToComment(args: {
  pageAccessToken: string
  commentId: string
  message: string
}): Promise<{ id: string }> {
  const url = new URL(`${GRAPH}/${encodeURIComponent(args.commentId)}/comments`)
  url.searchParams.set('access_token', args.pageAccessToken)
  return graphJson<{ id: string }>(url.toString(), {
    method: 'POST',
    body: JSON.stringify({ message: args.message }),
  })
}

export async function sendPrivateCommentReply(args: {
  pageAccessToken: string
  commentId: string
  message: string
}): Promise<{ id: string }> {
  // Use /me/messages with comment_id as recipient — works for any commenter,
  // even first-time. The older /{comment-id}/private_replies endpoint fails
  // unless the user has previously messaged the page.
  const url = new URL(`${GRAPH}/me/messages`)
  url.searchParams.set('access_token', args.pageAccessToken)
  const res = await graphJson<{ message_id: string; recipient_id: string }>(url.toString(), {
    method: 'POST',
    body: JSON.stringify({
      recipient: { comment_id: args.commentId },
      message: { text: args.message },
      messaging_type: 'RESPONSE',
    }),
  })
  return { id: res.message_id }
}

export async function hideComment(args: {
  pageAccessToken: string
  commentId: string
}): Promise<{ success: boolean }> {
  const url = new URL(`${GRAPH}/${encodeURIComponent(args.commentId)}`)
  url.searchParams.set('access_token', args.pageAccessToken)
  return graphJson<{ success: boolean }>(url.toString(), {
    method: 'POST',
    body: JSON.stringify({ is_hidden: true }),
  })
}

export async function deleteComment(args: {
  pageAccessToken: string
  commentId: string
}): Promise<{ success: boolean }> {
  const url = new URL(`${GRAPH}/${encodeURIComponent(args.commentId)}`)
  url.searchParams.set('access_token', args.pageAccessToken)
  return graphJson<{ success: boolean }>(url.toString(), { method: 'DELETE' })
}
