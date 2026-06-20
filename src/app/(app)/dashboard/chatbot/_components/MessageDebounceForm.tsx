'use client'

import { useEffect, useState, useTransition } from 'react'

const MAX_SECONDS = 15
const DEFAULT_SECONDS = 6

export function MessageDebounceForm() {
  const [seconds, setSeconds] = useState<number | ''>('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, startSave] = useTransition()
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/chatbot/debounce-settings')
      .then((r) => r.json())
      .then((data: { message_debounce_seconds?: number }) => {
        setSeconds(
          typeof data.message_debounce_seconds === 'number'
            ? data.message_debounce_seconds
            : DEFAULT_SECONDS,
        )
        setLoaded(true)
      })
      .catch(() => {
        setSeconds(DEFAULT_SECONDS)
        setLoaded(true)
      })
  }, [])

  const save = (value: number) => {
    setError(null)
    startSave(async () => {
      const res = await fetch('/api/chatbot/debounce-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message_debounce_seconds: value }),
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
          <h2 className="afu-title">Group Rapid Messages</h2>
          <p className="afu-help">
            When a customer sends several messages quickly, the bot waits this many seconds for
            them to finish, then replies once to everything — so it feels less robotic. Set to 0 to
            reply instantly to each message.
          </p>
        </div>
      </header>

      <div>
        <label className="afu-rows-head" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          Wait before replying to group messages
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <input
            type="number"
            min={0}
            max={MAX_SECONDS}
            step={1}
            value={seconds}
            onChange={(e) => {
              const v = e.target.value === '' ? '' : Math.floor(Number(e.target.value))
              setSeconds(v)
            }}
            onBlur={() => {
              if (seconds === '' || Number.isNaN(seconds)) return
              const clamped = Math.max(0, Math.min(MAX_SECONDS, seconds as number))
              if (clamped !== seconds) setSeconds(clamped)
              save(clamped)
            }}
            className="afu-row-value"
            disabled={saving}
          />
          <span className="afu-row-suffix">seconds</span>
          {saving && (
            <span className="afu-help" style={{ marginTop: 0 }}>
              Saving…
            </span>
          )}
          {!saving && savedAt && <span style={{ fontSize: 12, color: '#059669' }}>Saved</span>}
        </div>
      </div>

      {error && (
        <div className="afu-form-error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}
