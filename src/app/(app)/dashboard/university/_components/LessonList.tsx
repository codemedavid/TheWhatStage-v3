'use client'

import { useRef, useState } from 'react'
import type { VideoProvider } from '@/lib/university/types'
import { LessonRow } from './LessonRow'

/**
 * Editor-side draft shape for one lesson. `clientId` is a stable key for React
 * (drag/reorder/add/remove); `id` is the DB id (null for new rows). `slugTouched`
 * stops the auto-slug-from-title once the operator hand-edits the slug. None of
 * the editor-only fields are sent to the server — CourseEditor maps to the
 * saveCourseAction lesson shape on Save.
 */
export type LessonDraftState = {
  clientId: string
  id: string | null
  slug: string
  slugTouched: boolean
  title: string
  summary: string
  provider: VideoProvider
  durationSeconds: number | null
  isPreview: boolean
  providerInput: string
}

export function makeEmptyLesson(): LessonDraftState {
  return {
    clientId:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `new-${Math.random().toString(36).slice(2)}`,
    id: null,
    slug: '',
    slugTouched: false,
    title: '',
    summary: '',
    provider: 'youtube',
    durationSeconds: null,
    isPreview: false,
    providerInput: '',
  }
}

type RemovedRecord = { lesson: LessonDraftState; index: number }

interface Props {
  lessons: LessonDraftState[]
  onChange: (next: LessonDraftState[]) => void
  /** clientId of the lesson to auto-expand (e.g. a freshly added one). */
  newlyAddedId?: string | null
}

export function LessonList({ lessons, onChange, newlyAddedId }: Props) {
  // Default: the single newest row is expanded; everything else collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const init = new Set<string>()
    if (newlyAddedId) init.add(newlyAddedId)
    else if (lessons.length === 1) init.add(lessons[0].clientId)
    return init
  })
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [lastRemoved, setLastRemoved] = useState<RemovedRecord | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const toggle = (clientId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(clientId)) next.delete(clientId)
      else next.add(clientId)
      return next
    })

  const patchAt = (index: number, patch: Partial<LessonDraftState>) => {
    const next = lessons.slice()
    const current = next[index]
    // Track slug hand-edits so auto-slug stops.
    const slugTouched =
      patch.slug !== undefined && patch.slugTouched === undefined && !('title' in patch)
        ? true
        : patch.slugTouched ?? current.slugTouched
    next[index] = { ...current, ...patch, slugTouched }
    onChange(next)
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= lessons.length || from === to) return
    const next = lessons.slice()
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }

  const addLesson = () => {
    const fresh = makeEmptyLesson()
    onChange([...lessons, fresh])
    setExpanded((prev) => new Set(prev).add(fresh.clientId))
  }

  const removeAt = (index: number) => {
    const removed = lessons[index]
    const next = lessons.slice()
    next.splice(index, 1)
    onChange(next)
    setLastRemoved({ lesson: removed, index })
    if (undoTimer.current) clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => setLastRemoved(null), 8000)
  }

  const undoRemove = () => {
    if (!lastRemoved) return
    const next = lessons.slice()
    const at = Math.min(lastRemoved.index, next.length)
    next.splice(at, 0, lastRemoved.lesson)
    onChange(next)
    setLastRemoved(null)
    if (undoTimer.current) clearTimeout(undoTimer.current)
  }

  return (
    <div>
      <div role="list" aria-label="Lessons">
        {lessons.map((lesson, i) => (
          <LessonRow
            key={lesson.clientId}
            lesson={lesson}
            index={i}
            count={lessons.length}
            expanded={expanded.has(lesson.clientId)}
            onToggle={() => toggle(lesson.clientId)}
            onChange={(patch) => patchAt(i, patch)}
            onRemove={() => removeAt(i)}
            onMoveUp={() => move(i, i - 1)}
            onMoveDown={() => move(i, i + 1)}
            isDragOver={dragOverIndex === i && dragIndex !== null && dragIndex !== i}
            dragHandleProps={{
              draggable: true,
              onDragStart: (e) => {
                setDragIndex(i)
                e.dataTransfer.effectAllowed = 'move'
                // Firefox requires data to be set for DnD to fire.
                try {
                  e.dataTransfer.setData('text/plain', String(i))
                } catch {
                  /* noop */
                }
              },
              onDragEnd: () => {
                setDragIndex(null)
                setDragOverIndex(null)
              },
            }}
            onDragOver={(e) => {
              if (dragIndex === null) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (dragOverIndex !== i) setDragOverIndex(i)
            }}
            onDragLeave={() => {
              if (dragOverIndex === i) setDragOverIndex(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragIndex !== null) move(dragIndex, i)
              setDragIndex(null)
              setDragOverIndex(null)
            }}
          />
        ))}
      </div>

      {lessons.length === 0 && (
        <p style={{ color: 'var(--ws-ink-3)', fontSize: 13.5, margin: '4px 0 12px' }}>
          No lessons yet. A course needs at least one playable lesson before it can go live.
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
        <button type="button" className="ap-btn ap-btn-secondary ap-btn-sm" onClick={addLesson}>
          + Add lesson
        </button>

        {lastRemoved && (
          <span
            role="status"
            aria-live="polite"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              color: 'var(--ws-ink-3)',
            }}
          >
            Lesson removed.
            <button
              type="button"
              onClick={undoRemove}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--ws-accent-ink)',
                fontWeight: 600,
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: 0,
              }}
            >
              Undo
            </button>
          </span>
        )}
      </div>
    </div>
  )
}
