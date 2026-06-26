'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { duplicateWorkspace } from '../actions/workspaces'
import { WorkspaceSettingsDrawer } from './WorkspaceSettingsDrawer'
import type { ProjectWorkspaceRow } from '@/lib/projects/types'

export function WorkspaceSwitcher({
  workspaces,
  current,
}: {
  workspaces: ProjectWorkspaceRow[]
  current: ProjectWorkspaceRow
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const duplicate = () => {
    setOpen(false)
    setError(null)
    start(async () => {
      const res = await duplicateWorkspace(current.id)
      if (res.ok) router.push(`/dashboard/projects/${res.id}`)
      else setError(res.error)
    })
  }

  const menuItemCls = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px]'

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        className="lead-focus inline-flex items-center gap-1.5 rounded-md px-2 py-1"
        style={{ border: '1px solid var(--lead-line)', background: 'var(--lead-surface)' }}
      >
        {current.color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: current.color }} />}
        <span className="lead-display text-[20px]" style={{ color: 'var(--lead-ink)' }}>
          {pending ? 'Duplicating…' : current.name}
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: 'var(--lead-muted)' }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {error && (
        <div className="absolute left-0 top-full z-50 mt-1 max-w-xs rounded-md px-2.5 py-1.5 text-[11.5px] shadow-md" style={{ background: 'var(--lead-page)', border: '1px solid #fecaca', color: '#dc2626' }} role="alert">
          {error}
        </div>
      )}

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-50 mt-1 w-64 overflow-hidden rounded-xl p-1.5 shadow-xl"
          style={{ background: 'var(--lead-page)', border: '1px solid var(--lead-line)' }}
        >
          <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--lead-muted)' }}>
            Workspaces
          </div>
          <div className="max-h-60 overflow-y-auto">
            {workspaces.map((w) => (
              <Link
                key={w.id}
                href={`/dashboard/projects/${w.id}`}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`${menuItemCls} hover:bg-[color:var(--lead-accent-tint)]`}
                style={{ color: 'var(--lead-ink)' }}
              >
                {w.color
                  ? <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: w.color }} />
                  : <span className="h-2.5 w-2.5 shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === current.id && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--lead-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </Link>
            ))}
          </div>

          <div className="my-1 border-t" style={{ borderColor: 'var(--lead-line)' }} />

          <button type="button" role="menuitem" onClick={() => { setOpen(false); setEditing(true) }} className={`${menuItemCls} hover:bg-[color:var(--lead-accent-tint)]`} style={{ color: 'var(--lead-body)' }}>
            Workspace settings
          </button>
          <button type="button" role="menuitem" onClick={duplicate} className={`${menuItemCls} hover:bg-[color:var(--lead-accent-tint)]`} style={{ color: 'var(--lead-body)' }}>
            Duplicate this workspace
          </button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setCreating(true) }} className={`${menuItemCls} hover:bg-[color:var(--lead-accent-tint)]`} style={{ color: 'var(--lead-body)' }}>
            New workspace
          </button>
          <Link href="/dashboard/projects" role="menuitem" onClick={() => setOpen(false)} className={`${menuItemCls} hover:bg-[color:var(--lead-accent-tint)]`} style={{ color: 'var(--lead-muted)' }}>
            All workspaces
          </Link>
        </div>
      )}

      {creating && <WorkspaceSettingsDrawer mode="create" onClose={() => setCreating(false)} />}
      {editing && <WorkspaceSettingsDrawer mode="edit" workspace={current} onClose={() => setEditing(false)} />}
    </div>
  )
}
