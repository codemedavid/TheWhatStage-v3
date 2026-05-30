'use client'

import { useMemo, useRef, useState } from 'react'
import { renderEchoTemplate } from '@/lib/action-pages/echo/render'
import {
  knownPathsForKind,
  sampleContextForKind,
  VARIABLES_BY_KIND,
  type VariableDef,
} from '@/lib/action-pages/echo/variables'
import type { ActionPageKind } from '@/lib/action-pages/kinds'

const MAX_LEN = 640

// Top-of-mind variables for a Booking thank-you. Shown as quick-insert chips.
const QUICK_INSERT_BOOKING = ['customer.name', 'booking.date', 'booking.time', 'booking.duration']

export function BookingThanksComposer({
  name,
  kind,
  customKeys,
  defaultValue,
  initialName,
}: {
  name: string
  kind: ActionPageKind
  customKeys: readonly string[]
  defaultValue: string
  initialName?: string
}) {
  const [text, setText] = useState(defaultValue)
  const [pickerOpen, setPickerOpen] = useState(true)
  const [query, setQuery] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  const allVars = useMemo<VariableDef[]>(() => {
    const base = VARIABLES_BY_KIND[kind] ?? []
    const custom: VariableDef[] = customKeys.map((k) => ({
      path: `custom.${k}`,
      label: `Custom: ${k}`,
      sample: `[${k} sample]`,
      group: 'Custom',
    }))
    return [...base, ...custom]
  }, [kind, customKeys])

  const quickInserts = useMemo(() => {
    const map = new Map(allVars.map((v) => [v.path, v]))
    return QUICK_INSERT_BOOKING.map((p) => map.get(p)).filter(
      (v): v is VariableDef => v != null,
    )
  }, [allVars])

  const groups = useMemo(() => {
    const filtered = query.trim()
      ? allVars.filter((v) =>
          (v.path + ' ' + v.label).toLowerCase().includes(query.trim().toLowerCase()),
        )
      : allVars
    const map = new Map<string, VariableDef[]>()
    for (const v of filtered) {
      const list = map.get(v.group) ?? []
      list.push(v)
      map.set(v.group, list)
    }
    return Array.from(map.entries())
  }, [allVars, query])

  const preview = useMemo(() => {
    const known = knownPathsForKind(kind, customKeys)
    const ctx = sampleContextForKind(kind, customKeys)
    return renderEchoTemplate(text, ctx, known)
  }, [text, kind, customKeys])

  function insertAtCursor(path: string) {
    const ta = taRef.current
    const start = ta?.selectionStart ?? text.length
    const end = ta?.selectionEnd ?? text.length
    const token = `{{${path}}}`
    const next = text.slice(0, start) + token + text.slice(end)
    setText(next.slice(0, MAX_LEN))
    requestAnimationFrame(() => {
      if (!ta) return
      ta.focus()
      const pos = Math.min(start + token.length, MAX_LEN)
      ta.setSelectionRange(pos, pos)
    })
  }

  const operatorInitials = (initialName ?? 'WS')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase() || 'WS'

  return (
    <div className="bs-thanks">
      <style>{thanksStyles}</style>

      {/* ─── Composer ──────────────────────────────────────── */}
      <div className="bst-section">
        <div className="bst-seclabel">
          <span>Message</span>
          <span className="bst-counter">
            {text.length} / {MAX_LEN}
          </span>
        </div>
        <textarea
          ref={taRef}
          name={name}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
          rows={5}
          maxLength={MAX_LEN}
          placeholder="Thanks {{customer.name}}! You're booked for {{booking.datetime}}."
          className="bst-textarea"
          spellCheck
        />
        <div className="bst-hint">
          Type <kbd>{'{'}</kbd>
          <kbd>{'{'}</kbd> to insert a variable. Empty message = no auto-reply sent.
        </div>

        {/* Quick-insert chips */}
        <div className="bst-quick">
          <div className="bst-quick-label">Quick insert</div>
          <div className="bst-quick-row">
            {quickInserts.map((v) => (
              <button
                type="button"
                key={v.path}
                className="bst-chip"
                onClick={() => insertAtCursor(v.path)}
                title={v.label}
              >
                <span aria-hidden>+</span>
                {`{{${v.path}}}`}
              </button>
            ))}
            <button
              type="button"
              className="bst-chip-ghost"
              onClick={() => setPickerOpen((o) => !o)}
              aria-expanded={pickerOpen}
            >
              All variables {pickerOpen ? '▾' : '▸'}
            </button>
          </div>
        </div>

        {/* Expanded picker */}
        {pickerOpen && (
          <div className="bst-picker">
            <div className="bst-picker-search">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search variables…"
                aria-label="Search variables"
              />
            </div>
            <div className="bst-picker-body">
              {groups.length === 0 && (
                <div className="bst-picker-empty">No variables match “{query}”.</div>
              )}
              {groups.map(([group, items]) => (
                <div key={group}>
                  <div className="bst-picker-group">{group}</div>
                  {items.map((v) => (
                    <button
                      type="button"
                      key={v.path}
                      className="bst-picker-row"
                      onClick={() => insertAtCursor(v.path)}
                      title={`Insert {{${v.path}}}`}
                    >
                      <span className="bst-picker-path">{`{{${v.path}}}`}</span>
                      <span className="bst-picker-sample">{v.sample}</span>
                      <span className="bst-picker-plus" aria-hidden>+</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ─── Preview ───────────────────────────────────────── */}
      <div className="bst-section">
        <div className="bst-seclabel">
          <span>Preview</span>
          <span className="bst-mute">Messenger · right after booking</span>
        </div>
        <div className="bst-bubble-wrap">
          <div className="bst-bubble-head">
            <span className="bst-bubble-glyph" aria-hidden>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="#fff">
                <path d="M12 2C6.5 2 2 6.1 2 11c0 2.6 1.3 5 3.4 6.5V22l3.1-1.7c1.1.3 2.3.5 3.5.5 5.5 0 10-4.1 10-9.1S17.5 2 12 2zm1 12.3l-2.6-2.7-5 2.7 5.5-5.8 2.6 2.7 5-2.7-5.5 5.8z"/>
              </svg>
            </span>
            <span className="bst-bubble-meta">Live preview with sample values</span>
          </div>
          <div className="bst-bubble-row">
            <div className="bst-avatar">{operatorInitials}</div>
            <div className="bst-bubble">
              {preview.text ? (
                <span className="bst-bubble-text">{preview.text}</span>
              ) : (
                <span className="bst-bubble-empty">Your reply will appear here.</span>
              )}
            </div>
          </div>
        </div>

        {preview.warnings.length > 0 && (
          <div className="bst-warn" data-testid="echo-warnings">
            <div className="bst-warn-title">Unknown or malformed tokens:</div>
            <ul>
              {preview.warnings.map((w, i) => (
                <li key={i}>
                  <code>{w.token || '(empty)'}</code> — {w.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        <details className="bst-sample">
          <summary>Sample data used in preview</summary>
          <div className="bst-sample-table">
            {allVars.map((v) => (
              <div className="bst-sample-row" key={v.path}>
                <span className="bst-sample-path">{`{{${v.path}}}`}</span>
                <span className="bst-sample-val">{v.sample}</span>
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  )
}

const thanksStyles = `
.bs-thanks { display:flex; flex-direction:column; gap:12px; }
.bs-thanks .bst-section { display:flex; flex-direction:column; gap:8px; }
.bs-thanks .bst-seclabel {
  display:flex; align-items:center; justify-content:space-between;
  font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.7px;
  color:var(--bs-ink-3);
}
.bs-thanks .bst-counter { font-variant-numeric: tabular-nums; color:var(--bs-ink-4); text-transform:none; letter-spacing:0; font-weight:500; }
.bs-thanks .bst-mute { color:var(--bs-ink-4); text-transform:none; letter-spacing:0; font-weight:500; }

.bs-thanks .bst-textarea {
  width:100%; min-height:130px; resize:vertical;
  background:var(--bs-paper); border:1px solid var(--bs-border-strong);
  border-radius:6px; padding:10px 12px;
  font-size:13.5px; line-height:1.6; color:var(--bs-ink);
  font-family: inherit;
}
.bs-thanks .bst-textarea:focus {
  outline:none; border-color:var(--bs-accent);
  box-shadow:0 0 0 3px var(--bs-accent-ghost);
}

.bs-thanks .bst-hint { font-size:11px; color:var(--bs-ink-4); }
.bs-thanks .bst-hint kbd {
  display:inline-block; min-width:14px; height:14px; padding:0 3px;
  font-family: ui-monospace, Menlo, monospace; font-size:10px; line-height:14px;
  background:var(--bs-paper); border:1px solid var(--bs-border-strong);
  border-bottom-width:2px; border-radius:3px; color:var(--bs-ink-3);
  vertical-align:middle;
}

.bs-thanks .bst-quick { margin-top:4px; }
.bs-thanks .bst-quick-label {
  font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.6px;
  color:var(--bs-ink-4); margin-bottom:5px;
}
.bs-thanks .bst-quick-row { display:flex; flex-wrap:wrap; gap:4px; }
.bs-thanks .bst-chip {
  display:inline-flex; align-items:center; gap:4px;
  height:22px; padding:0 8px 0 6px;
  border-radius:4px; background:var(--bs-paper);
  border:1px solid var(--bs-border); color:var(--bs-accent-2);
  font-family: ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace;
  font-size:11px; font-weight:500;
  transition: border-color .12s, background .12s;
}
.bs-thanks .bst-chip:hover { border-color:var(--bs-accent); background:var(--bs-accent-ghost); }
.bs-thanks .bst-chip > span { font-family: inherit; font-weight:600; }
.bs-thanks .bst-chip-ghost {
  height:22px; padding:0 8px; border-radius:4px;
  color:var(--bs-ink-3); background:transparent;
  font-size:11px; font-weight:500;
  display:inline-flex; align-items:center; gap:4px;
}
.bs-thanks .bst-chip-ghost:hover { color:var(--bs-ink); background:var(--bs-bg-2); }

/* ─ picker ─ */
.bs-thanks .bst-picker {
  margin-top:6px; background:var(--bs-paper); border:1px solid var(--bs-border);
  border-radius:6px; overflow:hidden;
}
.bs-thanks .bst-picker-search { padding:6px; border-bottom:1px solid var(--bs-border-soft); }
.bs-thanks .bst-picker-search input {
  width:100%; background:var(--bs-bg-2); border:0; border-radius:4px;
  padding:5px 9px; font-size:11.5px; color:var(--bs-ink); outline:none;
}
.bs-thanks .bst-picker-search input::placeholder { color:var(--bs-ink-4); }
.bs-thanks .bst-picker-body { max-height:240px; overflow-y:auto; }
.bs-thanks .bst-picker-empty { padding:14px; text-align:center; color:var(--bs-ink-4); font-size:11.5px; }
.bs-thanks .bst-picker-group {
  padding:6px 10px; font-size:10px; font-weight:600;
  color:var(--bs-ink-4); letter-spacing:.6px; text-transform:uppercase;
  background:var(--bs-paper-2); border-bottom:1px solid var(--bs-border-soft);
}
.bs-thanks .bst-picker-row {
  width:100%; display:flex; align-items:center; gap:8px;
  padding:6px 10px; text-align:left; background:transparent;
}
.bs-thanks .bst-picker-row:hover { background:var(--bs-bg-2); }
.bs-thanks .bst-picker-path {
  font-family: ui-monospace,Menlo,monospace; font-size:11px;
  color:var(--bs-accent-2); flex-shrink:0;
}
.bs-thanks .bst-picker-sample {
  flex:1; font-size:11px; color:var(--bs-ink-4);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:right;
}
.bs-thanks .bst-picker-plus { color:var(--bs-ink-4); font-size:13px; line-height:1; }

/* ─ preview bubble ─ */
.bs-thanks .bst-bubble-wrap {
  background:var(--bs-bg-2); border-radius:10px; padding:10px 12px;
}
.bs-thanks .bst-bubble-head { display:flex; align-items:center; gap:6px; margin-bottom:8px; }
.bs-thanks .bst-bubble-glyph {
  width:18px; height:18px; border-radius:9px; background:#0084ff;
  display:inline-flex; align-items:center; justify-content:center;
}
.bs-thanks .bst-bubble-meta { font-size:10.5px; color:var(--bs-ink-4); }
.bs-thanks .bst-bubble-row { display:flex; align-items:flex-start; }
.bs-thanks .bst-avatar {
  width:22px; height:22px; border-radius:11px;
  background:#7a8a6a; color:#fff; flex-shrink:0;
  display:flex; align-items:center; justify-content:center;
  font-size:9px; font-weight:700; margin-right:6px;
}
.bs-thanks .bst-bubble {
  background:var(--bs-paper); border-radius:14px 14px 14px 4px;
  padding:9px 12px; font-size:12.5px; line-height:1.5; color:var(--bs-ink);
  box-shadow: 0 1px 2px rgba(0,0,0,.04);
  max-width:94%; white-space:pre-wrap; word-break:break-word;
}
.bs-thanks .bst-bubble-empty { color:var(--bs-ink-4); font-style:italic; }

.bs-thanks .bst-warn {
  margin-top:8px; padding:8px 10px;
  background:#fef3c7; border:1px solid #fcd34d; border-radius:6px;
  font-size:11.5px; color:#78350f;
}
.bs-thanks .bst-warn-title { font-weight:600; margin-bottom:4px; }
.bs-thanks .bst-warn ul { margin:0; padding-left:18px; list-style:disc; }
.bs-thanks .bst-warn code { font-family: ui-monospace,Menlo,monospace; }

.bs-thanks .bst-sample { margin-top:8px; }
.bs-thanks .bst-sample summary {
  cursor:pointer; font-size:11px; color:var(--bs-ink-4); list-style:none;
  display:inline-flex; align-items:center; gap:4px;
}
.bs-thanks .bst-sample summary::-webkit-details-marker { display:none; }
.bs-thanks .bst-sample summary::before { content:'▸'; font-size:9px; }
.bs-thanks .bst-sample[open] summary::before { content:'▾'; }
.bs-thanks .bst-sample-table {
  margin-top:6px; padding:8px 10px;
  background:var(--bs-bg-3); border-radius:5px;
  font-size:10.5px; line-height:1.7;
  font-family: ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace;
  max-height:200px; overflow-y:auto;
}
.bs-thanks .bst-sample-row { display:flex; justify-content:space-between; gap:8px; }
.bs-thanks .bst-sample-path { color:var(--bs-accent-2); }
.bs-thanks .bst-sample-val { color:var(--bs-ink-2); }
`
