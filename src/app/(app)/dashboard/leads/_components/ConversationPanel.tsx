'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import {
  loadConversation,
  replyAsOperator,
  setAutoReply,
  undoStageEvent,
  type ConversationComment,
  type ConversationData,
  type ConversationMessage,
  type ConversationStageEvent,
} from '../actions/messenger'

type State =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ConversationData }

export function ConversationPanel({ leadId }: { leadId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [draft, setDraft] = useState('')
  const [sending, startSend] = useTransition()
  const [toggling, startToggle] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)

  const refresh = () => {
    loadConversation(leadId)
      .then((data) => {
        if (!data) setState({ status: 'empty' })
        else setState({ status: 'ready', data })
      })
      .catch((e) => setState({ status: 'error', message: e.message ?? 'Failed' }))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId])

  useEffect(() => {
    if (state.status === 'ready' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [state])

  if (state.status === 'loading') {
    return (
      <div className="px-1 py-6 text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
        Loading conversation…
      </div>
    )
  }

  if (state.status === 'empty') {
    return (
      <div
        className="rounded-lg px-3 py-6 text-[12.5px]"
        style={{
          background: 'var(--lead-surface)',
          border: '1px dashed var(--lead-line)',
          color: 'var(--lead-muted)',
        }}
      >
        No Messenger conversation yet. When this lead messages your connected
        Facebook page, the thread will appear here.
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div
        className="rounded-lg px-3 py-3 text-[12.5px]"
        style={{
          background: 'var(--lead-danger-soft)',
          border: '1px solid var(--lead-danger)',
          color: 'var(--lead-danger)',
        }}
      >
        {state.message}
      </div>
    )
  }

  const { thread, messages, stageEvents, comments } = state.data
  const timeline = mergeTimeline(messages, stageEvents, comments)
  const onSend = () => {
    const value = draft.trim()
    if (!value) return
    startSend(async () => {
      try {
        await replyAsOperator(leadId, value)
        setDraft('')
        refresh()
      } catch (e) {
        setState({
          status: 'error',
          message: e instanceof Error ? e.message : 'Send failed',
        })
      }
    })
  }
  const onToggleAuto = () => {
    startToggle(async () => {
      try {
        await setAutoReply(leadId, !thread.auto_reply_enabled)
        refresh()
      } catch (e) {
        setState({
          status: 'error',
          message: e instanceof Error ? e.message : 'Toggle failed',
        })
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <Header thread={thread} toggling={toggling} onToggleAuto={onToggleAuto} />

      <div
        ref={scrollRef}
        className="flex flex-col gap-2 overflow-y-auto rounded-lg p-3"
        style={{
          background: 'var(--lead-surface-2)',
          border: '1px solid var(--lead-line)',
          maxHeight: 360,
          minHeight: 200,
        }}
      >
        {timeline.length === 0 ? (
          <div className="text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
            (No messages yet)
          </div>
        ) : (
          timeline.map((item) =>
            item.kind === 'message' ? (
              <Bubble key={`m-${item.data.id}`} m={item.data} />
            ) : item.kind === 'comment' ? (
              <CommentActivity key={`c-${item.data.id}`} comment={item.data} />
            ) : (
              <StageEventPill
                key={`e-${item.data.id}`}
                event={item.data}
                onUndo={() => {
                  undoStageEvent(item.data.id).then(refresh).catch(() => {})
                }}
              />
            ),
          )
        )}
      </div>

      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              onSend()
            }
          }}
          placeholder="Type a reply…"
          rows={2}
          className="lead-focus flex-1 rounded-lg px-3 py-2 text-[13px] outline-none placeholder:text-[color:var(--lead-faint)]"
          style={{
            background: 'var(--lead-surface)',
            border: '1px solid var(--lead-line)',
            color: 'var(--lead-ink)',
            resize: 'vertical',
            minHeight: 48,
          }}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={sending || !draft.trim()}
          className="lead-focus inline-flex h-9 items-center rounded-full px-3.5 text-[12.5px] font-medium text-white transition-colors disabled:opacity-50"
          style={{ background: 'var(--lead-accent)' }}
        >
          {sending ? 'Sending' : 'Send'}
        </button>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--lead-faint)' }}>
        ⌘ + Enter to send. Sending pauses the bot only if you toggle it off.
      </p>
    </div>
  )
}

function Header({
  thread,
  toggling,
  onToggleAuto,
}: {
  thread: ConversationData['thread']
  toggling: boolean
  onToggleAuto: () => void
}) {
  return (
    <div className="flex items-center gap-3">
      {thread.picture_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thread.picture_url}
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 rounded-full object-cover"
        />
      ) : (
        <div
          className="h-9 w-9 rounded-full"
          style={{ background: 'var(--lead-accent-soft)' }}
        />
      )}
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-[13px] font-medium"
          style={{ color: 'var(--lead-ink)' }}
        >
          {thread.full_name ?? 'Messenger user'}
        </div>
        <div className="truncate text-[11.5px]" style={{ color: 'var(--lead-muted)' }}>
          via {thread.page_name ?? 'Facebook page'}
        </div>
      </div>
      <button
        type="button"
        onClick={onToggleAuto}
        disabled={toggling}
        aria-pressed={thread.auto_reply_enabled}
        className="lead-focus inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium transition-colors disabled:opacity-50"
        style={{
          color: thread.auto_reply_enabled ? '#fff' : 'var(--lead-body)',
          background: thread.auto_reply_enabled
            ? 'var(--lead-accent)'
            : 'var(--lead-surface)',
          border: `1px solid ${
            thread.auto_reply_enabled ? 'var(--lead-accent)' : 'var(--lead-line)'
          }`,
        }}
      >
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{
            background: thread.auto_reply_enabled
              ? '#fff'
              : 'var(--lead-faint)',
          }}
        />
        {thread.auto_reply_enabled ? 'Bot on' : 'Bot off'}
      </button>
    </div>
  )
}

