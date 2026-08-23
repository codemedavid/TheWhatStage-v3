'use client'

import { useEffect, useState, useTransition } from 'react'

const MIN_SENTENCES = 1
const MAX_SENTENCES = 6
const DEFAULT_SENTENCES = 2

type ReplyLengthSettings = {
  reply_length_limit_enabled?: boolean
  reply_max_sentences?: number
}

export function ReplyLengthForm() {
  const [enabled, setEnabled] = useState(true)
  const [maxSentences, setMaxSentences] = useState<number>(DEFAULT_SENTENCES)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, startSave] = useTransition()
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/chatbot/structured-settings')
      .then((r) => r.json())
      .then((data: ReplyLengthSettings) => {
        setEnabled(data.reply_length_limit_enabled ?? true)
        setMaxSentences(
          typeof data.reply_max_sentences === 'number'
            ? data.reply_max_sentences
            : DEFAULT_SENTENCES,
        )
        setLoaded(true)
      })
      .catch(() => {
        setLoaded(true)
      })
  }, [])

  const save = (next: { enabled: boolean; maxSentences: number }) => {
    setError(null)
    startSave(async () => {
      const res = await fetch('/api/chatbot/structured-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reply_length_limit_enabled: next.enabled,
          reply_max_sentences: next.maxSentences,
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
          <h2 className="afu-title">Reply Length</h2>
          <p className="afu-help">
            Controls how long each reply can be. On = the bot is held to a maximum number of
            sentences (default 2, for punchy human-like texting). Off = the bot replies at a natural
            length for the question.
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
              save({ enabled: next, maxSentences })
            }}
          />
          <span>{enabled ? 'Limit on' : 'Limit off'}</span>
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
            Maximum sentences per reply
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <input
              type="number"
              min={MIN_SENTENCES}
              max={MAX_SENTENCES}
              step={1}
              value={maxSentences}
              disabled={saving}
              onChange={(e) => {
                const v =
                  e.target.value === '' ? DEFAULT_SENTENCES : Math.floor(Number(e.target.value))
                setMaxSentences(v)
              }}
              onBlur={() => {
                if (Number.isNaN(maxSentences)) return
                const clamped = Math.max(MIN_SENTENCES, Math.min(MAX_SENTENCES, maxSentences))
                if (clamped !== maxSentences) setMaxSentences(clamped)
                save({ enabled, maxSentences: clamped })
              }}
              className="afu-row-value"
            />
            <span className="afu-row-suffix">sentences</span>
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
