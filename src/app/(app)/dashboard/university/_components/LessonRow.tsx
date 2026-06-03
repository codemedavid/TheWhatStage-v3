'use client'

import { useId } from 'react'
import {
  PROVIDER_LABELS,
  PROVIDER_INPUT_HINTS,
  isValidProviderRef,
} from '@/lib/university/providers'
import { VIDEO_PROVIDERS, type VideoProvider } from '@/lib/university/types'
import { slugify } from '@/lib/university/slug'
import { EmbedPreview } from './EmbedPreview'
import type { LessonDraftState } from './LessonList'

interface Props {
  lesson: LessonDraftState
  index: number
  count: number
  expanded: boolean
  onToggle: () => void
  onChange: (patch: Partial<LessonDraftState>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  // native HTML5 DnD wiring on the ⠿ handle
  dragHandleProps: {
    draggable: boolean
    onDragStart: (e: React.DragEvent) => void
    onDragEnd: (e: React.DragEvent) => void
  }
  isDragOver: boolean
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragLeave: () => void
}

/** mm:ss ⇄ seconds helpers (CMS-side only). */
function secondsToClock(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function clockToSeconds(value: string): number | null {
  const raw = value.trim()
  if (!raw) return null
  // Accept "mm:ss", "h:mm:ss", or a plain seconds integer.
  const parts = raw.split(':').map((p) => p.trim())
  if (parts.length === 1) {
    const n = Number(parts[0])
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
  }
  if (parts.some((p) => p === '' || !/^\d+$/.test(p))) return null
  const nums = parts.map(Number)
  let total = 0
  for (const n of nums) total = total * 60 + n
  return total >= 0 ? total : null
}

export function LessonRow({
  lesson,
  index,
  count,
  expanded,
  onToggle,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  dragHandleProps,
  isDragOver,
  onDragOver,
  onDrop,
  onDragLeave,
}: Props) {
  const fieldId = useId()
  const validRef = lesson.providerInput.trim().length > 0 && isValidProviderRef(lesson.provider, lesson.providerInput)
  const needsVideo = lesson.providerInput.trim().length === 0

  const handleTitle = (value: string) => {
    onChange({
      title: value,
      // Auto-slug from title until the slug has been hand-edited.
      slug: lesson.slugTouched ? lesson.slug : slugify(value),
    })
  }

  return (
    <div
      className={`uni-lesson-drag${isDragOver ? ' drag-over' : ''}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
      style={{
        border: '1px solid var(--ws-border)',
        borderRadius: 12,
        background: 'var(--ws-surface)',
        marginBottom: 10,
      }}
    >
      {/* Collapsed summary header — always visible */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
        }}
      >
        <button
          type="button"
          aria-label="Drag to reorder"
          title="Drag to reorder"
          {...dragHandleProps}
          style={{
            cursor: 'grab',
            border: 'none',
            background: 'transparent',
            color: 'var(--ws-ink-4)',
            fontSize: 16,
            lineHeight: 1,
            padding: '4px 2px',
            touchAction: 'none',
          }}
        >
          ⠿
        </button>

        <span
          style={{
            fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
            fontSize: 12,
            color: 'var(--ws-ink-4)',
            minWidth: 18,
            textAlign: 'right',
          }}
        >
          {index + 1}
        </span>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            border: 'none',
            background: 'transparent',
            textAlign: 'left',
            cursor: 'pointer',
            color: 'var(--ws-ink)',
            padding: 0,
          }}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 14.5,
              fontWeight: 600,
            }}
          >
            {lesson.title.trim() || <span style={{ color: 'var(--ws-ink-4)', fontWeight: 500 }}>Untitled lesson</span>}
          </span>

          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ws-ink-3)', fontSize: 12, flexShrink: 0 }}>
            ▶ {PROVIDER_LABELS[lesson.provider]}
          </span>

          {secondsToClock(lesson.durationSeconds) && (
            <span
              style={{
                fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
                fontSize: 12,
                color: 'var(--ws-ink-3)',
                flexShrink: 0,
              }}
            >
              {secondsToClock(lesson.durationSeconds)}
            </span>
          )}

          {lesson.isPreview && (
            <span title="Free preview" style={{ color: 'var(--ws-accent)', fontSize: 13, flexShrink: 0 }}>
              ★ Preview
            </span>
          )}

          {needsVideo && (
            <span
              title="This lesson needs a video"
              aria-label="Needs a video"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--ws-warn)',
                flexShrink: 0,
              }}
            />
          )}

          <span style={{ color: 'var(--ws-ink-4)', flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }}>
            ⌄
          </span>
        </button>

        {/* Up/Down fallback (keyboard + non-DnD) */}
        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
          <button
            type="button"
            aria-label="Move lesson up"
            disabled={index === 0}
            onClick={onMoveUp}
            style={miniBtn(index === 0)}
          >
            ▲
          </button>
          <button
            type="button"
            aria-label="Move lesson down"
            disabled={index === count - 1}
            onClick={onMoveDown}
            style={miniBtn(index === count - 1)}
          >
            ▼
          </button>
        </span>
      </div>

      {/* Expanded edit body */}
      {expanded && (
        <div style={{ padding: '4px 14px 16px', borderTop: '1px solid var(--ws-border)' }}>
          <div className="ap-field">
            <div className="ap-field-label">
              <label htmlFor={`${fieldId}-title`}>Lesson title</label>
            </div>
            <input
              id={`${fieldId}-title`}
              className="ap-input"
              type="text"
              maxLength={200}
              value={lesson.title}
              placeholder="e.g. Setting the tone"
              onChange={(e) => handleTitle(e.target.value)}
            />
          </div>

          <div className="ap-field-row" style={{ marginTop: 12 }}>
            <div className="ap-field">
              <div className="ap-field-label">
                <label htmlFor={`${fieldId}-provider`}>Provider</label>
              </div>
              <select
                id={`${fieldId}-provider`}
                className="ap-select"
                value={lesson.provider}
                onChange={(e) => onChange({ provider: e.target.value as VideoProvider })}
              >
                {VIDEO_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>

            <div className="ap-field">
              <div className="ap-field-label">
                <label htmlFor={`${fieldId}-duration`}>
                  Duration <span className="ap-opt">optional</span>
                </label>
              </div>
              <input
                id={`${fieldId}-duration`}
                className="ap-input mono"
                type="text"
                inputMode="numeric"
                placeholder="mm:ss"
                defaultValue={secondsToClock(lesson.durationSeconds)}
                onBlur={(e) => onChange({ durationSeconds: clockToSeconds(e.target.value) })}
              />
            </div>
          </div>

          <div className="ap-field" style={{ marginTop: 12 }}>
            <div className="ap-field-label">
              <label htmlFor={`${fieldId}-ref`}>Video URL or ID</label>
              {lesson.providerInput.trim().length > 0 && (
                <span
                  className={validRef ? 'uni-validity-ok' : 'uni-validity-bad'}
                  aria-live="polite"
                  style={{ marginLeft: 8, fontSize: 13, fontWeight: 600 }}
                >
                  {validRef ? '✓ Looks good' : '✕ Not recognized'}
                </span>
              )}
            </div>
            <input
              id={`${fieldId}-ref`}
              className="ap-input"
              type="text"
              maxLength={1000}
              value={lesson.providerInput}
              placeholder={PROVIDER_INPUT_HINTS[lesson.provider]}
              onChange={(e) => onChange({ providerInput: e.target.value })}
            />
            <div className="ap-field-help">{PROVIDER_INPUT_HINTS[lesson.provider]}</div>
          </div>

          <div className="ap-field" style={{ marginTop: 12 }}>
            <div className="ap-field-label">
              <label htmlFor={`${fieldId}-summary`}>
                Summary <span className="ap-opt">optional</span>
              </label>
            </div>
            <textarea
              id={`${fieldId}-summary`}
              className="ap-textarea"
              rows={2}
              maxLength={2000}
              value={lesson.summary}
              placeholder="A sentence about what this lesson covers."
              onChange={(e) => onChange({ summary: e.target.value })}
            />
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              marginTop: 14,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={lesson.isPreview}
              onChange={(e) => onChange({ isPreview: e.target.checked })}
              style={{ marginTop: 2, accentColor: 'var(--ws-accent)' }}
            />
            <span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ws-ink)' }}>Free preview lesson</span>
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ws-ink-3)', marginTop: 2 }}>
                Visible to everyone, even when the course is gated.
              </span>
            </span>
          </label>

          {/* Lazy embed — only the expanded (focused) row mounts an iframe */}
          <div style={{ marginTop: 14 }}>
            <div className="ap-field-label" style={{ marginBottom: 6 }}>
              Preview
            </div>
            <EmbedPreview provider={lesson.provider} providerInput={lesson.providerInput} />
          </div>

          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="ap-btn ap-btn-danger-ghost ap-btn-sm" onClick={onRemove}>
              Remove lesson
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function miniBtn(disabled: boolean): React.CSSProperties {
  return {
    border: '1px solid var(--ws-border)',
    background: 'var(--ws-surface)',
    borderRadius: 5,
    width: 22,
    height: 16,
    fontSize: 8,
    lineHeight: 1,
    color: disabled ? 'var(--ws-ink-4)' : 'var(--ws-ink-3)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    padding: 0,
  }
}
