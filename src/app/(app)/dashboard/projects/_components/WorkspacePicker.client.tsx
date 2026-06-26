'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { listProjectWorkspaces, type WorkspaceOption } from '../actions/projects'

interface Props {
  /**
   * Create the project in the chosen workspace and navigate to it. Thrown errors
   * are caught here and surfaced through {@link Props.onError} — the caller does
   * not need its own try/catch.
   */
  onPick: (workspaceId: string) => Promise<void>
  /** Report a create/load failure (or `''` to clear) through the caller's error UI. */
  onError?: (message: string) => void
  label: string
  pendingLabel?: string
  className?: string
  style?: CSSProperties
  icon?: ReactNode
  disabled?: boolean
}

const DEFAULT_DOT = '#CBD5E1'
const MENU_MIN_WIDTH = 220
const VIEWPORT_MARGIN = 8
// Must out-stack the drawers the picker is rendered inside: the lead drawer
// (z-100) and the action-page submission drawer aside (z-101). The menu portals
// to <body>, so a lower value would paint behind those opaque panels.
const MENU_Z_INDEX = 120
const CREATE_FAILED = 'Failed to create project'

// "Create project" trigger that lets the user choose the destination workspace.
// On first open it lazily loads the user's workspaces; with a single workspace it
// skips the menu and creates immediately. The menu is portalled to <body> so a
// host card's `overflow-hidden` can't clip it — mirrors the anchored-popover
// pattern in leads/_components/LeadsTable.client.tsx.
export function WorkspacePicker({
  onPick,
  onError,
  label,
  pendingLabel = 'Creating…',
  className,
  style,
  icon,
  disabled,
}: Props) {
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t)) return
      if (popRef.current?.contains(t)) return
      setOpen(false)
    }
    // Capture-phase so the picker consumes Escape before the surrounding drawer's
    // own (window/document) Escape handler can collapse the whole drawer.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      setOpen(false)
      btnRef.current?.focus()
    }
    const close = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  // Move focus into the menu on open so keyboard users land on the first option.
  useEffect(() => {
    if (open) firstItemRef.current?.focus()
  }, [open])

  const anchorToTrigger = () => {
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) {
      setPos({ top: rect.bottom + 4, right: Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.right) })
    }
  }

  const pick = async (workspaceId: string) => {
    setOpen(false)
    setBusy(true)
    try {
      await onPick(workspaceId)
      // Success navigates away and unmounts us; leave the trigger disabled so a
      // second create can't fire during the in-flight route transition.
    } catch (e) {
      setBusy(false)
      onError?.(e instanceof Error ? e.message : CREATE_FAILED)
    }
  }

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (busy || loading || disabled) return
    if (open) {
      setOpen(false)
      return
    }
    onError?.('') // clear any stale error from a previous attempt

    let list = workspaces
    if (!list) {
      setLoading(true)
      try {
        list = await listProjectWorkspaces()
        setWorkspaces(list)
      } catch (err) {
        onError?.(err instanceof Error ? err.message : 'Failed to load workspaces')
        return
      } finally {
        setLoading(false)
      }
    }

    // Nothing to choose — create straight into the only (default) workspace.
    if (list.length <= 1) {
      if (list[0]) await pick(list[0].id)
      else onError?.('No workspace available')
      return
    }

    anchorToTrigger() // re-read position now (post-fetch) so the menu isn't stale
    setOpen(true)
  }

  const triggerLabel = busy ? pendingLabel : loading ? 'Loading…' : label

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={handleClick}
        disabled={disabled || busy || loading}
        className={className}
        style={style}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        {icon}
        {triggerLabel}
        <Chevron open={open} />
      </button>
      {open && pos && workspaces && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popRef}
            id={menuId}
            onClick={(e) => e.stopPropagation()}
            className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
            style={{ position: 'fixed', top: pos.top, right: pos.right, minWidth: MENU_MIN_WIDTH, zIndex: MENU_Z_INDEX }}
          >
            <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
              Add to workspace
            </div>
            {workspaces.map((w, i) => (
              <button
                key={w.id}
                ref={i === 0 ? firstItemRef : undefined}
                type="button"
                onClick={() => pick(w.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-[#374151] transition-colors hover:bg-[#F9FAFB] focus:bg-[#F9FAFB] focus:outline-none"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: w.color ?? DEFAULT_DOT }}
                  aria-hidden="true"
                />
                <span className="flex-1 truncate">{w.name}</span>
                {w.isDefault && (
                  <span className="shrink-0 rounded-sm bg-[#EFF6FF] px-1 text-[10px] font-medium text-[#2563EB]">
                    Default
                  </span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 10 10"
      aria-hidden="true"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms', flexShrink: 0 }}
    >
      <path
        d="M2 3.5L5 6.5L8 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
