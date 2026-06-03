'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { deleteCourseAction } from '../actions'

type Props = {
  courseId: string
  slug: string
  title: string
  onClose: () => void
  onDeleted: () => void
}

// Custom fixed-overlay confirm modal. Type the slug to enable Delete.
// Esc / overlay-click closes; focus traps to the input on open.
export function DeleteCourseModal({ courseId, slug, title, onClose, onDeleted }: Props) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) onClose()
    }
    document.addEventListener('keydown', onKey)
    inputRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, pending])

  const confirmed = value.trim() === slug

  function onDelete() {
    if (!confirmed) return
    setError(null)
    startTransition(async () => {
      const res = await deleteCourseAction(courseId)
      if (!res.ok) {
        setError(res.error ?? 'Delete failed.')
        return
      }
      onDeleted()
    })
  }

  return (
    <div
      className="uni-del-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="uni-del-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pending) onClose()
      }}
    >
      <div className="uni-del-panel">
        <h2 id="uni-del-title" className="uni-del-h">Delete this course?</h2>
        <p className="uni-del-p">
          <strong>{title}</strong> and all of its lessons and learner progress will be
          permanently removed. This can&rsquo;t be undone.
        </p>

        <label className="uni-del-label" htmlFor="uni-del-input">
          Type <code>{slug}</code> to confirm
        </label>
        <input
          id="uni-del-input"
          ref={inputRef}
          className="uni-del-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onDelete() }}
          placeholder={slug}
          autoComplete="off"
          spellCheck={false}
          disabled={pending}
        />

        {error && <div className="uni-del-error" role="alert">{error}</div>}

        <div className="uni-del-actions">
          <button
            type="button"
            className="ap-btn ap-btn-secondary"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="uni-del-confirm"
            onClick={onDelete}
            disabled={!confirmed || pending}
          >
            {pending ? 'Deleting…' : 'Delete course'}
          </button>
        </div>
      </div>

      <style>{`
        .uni-del-overlay {
          position: fixed; inset: 0; z-index: 80;
          display: grid; place-items: center; padding: 20px;
          background: rgba(23,21,16,0.42); backdrop-filter: blur(2px);
        }
        .uni-del-panel {
          width: 100%; max-width: 440px;
          background: var(--ws-surface); border: 1px solid var(--ws-border);
          border-radius: 16px; padding: 24px;
          box-shadow: 0 24px 64px -16px rgba(23,21,16,0.4);
        }
        .uni-del-h {
          margin: 0 0 8px; font-size: 19px; font-weight: 600; color: var(--ws-ink);
          letter-spacing: -0.01em;
        }
        .uni-del-p { margin: 0 0 18px; font-size: 13.5px; line-height: 1.6; color: var(--ws-ink-2); }
        .uni-del-p code, .uni-del-label code {
          font-family: var(--font-geist-mono), ui-monospace, monospace;
          font-size: 12.5px; padding: 1px 5px; border-radius: 5px;
          background: var(--ws-surface-3); color: var(--ws-ink);
        }
        .uni-del-label {
          display: block; margin-bottom: 7px; font-size: 12.5px; color: var(--ws-ink-3);
        }
        .uni-del-input {
          width: 100%; height: 40px; padding: 0 12px; box-sizing: border-box;
          border: 1px solid var(--ws-border-strong, #D9D6CC); border-radius: 9px;
          background: var(--ws-surface); color: var(--ws-ink); font-size: 14px;
          font-family: var(--font-geist-mono), ui-monospace, monospace;
          outline: none; transition: border-color 120ms, box-shadow 120ms;
        }
        .uni-del-input:focus {
          border-color: var(--ws-accent); box-shadow: 0 0 0 3px var(--ws-accent-softer);
        }
        .uni-del-input:disabled { opacity: 0.6; }
        .uni-del-error {
          margin-top: 10px; font-size: 12.5px; color: #B23A2B;
        }
        .uni-del-actions {
          display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px;
        }
        .uni-del-confirm {
          display: inline-flex; align-items: center; justify-content: center;
          height: 38px; padding: 0 16px; border-radius: 9px; border: none;
          background: #B23A2B; color: #fff; font-size: 13.5px; font-weight: 600;
          cursor: pointer; transition: background 120ms, opacity 120ms;
        }
        .uni-del-confirm:hover:not(:disabled) { background: #9c3024; }
        .uni-del-confirm:disabled { opacity: 0.45; cursor: not-allowed; }
      `}</style>
    </div>
  )
}
