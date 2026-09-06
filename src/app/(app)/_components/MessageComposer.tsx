'use client'

import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import {
  continueList,
  formatPreviewHtml,
  toggleList,
  toggleWrap,
  type ListMarker,
  type WrapMarker,
} from './message-format'

/* ── design tokens (matches the rest of the dashboard) ── */
const S = {
  mono: 'var(--font-geist-mono)',
  ink: '#1A1915',
  ink2: '#3F3D36',
  ink3: '#6B6960',
  ink4: '#9C9A90',
  border: '#E8E6DE',
  accent: '#1F7A4D',
  accentSoft: '#F2F8F4',
  surface: '#FFFFFF',
  surface2: '#F6F5F1',
  danger: '#B91C1C',
}

const MIN_HEIGHT = 40
const MAX_HEIGHT = 420

interface ToolbarAction {
  key: string
  label: string
  title: string
  apply: (sel: { value: string; start: number; end: number }) => { value: string; start: number; end: number }
  style?: CSSProperties
}

const WRAP_ACTIONS: ReadonlyArray<{ key: string; label: string; title: string; marker: WrapMarker; style?: CSSProperties }> = [
  { key: 'bold', label: 'B', title: 'Bold  (Cmd/Ctrl+B)  →  *text*', marker: '*', style: { fontWeight: 700 } },
  { key: 'italic', label: 'I', title: 'Italic  (Cmd/Ctrl+I)  →  _text_', marker: '_', style: { fontStyle: 'italic' } },
  { key: 'strike', label: 'S', title: 'Strikethrough  →  ~text~', marker: '~', style: { textDecoration: 'line-through' } },
  { key: 'code', label: '‹›', title: 'Monospace  →  `text`', marker: '`', style: { fontFamily: S.mono, fontSize: 11 } },
]

const LIST_ACTIONS: ReadonlyArray<{ key: string; label: string; title: string; marker: ListMarker }> = [
  { key: 'bullet', label: '• List', title: 'Bulleted list', marker: 'bullet' },
  { key: 'number', label: '1. List', title: 'Numbered list', marker: 'number' },
]

export interface MessageComposerProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Show the formatting toolbar. Off for boxes that hold instructions, not messages. */
  toolbar?: boolean
  /** Minimum height in pixels — the box grows past this as the text does. */
  minHeight?: number
  maxHeight?: number
  maxLength?: number
  disabled?: boolean
  /** Called on Cmd/Ctrl+Enter, for forms that submit from the composer. */
  onSubmit?: () => void
  /** Merged into the textarea's inline styles. */
  textareaStyle?: CSSProperties
  ariaLabel?: string
  /** Hint shown under the box (e.g. "Cmd+Enter to preview"). */
  hint?: string
}

/**
 * Multi-line message editor with Messenger-safe formatting.
 *
 * Stays plain text: the toolbar only inserts the markup Messenger itself
 * renders (`*bold*`, `_italic_`, `~strike~`, `` `code` ``, "• "/"1. " lines), so
 * the value can be stored and sent exactly as-is.
 */
export function MessageComposer({
  value,
  onChange,
  placeholder,
  toolbar = true,
  minHeight = MIN_HEIGHT,
  maxHeight = MAX_HEIGHT,
  maxLength,
  disabled = false,
  onSubmit,
  textareaStyle,
  ariaLabel,
  hint,
}: MessageComposerProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const previewId = useId()

  /* auto-grow */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minHeight), maxHeight)}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [value, minHeight, maxHeight])

  const applyToSelection = useCallback(
    (transform: ToolbarAction['apply']) => {
      const el = ref.current
      if (!el || disabled) return
      const next = transform({ value, start: el.selectionStart, end: el.selectionEnd })
      onChange(next.value)
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(next.start, next.end)
      })
    },
    [value, onChange, disabled],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'Enter') {
        if (onSubmit) {
          e.preventDefault()
          onSubmit()
        }
        return
      }
      if (!toolbar) return
      if (mod && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault()
        applyToSelection((sel) => toggleWrap(sel, '*'))
        return
      }
      if (mod && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault()
        applyToSelection((sel) => toggleWrap(sel, '_'))
        return
      }
      if (e.key === 'Enter' && !e.shiftKey && !mod) {
        const el = e.currentTarget
        const next = continueList({ value, start: el.selectionStart, end: el.selectionEnd })
        if (next) {
          e.preventDefault()
          applyToSelection(() => next)
        }
      }
    },
    [applyToSelection, onSubmit, toolbar, value],
  )

  const overLimit = maxLength != null && value.length > maxLength

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      {toolbar && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {WRAP_ACTIONS.map((a) => (
            <ToolbarButton
              key={a.key}
              label={a.label}
              title={a.title}
              disabled={disabled}
              style={a.style}
              onClick={() => applyToSelection((sel) => toggleWrap(sel, a.marker))}
            />
          ))}
          <span style={{ width: 1, height: 16, background: S.border, margin: '0 3px' }} />
          {LIST_ACTIONS.map((a) => (
            <ToolbarButton
              key={a.key}
              label={a.label}
              title={a.title}
              disabled={disabled}
              onClick={() => applyToSelection((sel) => toggleList(sel, a.marker))}
            />
          ))}
          <span style={{ flex: 1 }} />
          <ToolbarButton
            label={showPreview ? 'Edit' : 'Preview'}
            title="Preview how Messenger renders this"
            active={showPreview}
            disabled={disabled}
            onClick={() => setShowPreview((p) => !p)}
          />
        </div>
      )}

      {showPreview ? (
        <div
          id={previewId}
          style={{
            width: '100%',
            minHeight,
            padding: '10px 12px',
            borderRadius: 8,
            border: `1px solid ${S.border}`,
            background: S.surface2,
            fontSize: 13.5,
            lineHeight: 1.5,
            color: S.ink2,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            boxSizing: 'border-box',
          }}
          dangerouslySetInnerHTML={{ __html: formatPreviewHtml(value) || '<span style="opacity:.5">Nothing to preview</span>' }}
        />
      ) : (
        <textarea
          ref={ref}
          value={value}
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          style={{
            width: '100%',
            minHeight,
            padding: '10px 12px',
            borderRadius: 8,
            border: `1px solid ${overLimit ? S.danger : S.border}`,
            fontFamily: 'inherit',
            fontSize: 13.5,
            lineHeight: 1.5,
            color: S.ink,
            background: disabled ? S.surface2 : S.surface,
            outline: 'none',
            resize: 'none',
            boxSizing: 'border-box',
            ...textareaStyle,
          }}
        />
      )}

      {(hint || maxLength != null) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: S.ink4 }}>
          <span>{hint}</span>
          {maxLength != null && (
            <span style={{ fontFamily: S.mono, color: overLimit ? S.danger : S.ink4 }}>
              {value.length}/{maxLength}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function ToolbarButton({
  label,
  title,
  onClick,
  disabled,
  active,
  style,
}: {
  label: string
  title: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  style?: CSSProperties
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault() /* keep the textarea selection */}
      onClick={onClick}
      style={{
        minWidth: 26,
        height: 24,
        padding: '0 7px',
        borderRadius: 6,
        border: `1px solid ${active ? S.accent : S.border}`,
        background: active ? S.accentSoft : S.surface,
        color: active ? S.accent : S.ink3,
        fontSize: 12,
        lineHeight: 1,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {label}
    </button>
  )
}
