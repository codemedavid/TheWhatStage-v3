'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { listProjectWorkspaces, type WorkspaceOption } from '../actions/projects'

interface Props {
  /**
   * Create the project in the chosen workspace and navigate to it.
   * `workspaceId` is undefined when the user has no workspaces yet (the server
   * resolves the default). Thrown errors are caught here and surfaced through
   * {@link Props.onError} — the caller does not need its own try/catch.
   */
  onPick: (workspaceId?: string) => Promise<void>
  /** Report a create/load failure (or `''` to clear) through the caller's error UI. */
  onError?: (message: string) => void
  label: string
  pendingLabel?: string
  className?: string
  style?: CSSProperties
  icon?: ReactNode
  disabled?: boolean
}

const DEFAULT_DOT = '#9c9a90'
const MENU_MIN_WIDTH = 220
const VIEWPORT_MARGIN = 8
// Must out-stack the drawers the picker renders inside: the lead drawer (z-100)
// and the action-page submission drawer aside (z-101). The menu portals to
// <body>, so a lower value would paint behind those opaque panels.
const MENU_Z_INDEX = 120
const CREATE_FAILED = 'Failed to create project'
const LOAD_FAILED = 'Failed to load workspaces'
// Workspaces change rarely; cache one fetch across every picker instance (there
// can be one per submission row) and across opens, so only the first interaction
// on a page pays the round-trip. Short TTL keeps a freshly-added workspace from
// staying hidden for long.
const CACHE_TTL_MS = 30_000

let workspaceCache: { at: number; data: Promise<WorkspaceOption[]> } | null = null

function loadWorkspacesCached(): Promise<WorkspaceOption[]> {
  const now = Date.now()
  if (workspaceCache && now - workspaceCache.at < CACHE_TTL_MS) return workspaceCache.data
  const data = listProjectWorkspaces().catch((err) => {
    workspaceCache = null // don't cache a failure
    throw err
  })
  workspaceCache = { at: now, data }
  return data
}

// "Create project" trigger that lets the user choose the destination workspace.
// Workspaces are prefetched on hover/focus and the menu opens immediately (with a
// brief loading row on a cold first interaction). With a single workspace the
// menu is skipped and the project is created directly. The menu is portalled to
// <body> so a host card's `overflow-hidden` can't clip it.
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
  const [busy, setBusy] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)
  const openRef = useRef(false)

  useEffect(() => {
    openRef.current = open
  }, [open])

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

  // Move focus into the menu once its items render, for keyboard users.
  useEffect(() => {
    if (open && workspaces && workspaces.length > 0) firstItemRef.current?.focus()
  }, [open, workspaces])

  const ensureLoaded = (): Promise<WorkspaceOption[]> =>
    loadWorkspacesCached().then((list) => {
      setWorkspaces(list)
      return list
    })

  // Warm the cache on intent so the menu is ready by the time it's clicked. The
  // module cache dedupes, so sweeping the cursor across many rows costs one fetch.
  const prefetch = () => {
    void ensureLoaded().catch(() => {
      /* surfaced on the real click */
    })
  }

  const anchorToTrigger = () => {
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) {
      setPos({ top: rect.bottom + 4, right: Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.right) })
    }
  }

  const pick = async (workspaceId?: string) => {
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
    if (busy || disabled) return
    if (open) {
      setOpen(false)
      return
    }
    onError?.('') // clear any stale error from a previous attempt
    anchorToTrigger()

    // Warm cache: decide instantly without flashing a menu.
    if (workspaces) {
      if (workspaces.length <= 1) await pick(workspaces[0]?.id)
      else setOpen(true)
      return
    }

    // Cold: open immediately with a loading row, then fill in / auto-pick.
    setOpen(true)
    let list: WorkspaceOption[]
    try {
      list = await ensureLoaded()
    } catch (err) {
      setOpen(false)
      onError?.(err instanceof Error ? err.message : LOAD_FAILED)
      return
    }
    if (!openRef.current) return // user dismissed while loading
    if (list.length <= 1) {
      setOpen(false)
      await pick(list[0]?.id)
    }
  }

  const triggerLabel = busy ? pendingLabel : label

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={handleClick}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        disabled={disabled || busy}
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
      {open && pos && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popRef}
            id={menuId}
            onClick={(e) => e.stopPropagation()}
            className="overflow-hidden rounded-lg py-1 shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
            style={{ position: 'fixed', top: pos.top, right: pos.right, minWidth: MENU_MIN_WIDTH, zIndex: MENU_Z_INDEX, background: 'var(--ws-surface)', border: '1px solid var(--ws-border)' }}
          >
            <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--ws-ink-4)]">
              Add to workspace
            </div>
            {workspaces === null ? (
              <div className="px-3 py-2 text-[12.5px] text-[color:var(--ws-ink-4)]">Loading…</div>
            ) : workspaces.length === 0 ? (
              <button
                ref={firstItemRef}
                type="button"
                onClick={() => pick(undefined)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-[color:var(--ws-ink-2)] transition-colors hover:bg-[color:var(--ws-surface-2)] focus:bg-[color:var(--ws-surface-2)] focus:outline-none"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DEFAULT_DOT }} aria-hidden="true" />
                <span className="flex-1 truncate">Default workspace</span>
              </button>
            ) : (
              workspaces.map((w, i) => (
                <button
                  key={w.id}
                  ref={i === 0 ? firstItemRef : undefined}
                  type="button"
                  onClick={() => pick(w.id)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-[color:var(--ws-ink-2)] transition-colors hover:bg-[color:var(--ws-surface-2)] focus:bg-[color:var(--ws-surface-2)] focus:outline-none"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: w.color ?? DEFAULT_DOT }}
                    aria-hidden="true"
                  />
                  <span className="flex-1 truncate">{w.name}</span>
                  {w.isDefault && (
                    <span className="shrink-0 rounded-sm bg-[color:var(--ws-surface-3)] px-1 text-[10px] font-medium text-[color:var(--ws-ink-3)]">
                      Default
                    </span>
                  )}
                </button>
              ))
            )}
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
