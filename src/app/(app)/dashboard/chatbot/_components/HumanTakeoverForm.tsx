'use client'

import { useEffect, useState, useTransition } from 'react'

export function HumanTakeoverForm() {
  const [minutes, setMinutes] = useState<number | ''>('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, startSave] = useTransition()
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/chatbot/takeover-settings')
      .then((r) => r.json())
      .then((data: { human_takeover_minutes?: number }) => {
        setMinutes(typeof data.human_takeover_minutes === 'number' ? data.human_takeover_minutes : 60)
        setLoaded(true)
      })
      .catch(() => {
        setMinutes(60)
        setLoaded(true)
      })
  }, [])

  const save = (value: number) => {
    setError(null)
    startSave(async () => {
      const res = await fetch('/api/chatbot/takeover-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ human_takeover_minutes: value }),
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
          <h2 className="afu-title">Human Takeover</h2>
          <p className="afu-help">
            When you reply in the lead conversation panel, the bot pauses for this many minutes. Set to 0 to disable auto-pause.
          </p>
        </div>
      </header>

      <div>
        <label className="afu-rows-head" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          Pause bot after I reply to a customer
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <input
            type="number"
            min={0}
            max={1440}
            step={1}
            value={minutes}
            onChange={(e) => {
              const v = e.target.value === '' ? '' : Math.floor(Number(e.target.value))
              setMinutes(v)
            }}
            onBlur={() => {
              if (minutes === '' || Number.isNaN(minutes)) return
              save(minutes as number)
            }}
            className="afu-row-value"
            disabled={saving}
          />
          <span className="afu-row-suffix">minutes</span>
          {saving && <span className="afu-help" style={{ marginTop: 0 }}>Saving…</span>}
          {!saving && savedAt && (
            <span style={{ fontSize: 12, color: '#059669' }}>Saved</span>
          )}
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
