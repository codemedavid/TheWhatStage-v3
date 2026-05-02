'use client'
import { useEffect, useState } from 'react'
import { loadLeadComments, type ConversationComment } from '../actions/messenger'

const CLASSIFICATION_COLORS: Record<ConversationComment['classification'], string> = {
  good: '#22c55e',
  question: '#3b82f6',
  spam: '#f97316',
  abusive: '#ef4444',
  needs_no_action: 'var(--lead-faint)',
}

const ACTION_LABELS: Record<ConversationComment['moderation_action'], string> = {
  none: 'No action',
  public_reply: 'Replied publicly',
  private_reply: 'Private reply sent',
  hide: 'Hidden',
  delete: 'Deleted',
}

const STATUS_LABELS: Record<ConversationComment['graph_status'], string> = {
  pending: 'Pending',
  sent: 'Sent',
  hidden: 'Hidden',
  deleted: 'Deleted',
  failed: 'Failed',
  skipped: 'Skipped',
}

export function CommentsPanel({ leadId }: { leadId: string }) {
  const [comments, setComments] = useState<ConversationComment[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setComments(null)
    setError(null)
    loadLeadComments(leadId)
      .then(setComments)
      .catch((e) => setError(e.message ?? 'Failed to load comments'))
  }, [leadId])

  if (error) {
    return (
      <div
        className="rounded-lg px-3 py-3 text-[12.5px]"
        style={{
          background: 'var(--lead-danger-soft)',
          border: '1px solid var(--lead-danger)',
          color: 'var(--lead-danger)',
        }}
      >
        {error}
      </div>
    )
  }

  if (comments === null) {
    return (
      <div className="py-6 text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
        Loading comments…
      </div>
    )
  }

  if (comments.length === 0) {
    return (
      <div
        className="rounded-lg px-3 py-6 text-center text-[12.5px]"
        style={{
          background: 'var(--lead-surface)',
          border: '1px dashed var(--lead-line)',
          color: 'var(--lead-muted)',
        }}
      >
        No Facebook comments linked to this lead yet.
        <div className="mt-1 text-[11px]" style={{ color: 'var(--lead-faint)' }}>
          Comments appear here when a commenter on your Facebook Page is matched to this lead.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {comments.map((c) => (
        <CommentCard key={c.id} comment={c} />
      ))}
    </div>
  )
}

function CommentCard({ comment }: { comment: ConversationComment }) {
  const classColor = CLASSIFICATION_COLORS[comment.classification]
  const actionLabel = ACTION_LABELS[comment.moderation_action]
  const statusLabel = STATUS_LABELS[comment.graph_status]
  const date = new Date(comment.created_at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <div
      className="rounded-lg px-3 py-2.5 text-[12.5px]"
      style={{
        background: 'var(--lead-surface)',
        border: '1px solid var(--lead-line)',
        color: 'var(--lead-body)',
      }}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium capitalize"
            style={{ background: `${classColor}18`, color: classColor }}
          >
            {comment.classification.replace('_', ' ')}
          </span>
          <span className="text-[11px]" style={{ color: 'var(--lead-faint)' }}>
            {comment.confidence} confidence
          </span>
        </div>
        <span className="shrink-0 text-[11px]" style={{ color: 'var(--lead-faint)' }}>
          {date}
        </span>
      </div>

      <div
        className="mb-1.5 whitespace-pre-wrap break-words"
        style={{ color: 'var(--lead-ink)' }}
      >
        {comment.message}
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px]" style={{ color: 'var(--lead-muted)' }}>
        <span>{comment.commenter_name ?? 'Unknown commenter'}</span>
        <span
          style={{
            color:
              comment.graph_status === 'failed'
                ? 'var(--lead-danger)'
                : comment.graph_status === 'sent' || comment.graph_status === 'hidden' || comment.graph_status === 'deleted'
                  ? 'var(--lead-accent)'
                  : 'var(--lead-faint)',
          }}
        >
          {actionLabel} · {statusLabel}
        </span>
      </div>
    </div>
  )
}
