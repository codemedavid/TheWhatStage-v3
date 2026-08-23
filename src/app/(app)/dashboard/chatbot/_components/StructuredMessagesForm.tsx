'use client'

import { useEffect, useState, useTransition } from 'react'

type StructuredLayout = 'single' | 'bubbles'

type StructuredSettings = {
  structured_messages_enabled?: boolean
  structured_message_layout?: StructuredLayout
}

export function StructuredMessagesForm() {
  const [enabled, setEnabled] = useState(false)
  const [layout, setLayout] = useState<StructuredLayout>('single')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, startSave] = useTransition()
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/chatbot/structured-settings')
      .then((r) => r.json())
      .then((data: StructuredSettings) => {
        setEnabled(!!data.structured_messages_enabled)
        setLayout(data.structured_message_layout === 'bubbles' ? 'bubbles' : 'single')
        setLoaded(true)
      })
      .catch(() => {
        setLoaded(true)
      })
  }, [])

  const save = (next: { enabled: boolean; layout: StructuredLayout }) => {
    setError(null)
    startSave(async () => {
      const res = await fetch('/api/chatbot/structured-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          structured_messages_enabled: next.enabled,
          structured_message_layout: next.layout,
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
          <h2 className="afu-title">Structure Messages</h2>
          <p className="afu-help">
            When on, the bot writes replies with intentional line breaks — one idea or option per
            line (stairway / 1-3-1 style) — instead of one long paragraph, so choices are easy to
            scan. Off = the bot writes normally (current behavior).
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
              save({ enabled: next, layout })
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
            How to deliver a structured reply
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
              <input
                type="radio"
                name="structured-layout"
                value="single"
                checked={layout === 'single'}
                disabled={saving}
                onChange={() => {
                  setLayout('single')
                  save({ enabled, layout: 'single' })
                }}
              />
              <span>
                <strong>One message</strong> — the whole reply arrives as a single message with the
                line breaks kept.
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
              <input
                type="radio"
                name="structured-layout"
                value="bubbles"
                checked={layout === 'bubbles'}
                disabled={saving}
                onChange={() => {
                  setLayout('bubbles')
                  save({ enabled, layout: 'bubbles' })
                }}
              />
              <span>
                <strong>Separate bubbles</strong> — each line is sent as its own paced chat bubble.
              </span>
            </label>
          </div>
          <p className="afu-help" style={{ marginTop: 10 }}>
            Bubble count is capped by your Split Messages setting. When structured messages are on,
            this layout takes precedence over the Split Messages toggle.
          </p>
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
