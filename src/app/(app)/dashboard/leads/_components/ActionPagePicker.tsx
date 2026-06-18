'use client'
import { useEffect, useState, useTransition } from 'react'
import {
  listSendableActionPages,
  sendActionPageAsOperator,
  type SendableActionPage,
} from '../actions/messenger'

type Props = {
  leadId: string
  onSent: () => void
  onError: (message: string) => void
  onClose: () => void
}

export function ActionPagePicker({ leadId, onSent, onError, onClose }: Props) {
  const [pages, setPages] = useState<SendableActionPage[] | null>(null)
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

  const send = (pageId: string) => {
    startSend(async () => {
      try {
        await sendActionPageAsOperator(leadId, pageId)
        onSent()
        onClose()
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Send failed')
      }
    })
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
              disabled={sending}
              onClick={() => send(p.id)}
              className="lead-focus flex items-center justify-between rounded-lg px-3 py-2 text-left text-[12.5px] disabled:opacity-50"
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
