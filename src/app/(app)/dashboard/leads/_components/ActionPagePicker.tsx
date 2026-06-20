'use client'
import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  listSendableActionPages,
  sendActionPageAsOperator,
  type SendableActionPage,
} from '../actions/messenger'
import { describeSendError } from '../_lib/send-error'

// Mirror the Meta limits enforced server-side in sendActionPageAsOperator.
const MESSAGE_MAX = 640
const CTA_MAX = 20

type Props = {
  leadId: string
  onSent: () => void
  onError: (message: string) => void
  onClose: () => void
}

function defaultMessage(page: SendableActionPage): string {
  return [page.title, page.description?.trim()].filter(Boolean).join('\n\n').slice(0, MESSAGE_MAX)
}

function defaultCta(page: SendableActionPage): string {
  return (page.cta_label?.trim() || 'Open').slice(0, CTA_MAX)
}

export function ActionPagePicker({ leadId, onSent, onError, onClose }: Props) {
  const [pages, setPages] = useState<SendableActionPage[] | null>(null)
  const [selected, setSelected] = useState<SendableActionPage | null>(null)
  const [sending, startSend] = useTransition()

  useEffect(() => {
    let cancelled = false
    listSendableActionPages()
      .then((p) => !cancelled && setPages(p))
      .catch((e) => !cancelled && onError(e instanceof Error ? e.message : 'Failed to load pages'))
    return () => {
      cancelled = true
    }
  }, [onError])

  if (selected) {
    return (
      <ComposeView
        page={selected}
        leadId={leadId}
        sending={sending}
        onBack={() => setSelected(null)}
        onClose={onClose}
        onSend={(overrides) => {
          startSend(async () => {
            try {
              const result = await sendActionPageAsOperator(leadId, selected.id, overrides)
              if (!result.ok) {
                onError(describeSendError(result.error))
                return
              }
              onSent()
              onClose()
            } catch (e) {
              onError(e instanceof Error ? e.message : 'Send failed')
            }
          })
        }}
      />
    )
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg p-3"
      style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium" style={{ color: 'var(--lead-ink)' }}>
          Send an action page
        </span>
        <button
          type="button"
          onClick={onClose}
          className="lead-focus text-[12px]"
          style={{ color: 'var(--lead-muted)' }}
          aria-label="Close action page panel"
        >
          ✕
        </button>
      </div>

      {pages === null ? (
        <p className="text-[12px]" style={{ color: 'var(--lead-muted)' }}>
          Loading…
        </p>
      ) : pages.length === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--lead-muted)' }}>
          No published action pages. Publish one first.
        </p>
      ) : (
        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {pages.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelected(p)}
              className="lead-focus flex items-center justify-between rounded-lg px-3 py-2 text-left text-[12.5px]"
              style={{ background: 'var(--lead-surface-2)', border: '1px solid var(--lead-line)' }}
            >
              <span className="truncate" style={{ color: 'var(--lead-ink)' }}>
                {p.title}
              </span>
              <span className="ml-2 shrink-0 text-[11px] capitalize" style={{ color: 'var(--lead-faint)' }}>
                {p.kind}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type ComposeProps = {
  page: SendableActionPage
  leadId: string
  sending: boolean
  onBack: () => void
  onClose: () => void
  onSend: (overrides: { messageText: string; ctaLabel: string }) => void
}

function ComposeView({ page, sending, onBack, onClose, onSend }: ComposeProps) {
  const initialMessage = useMemo(() => defaultMessage(page), [page])
  const initialCta = useMemo(() => defaultCta(page), [page])
  const [message, setMessage] = useState(initialMessage)
  const [cta, setCta] = useState(initialCta)

  const trimmedMessage = message.trim()
  const trimmedCta = cta.trim()
  const canSend = trimmedMessage.length > 0 && trimmedCta.length > 0 && !sending

  return (
    <div
      className="flex flex-col gap-2 rounded-lg p-3"
      style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)' }}
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={sending}
          className="lead-focus text-[12px] disabled:opacity-50"
          style={{ color: 'var(--lead-muted)' }}
        >
          ← Back
        </button>
        <span className="truncate px-2 text-[12px] font-medium" style={{ color: 'var(--lead-ink)' }}>
          {page.title}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="lead-focus text-[12px]"
          style={{ color: 'var(--lead-muted)' }}
          aria-label="Close action page panel"
        >
          ✕
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="flex items-center justify-between text-[11px]" style={{ color: 'var(--lead-muted)' }}>
          <span>Message</span>
          <span style={{ color: 'var(--lead-faint)' }}>
            {message.length}/{MESSAGE_MAX}
          </span>
        </span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={MESSAGE_MAX}
          rows={4}
          disabled={sending}
          className="lead-focus resize-none rounded-lg px-3 py-2 text-[12.5px] disabled:opacity-50"
          style={{
            background: 'var(--lead-surface-2)',
            border: '1px solid var(--lead-line)',
            color: 'var(--lead-ink)',
          }}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="flex items-center justify-between text-[11px]" style={{ color: 'var(--lead-muted)' }}>
          <span>Button label</span>
          <span style={{ color: 'var(--lead-faint)' }}>
            {cta.length}/{CTA_MAX}
          </span>
        </span>
        <input
          value={cta}
          onChange={(e) => setCta(e.target.value)}
          maxLength={CTA_MAX}
          disabled={sending}
          className="lead-focus rounded-lg px-3 py-2 text-[12.5px] disabled:opacity-50"
          style={{
            background: 'var(--lead-surface-2)',
            border: '1px solid var(--lead-line)',
            color: 'var(--lead-ink)',
          }}
        />
      </label>

      <button
        type="button"
        disabled={!canSend}
        onClick={() => onSend({ messageText: trimmedMessage, ctaLabel: trimmedCta })}
        className="lead-focus rounded-lg px-3 py-2 text-[12.5px] font-medium disabled:opacity-50"
        style={{ background: 'var(--lead-accent)', color: 'var(--lead-on-accent)' }}
      >
        {sending ? 'Sending…' : 'Send'}
      </button>
    </div>
  )
}
