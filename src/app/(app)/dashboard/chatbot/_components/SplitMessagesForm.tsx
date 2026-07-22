'use client'

import { useEffect, useState, useTransition } from 'react'

const MIN_BUBBLES = 2
const MAX_BUBBLES = 5
const DEFAULT_BUBBLES = 3

type SplitSettings = {
  split_messages_enabled?: boolean
  split_max_bubbles?: number
}

export function SplitMessagesForm() {
  const [enabled, setEnabled] = useState(false)
  const [maxBubbles, setMaxBubbles] = useState<number>(DEFAULT_BUBBLES)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, startSave] = useTransition()
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/chatbot/split-settings')
      .then((r) => r.json())
      .then((data: SplitSettings) => {
        setEnabled(!!data.split_messages_enabled)
        setMaxBubbles(
          typeof data.split_max_bubbles === 'number' ? data.split_max_bubbles : DEFAULT_BUBBLES,
        )
        setLoaded(true)
      })
      .catch(() => {
        setLoaded(true)
      })
  }, [])

  const save = (next: { enabled: boolean; maxBubbles: number }) => {
    setError(null)
    startSave(async () => {
      const res = await fetch('/api/chatbot/split-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          split_messages_enabled: next.enabled,
          split_max_bubbles: next.maxBubbles,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error ?? 'Save failed')
        return
      }
      setSavedAt(Date.now())
    })
  }

  if (!loaded) {
    return (
      <div className="afu-wrap">
        <p className="afu-help">Loading…</p>
      </div>
    )
  }

  return (
    <div className="afu-wrap">
      <header className="afu-header">
        <div>
          <h2 className="afu-title">Split Messages Like a Human</h2>
          <p className="afu-help">
            When on, the bot breaks a reply into a few natural chat bubbles — a greeting or
            acknowledgement first, then the follow-up question on its own — with a short typing pause
            in between, so it feels like a person messaging. Off = the bot sends one message (current
            behavior).
          </p>
        </div>
      </header>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(e) => {
              const next = e.target.checked
              setEnabled(next)
              save({ enabled: next, maxBubbles })
            }}
          />
          <span>{enabled ? 'On' : 'Off'}</span>
        </label>
        {saving && (
          <span className="afu-help" style={{ marginTop: 0 }}>
            Saving…
          </span>
        )}
        {!saving && savedAt && <span style={{ fontSize: 12, color: '#059669' }}>Saved</span>}
      </div>

      {enabled && (
        <div style={{ marginTop: 14 }}>
          <label className="afu-rows-head" style={{ borderBottom: 'none', paddingBottom: 0 }}>
            Maximum bubbles per reply
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <input
              type="number"
              min={MIN_BUBBLES}
              max={MAX_BUBBLES}
              step={1}
              value={maxBubbles}
              disabled={saving}
              onChange={(e) => {
                const v = e.target.value === '' ? DEFAULT_BUBBLES : Math.floor(Number(e.target.value))
                setMaxBubbles(v)
              }}
              onBlur={() => {
                if (Number.isNaN(maxBubbles)) return
                const clamped = Math.max(MIN_BUBBLES, Math.min(MAX_BUBBLES, maxBubbles))
                if (clamped !== maxBubbles) setMaxBubbles(clamped)
                save({ enabled, maxBubbles: clamped })
              }}
              className="afu-row-value"
            />
            <span className="afu-row-suffix">bubbles</span>
          </div>
        </div>
      )}

      {error && (
        <div className="afu-form-error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
