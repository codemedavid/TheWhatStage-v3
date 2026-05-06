'use client'

import { useRef, useState } from 'react'

type MediaThumb = {
  id: string
  name: string
  slug: string
  signedUrl: string | null
}

type Msg = {
  role: 'user' | 'assistant'
  content: string
  sources?: string[]
  media?: MediaThumb[]
}

const SUGGESTED_QS = [
  'What are your prices?',
  'Magkano ang booking fee?',
  'Are you open this Saturday?',
  'Can I speak to a human?',
]

export function TestChat({ name = 'Assistant' }: { name?: string }) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || streaming) return
    setInput('')
    const history = messages
      .filter((m) => m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }))

    const next: Msg[] = [
      ...messages,
      { role: 'user', content: trimmed },
      { role: 'assistant', content: '' },
    ]
    setMessages(next)
    setStreaming(true)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch('/api/chatbot/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '')
        setMessages((m) => {
          const copy = [...m]
          copy[copy.length - 1] = {
            role: 'assistant',
            content: `Error: ${res.status} ${errText || res.statusText}`,
          }
          return copy
        })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let assistant = ''
      let sources: string[] = []
      let media: MediaThumb[] = []
      let pendingFlush: ReturnType<typeof setTimeout> | null = null
      const flushAssistant = () => {
        pendingFlush = null
        setMessages((m) => {
          const copy = [...m]
          copy[copy.length - 1] = { role: 'assistant', content: assistant, sources, media }
          return copy
        })
      }
      const scheduleFlush = () => {
        if (pendingFlush) return
        pendingFlush = setTimeout(flushAssistant, 60)
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const ev = JSON.parse(line) as
              | { type: 'ack' }
              | { type: 'delta'; text: string }
              | { type: 'sources'; titles: string[] }
              | {
                  type: 'media'
                  media: Array<{
                    id: string
                    name: string
                    slug: string
                    signedUrl?: string | null
                  }>
                }
              | { type: 'done' }
              | { type: 'error'; message: string }
            if (ev.type === 'delta') {
              assistant += ev.text
              scheduleFlush()
            } else if (ev.type === 'sources') {
              sources = ev.titles
              setMessages((m) => {
                const copy = [...m]
                copy[copy.length - 1] = { role: 'assistant', content: assistant, sources, media }
                return copy
              })
            } else if (ev.type === 'media') {
              media = ev.media.map((mItem) => ({
                id: mItem.id,
                name: mItem.name,
                slug: mItem.slug,
                signedUrl: mItem.signedUrl ?? null,
              }))
              setMessages((m) => {
                const copy = [...m]
                copy[copy.length - 1] = { role: 'assistant', content: assistant, sources, media }
                return copy
              })
            } else if (ev.type === 'error') {
              assistant += `\n\n[error] ${ev.message}`
              setMessages((m) => {
                const copy = [...m]
                copy[copy.length - 1] = { role: 'assistant', content: assistant, sources, media }
                return copy
              })
            }
          } catch {
            // ignore malformed line
          }
        }
      }
      if (pendingFlush) {
        clearTimeout(pendingFlush)
        flushAssistant()
      }
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') {
        setMessages((m) => {
          const copy = [...m]
          copy[copy.length - 1] = {
            role: 'assistant',
            content: `Error: ${(e as Error).message}`,
          }
          return copy
        })
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  function reset() {
    abortRef.current?.abort()
    setMessages([])
    setInput('')
    setStreaming(false)
  }

  const initial = (name || 'A').trim().charAt(0).toUpperCase() || 'A'

  return (
    <div className="cb-test">
      <div className="cb-test-head">
        <div className="cb-test-title">
          <div className="cb-bot-avatar">{initial}</div>
          <div>
            <b>{name || 'Assistant'}</b>
            <span>Test against current config + KB</span>
          </div>
        </div>
        <div className="cb-test-actions">
          <button
            type="button"
            onClick={reset}
            className="cb-icon-btn"
            title="Clear conversation"
            aria-label="Clear conversation"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
          </button>
        </div>
      </div>

      <div className="cb-test-body">
        {messages.length === 0 ? (
          <div className="cb-empty">
            <div className="cb-empty-icon" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.8L19 10l-4.5 3.5L16 19l-4-3-4 3 1.5-5.5L5 10l5.1-1.2z" /></svg>
            </div>
            <h4>Test your assistant</h4>
            <p>Send a question to see how your config responds.</p>
            <div className="cb-suggestions">
              {SUGGESTED_QS.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="cb-suggestion"
                  onClick={() => send(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="cb-messages">
            {messages.map((m, i) => (
              <div key={i} className={`cb-msg ${m.role}`}>
                {m.role === 'assistant' && (
                  <div className="cb-msg-avatar">{initial}</div>
                )}
                <div className="cb-msg-bubble">
                  {m.content ? (
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  ) : (
                    <span className="cb-typing"><i /><i /><i /></span>
                  )}
                  {m.role === 'assistant' && m.media && m.media.length > 0 && (
                    <div className="cb-msg-media">
                      {m.media.map((thumb) => (
                        <div key={thumb.id} className="cb-msg-media-thumb" title={thumb.name}>
                          {thumb.signedUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumb.signedUrl} alt={thumb.name} loading="lazy" />
                          ) : (
                            <span className="cb-msg-media-fallback">{thumb.name}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
                    <div className="cb-msg-sources">
                      {m.sources.map((s, j) => (
                        <span key={j} className="cb-msg-source">{s}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <form
        className="cb-composer"
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask anything in your assistant's domain…`}
          className="cb-composer-input"
          disabled={streaming}
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="cb-btn cb-btn-primary cb-btn-sm"
        >
          {streaming ? 'Sending…' : 'Send'}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
        </button>
      </form>
    </div>
  )
}
