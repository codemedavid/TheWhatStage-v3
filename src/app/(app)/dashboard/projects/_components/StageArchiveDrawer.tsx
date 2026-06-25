'use client'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { unarchiveProject } from '../actions/projects'
import { formatMoney } from '../_lib/format'
import type { ProjectCardRow } from '../_lib/queries'
import type { ProjectStageRow } from '@/lib/projects/types'

const CLOSE_ANIM_MS = 200

/**
 * Dedicated archive panel for ONE stage: opened from the stage header's
 * "N archived" badge. Lists that stage's archived projects with Unarchive +
 * open-in-drawer, keeping the board itself clean. Mirrors StageSettingsDrawer's
 * portal + slide/close-animation shell.
 */
export function StageArchiveDrawer({
  stage,
  archived,
  onClose,
  onOpen,
}: {
  stage: ProjectStageRow
  archived: ProjectCardRow[]
  onClose: () => void
  onOpen: (project: ProjectCardRow) => void
}) {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const closingRef = useRef(false)

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!mounted) return
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [mounted])

  const requestClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setVisible(false)
    setTimeout(onClose, CLOSE_ANIM_MS)
  }, [onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  if (!mounted) return null

  const theme = document.querySelector('[data-leads-root]')?.getAttribute('data-theme') ?? 'light'

  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end" data-leads-root data-theme={theme}>
      <div className="absolute inset-0" onClick={requestClose} aria-hidden style={{ background: 'rgba(0,0,0,0.32)' }} />
      <div
        className="relative flex h-full w-full max-w-[420px] flex-col overflow-hidden shadow-2xl transition-transform duration-200 ease-out will-change-transform"
        style={{
          background: 'var(--lead-page)',
          transform: visible ? 'translateX(0)' : 'translateX(100%)',
        }}
        role="dialog"
        aria-label={`Archived projects in ${stage.name}`}
      >
        <header
          className="flex items-center justify-between gap-3 border-b px-4 py-3"
          style={{ borderColor: 'var(--lead-line)' }}
        >
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--lead-muted)' }}>
              Archived
            </div>
            <h2 className="truncate text-[15px] font-semibold" style={{ color: 'var(--lead-ink)' }}>
              {stage.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close archived panel"
            className="lead-focus rounded-md p-1"
            style={{ color: 'var(--lead-muted)' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {archived.length === 0 ? (
            <p className="mt-8 text-center text-[13px]" style={{ color: 'var(--lead-muted)' }}>
              No archived projects in this stage.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {archived.map((project) => (
                <ArchivedRow key={project.id} project={project} onOpen={onOpen} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ArchivedRow({
  project,
  onOpen,
}: {
  project: ProjectCardRow
  onOpen: (project: ProjectCardRow) => void
}) {
  const [pending, start] = useTransition()

  const restore = (e: React.MouseEvent) => {
    e.stopPropagation()
    start(async () => {
      try { await unarchiveProject(project.id) }
      catch { /* surfaced on next load; revalidatePath refreshes the board */ }
    })
  }

  return (
    <li
      onClick={() => onOpen(project)}
      className="lead-focus cursor-pointer rounded-xl p-3"
      style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] font-medium leading-snug" style={{ color: 'var(--lead-ink)' }}>
          {project.title}
        </span>
        {project.value != null && (
          <span className="shrink-0 text-[12px] font-semibold" style={{ color: 'var(--lead-muted)' }}>
            {formatMoney(project.value, project.currency)}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-[11.5px]" style={{ color: 'var(--lead-muted)' }}>
          {project.lead_name ?? 'Unknown customer'}
        </span>
        <button
          type="button"
          onClick={restore}
          disabled={pending}
          className="shrink-0 text-[11.5px] font-medium disabled:opacity-50"
          style={{ color: 'var(--lead-accent)' }}
        >
          {pending ? 'Restoring…' : 'Unarchive'}
        </button>
      </div>
    </li>
  )
}