type TimelineItem =
  | { kind: 'message'; ts: number; data: ConversationMessage }
  | { kind: 'event'; ts: number; data: ConversationStageEvent }
  | { kind: 'comment'; ts: number; data: ConversationComment }

function mergeTimeline(
  messages: ConversationMessage[],
  events: ConversationStageEvent[],
  comments: ConversationComment[],
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...messages.map<TimelineItem>((m) => ({
      kind: 'message',
      ts: new Date(m.created_at).getTime(),
      data: m,
    })),
    ...events.map<TimelineItem>((e) => ({
      kind: 'event',
      ts: new Date(e.created_at).getTime(),
      data: e,
    })),
    ...comments.map<TimelineItem>((c) => ({
      kind: 'comment',
      ts: new Date(c.created_at).getTime(),
      data: c,
    })),
  ]
  items.sort((a, b) => a.ts - b.ts)
  return items
}

function StageEventPill({
  event,
  onUndo,
}: {
  event: ConversationStageEvent
  onUndo: () => void
}) {
  const isAi = event.source === 'ai'
  const arrow = ' → '
  const from = event.from_stage_name ?? '—'
  const to = event.to_stage_name ?? '—'
  return (
    <div className="my-1 flex w-full justify-center">
      <div
        className="flex max-w-[90%] flex-col items-center gap-1 rounded-full px-3 py-1.5 text-[11.5px]"
        style={{
          background: 'var(--lead-surface)',
          border: '1px dashed var(--lead-line)',
          color: 'var(--lead-muted)',
        }}
      >
        <div className="flex items-center gap-1.5">
          <span aria-hidden>{isAi ? '🤖' : '✋'}</span>
          <span>
            {isAi ? 'AI moved' : 'Moved'} <b style={{ color: 'var(--lead-ink)' }}>{from}</b>
            {arrow}
            <b style={{ color: 'var(--lead-ink)' }}>{to}</b>
          </span>
          {event.confidence && (
            <span style={{ color: 'var(--lead-faint)' }}>· {event.confidence}</span>
          )}
          {event.can_undo && (
            <button
              type="button"
              onClick={onUndo}
              className="ml-1 underline"
              style={{ color: 'var(--lead-accent)' }}
            >
              Undo
            </button>
          )}
        </div>
        {event.reason && (
          <div className="text-[11px]" style={{ color: 'var(--lead-faint)' }}>
            {event.reason}
          </div>
        )}
      </div>
    </div>
  )
}

function CommentActivity({ comment }: { comment: ConversationComment }) {
  return (
    <div
      className="rounded-lg px-3 py-2 text-[12.5px]"
      style={{
        background: 'var(--lead-surface)',
        border: '1px solid var(--lead-line)',
        color: 'var(--lead-body)',
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium" style={{ color: 'var(--lead-ink)' }}>
          Facebook comment
        </span>
        <span className="text-[11px]" style={{ color: 'var(--lead-muted)' }}>
          {comment.moderation_action.replace('_', ' ')} · {comment.graph_status}
        </span>
      </div>
      <div>{comment.message}</div>
      <div className="mt-1 text-[11px]" style={{ color: 'var(--lead-muted)' }}>
        {comment.commenter_name ?? 'Commenter'} · {comment.classification} · {comment.confidence}
      </div>
    </div>
  )
}

function Bubble({ m }: { m: ConversationMessage }) {
  const isInbound = m.direction === 'inbound'
  const senderLabel =
    m.sender === 'bot' ? 'Bot' : m.sender === 'operator' ? 'You' : ''
  return (
    <div
      className={`flex w-full ${isInbound ? 'justify-start' : 'justify-end'}`}
    >
      <div
        className="max-w-[80%] rounded-2xl px-3 py-2 text-[13px]"
        style={{
          background: isInbound
            ? 'var(--lead-surface)'
            : 'var(--lead-accent-soft)',
          color: 'var(--lead-ink)',
          border: '1px solid var(--lead-line)',
        }}
      >
        {!isInbound && senderLabel && (
          <div
            className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--lead-accent)' }}
          >
            {senderLabel}
          </div>
        )}
        <div className="whitespace-pre-wrap break-words">{m.body || '(empty)'}</div>
        {m.error && (
          <div className="mt-1 text-[10.5px]" style={{ color: 'var(--lead-danger)' }}>
            Send failed: {m.error}
          </div>
        )}
        <div
          className="mt-1 text-[10px] tabular-nums"
          style={{ color: 'var(--lead-faint)' }}
        >
          {new Date(m.created_at).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  )
}
