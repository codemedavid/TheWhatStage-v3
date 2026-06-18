'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import {
  loadConversation,
  replyAsOperator,
  resumeBot,
  setAutoReply,
  undoStageEvent,
  type ConversationAttachment,
  type ConversationComment,
  type ConversationData,
  type ConversationMessage,
  type ConversationStageEvent,
} from '../actions/messenger'
import { AttachmentComposer } from './AttachmentComposer'
import { ActionPagePicker } from './ActionPagePicker'

type State =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: ConversationData }

export function ConversationPanel({ leadId }: { leadId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [draft, setDraft] = useState('')
  const [panel, setPanel] = useState<'none' | 'attach' | 'page'>('none')
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

  // Tick every 60s so the pause countdown label stays current.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (state.status !== 'ready') return
    const pausedUntil = state.data.thread.bot_paused_until
    if (!pausedUntil) return
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
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
  const onResume = () => {
    startToggle(async () => {
      try {
        await resumeBot(leadId)
        refresh()
      } catch (e) {
        setState({
          status: 'error',
          message: e instanceof Error ? e.message : 'Resume failed',
        })
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <Header thread={thread} toggling={toggling} onToggleAuto={onToggleAuto} onResume={onResume} now={now} />

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

      {panel === 'attach' && (
        <AttachmentComposer
          leadId={leadId}
          onSent={refresh}
          onError={(message) => setState({ status: 'error', message })}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'page' && (
        <ActionPagePicker
          leadId={leadId}
          onSent={refresh}
          onError={(message) => setState({ status: 'error', message })}
          onClose={() => setPanel('none')}
        />
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPanel((p) => (p === 'attach' ? 'none' : 'attach'))}
          className="lead-focus inline-flex h-8 items-center gap-1 rounded-full px-3 text-[12px] font-medium"
          style={
            panel === 'attach'
              ? { background: 'var(--lead-accent)', color: '#fff' }
              : { background: 'var(--lead-surface)', border: '1px solid var(--lead-line)', color: 'var(--lead-body)' }
          }
        >
          ＋ Attach
        </button>
        <button
          type="button"
          onClick={() => setPanel((p) => (p === 'page' ? 'none' : 'page'))}
          className="lead-focus inline-flex h-8 items-center gap-1 rounded-full px-3 text-[12px] font-medium"
          style={
            panel === 'page'
              ? { background: 'var(--lead-accent)', color: '#fff' }
              : { background: 'var(--lead-surface)', border: '1px solid var(--lead-line)', color: 'var(--lead-body)' }
          }
        >
          Send action page
        </button>
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
        ⌘ + Enter to send. Sending pauses the bot until you stop chatting.
      </p>
    </div>
  )
}

function Header({
  thread,
  toggling,
  onToggleAuto,
  onResume,
  now,
}: {
  thread: ConversationData['thread']
  toggling: boolean
  onToggleAuto: () => void
  onResume: () => void
  now: number
}) {
  const pausedUntilMs = thread.bot_paused_until
    ? Date.parse(thread.bot_paused_until)
    : null
  const isPaused =
    thread.auto_reply_enabled
    && pausedUntilMs !== null
    && !Number.isNaN(pausedUntilMs)
    && pausedUntilMs > now
  const minutesLeft = isPaused ? Math.max(1, Math.ceil((pausedUntilMs! - now) / 60_000)) : 0

  let label: string
  let title: string
  let onClick: () => void
  let pillStyle: React.CSSProperties

  if (!thread.auto_reply_enabled) {
    label = 'Bot off'
    title = 'Manually off — toggle to resume'
    onClick = onToggleAuto
    pillStyle = {
      color: 'var(--lead-body)',
      background: 'var(--lead-surface)',
      border: '1px solid var(--lead-line)',
    }
  } else if (isPaused) {
    label = `Paused · ${minutesLeft}m`
    title = `You're handling this — bot resumes in ${minutesLeft} min. Click to resume now.`
    onClick = onResume
    pillStyle = {
      color: 'var(--lead-warning, #92400e)',
      background: 'var(--lead-warning-soft, #fef3c7)',
      border: '1px solid var(--lead-warning, #f59e0b)',
    }
  } else {
    label = 'Bot on'
    title = 'Bot will reply to incoming messages'
    onClick = onToggleAuto
    pillStyle = {
      color: '#fff',
      background: 'var(--lead-accent)',
      border: '1px solid var(--lead-accent)',
    }
  }

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
        onClick={onClick}
        disabled={toggling}
        title={title}
        aria-label={title}
        className="lead-focus inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium transition-colors disabled:opacity-50"
        style={pillStyle}
      >
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{
            background:
              !thread.auto_reply_enabled
                ? 'var(--lead-faint)'
                : isPaused
                  ? 'var(--lead-warning, #f59e0b)'
                  : '#fff',
          }}
        />
        {label}
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

function AttachmentView({ attachment }: { attachment: ConversationAttachment }) {
  const { type, url, name } = attachment

  if (!url) {
    return (
      <div className="text-[11px] italic" style={{ color: 'var(--lead-faint)' }}>
        {name ?? type} (unavailable)
      </div>
    )
  }

  if (type === 'image') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name ?? 'image'} className="max-h-48 rounded-lg object-contain" />
  }
  if (type === 'video') {
    return <video src={url} controls className="max-h-48 rounded-lg" />
  }
  if (type === 'audio') {
    return <audio src={url} controls className="w-full" />
  }

  // file | action_page → link chip
  const label = type === 'action_page' ? `📄 ${name ?? 'Open action page'}` : `📎 ${name ?? 'Download file'}`
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="lead-focus inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium underline"
      style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)', color: 'var(--lead-accent)' }}
    >
      {label}
    </a>
  )
}

function Bubble({ m }: { m: ConversationMessage }) {
  const isInbound = m.direction === 'inbound'
  const senderLabel =
    m.sender === 'bot' ? 'Bot' : m.sender === 'operator' ? 'You' : ''
  const hasAttachments = m.attachments.length > 0
  const showBody = Boolean(m.body) && (!hasAttachments || isInbound)
  const isEmpty = !m.body && !hasAttachments
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
        {m.attachments.length > 0 && (
          <div className="mb-1 flex flex-col gap-1.5">
            {m.attachments.map((a, i) => (
              <AttachmentView key={i} attachment={a} />
            ))}
          </div>
        )}
        {/* Outbound attachment rows carry a synthetic "[image] name" body purely
            for the thread-list preview — the attachment itself is already shown,
            so skip it here. Inbound captions and text bodies still render. */}
        {showBody && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
        {isEmpty && <div className="whitespace-pre-wrap break-words">(empty)</div>}
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
