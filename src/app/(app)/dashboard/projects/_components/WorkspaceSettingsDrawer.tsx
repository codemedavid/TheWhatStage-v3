'use client'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { createWorkspace, updateWorkspace, deleteWorkspace } from '../actions/workspaces'
import type { ProjectWorkspaceRow } from '@/lib/projects/types'

const CLOSE_ANIM_MS = 200

// Same curated palette as the stage dot, keeping workspace accents on-brand.
const COLORS: { label: string; value: string | null }[] = [
  { label: 'None', value: null },
  { label: 'Slate', value: '#64748b' },
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Violet', value: '#8b5cf6' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Green', value: '#16a34a' },
  { label: 'Red', value: '#dc2626' },
]

const inputStyle = { borderColor: 'var(--lead-line)', background: 'var(--lead-surface)', color: 'var(--lead-ink)' } as const
const inputCls = 'w-full rounded-md border px-2.5 py-1.5 text-[13px]'
const labelCls = 'mb-1 block text-[12px] font-medium'

type Props =
  | { mode: 'create'; onClose: () => void }
  | { mode: 'edit'; workspace: ProjectWorkspaceRow; onClose: () => void }

export function WorkspaceSettingsDrawer(props: Props) {
  const { onClose } = props
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
      <div className="absolute inset-0" onClick={requestClose} aria-hidden />
      <div
        className="relative flex h-full w-full max-w-[480px] flex-col overflow-hidden shadow-2xl transition-transform duration-200 ease-out will-change-transform"
        style={{
          background: 'color-mix(in srgb, var(--lead-page) 80%, transparent)',
          backdropFilter: 'blur(16px) saturate(160%)',
          WebkitBackdropFilter: 'blur(16px) saturate(160%)',
          borderLeft: '1px solid var(--lead-line)',
          transform: visible ? 'translateX(0)' : 'translateX(100%)',
        }}
        role="dialog"
        aria-modal="true"
      >
        <WorkspaceSettingsBody props={props} onClose={requestClose} />
      </div>
    </div>,
    document.body,
  )
}

function WorkspaceSettingsBody({ props, onClose }: { props: Props; onClose: () => void }) {
  const router = useRouter()
  const isEdit = props.mode === 'edit'
  const workspace = isEdit ? props.workspace : null
  const [name, setName] = useState(workspace?.name ?? '')
  const [description, setDescription] = useState(workspace?.description ?? '')
  const [color, setColor] = useState<string | null>(workspace?.color ?? null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()

  const payload = () => ({
    name: name.trim(),
    description: description.trim() || null,
    color,
  })

  const submit = () => {
    setError(null); setSaved(false)
    if (!name.trim()) { setError('Name is required'); return }
    start(async () => {
      if (isEdit && workspace) {
        const res = await updateWorkspace(workspace.id, payload())
        if (res.ok) { setSaved(true); router.refresh() }
        else setError(res.error)
      } else {
        const res = await createWorkspace(payload())
        if (res.ok) { onClose(); router.push(`/dashboard/projects/${res.id}`) }
        else setError(res.error)
      }
    })
  }

  const remove = () => {
    if (!workspace) return
    if (!confirm(`Delete the "${workspace.name}" workspace? It must be empty of projects first.`)) return
    setError(null)
    start(async () => {
      const res = await deleteWorkspace(workspace.id)
      if (res.ok) { onClose(); router.push('/dashboard/projects'); router.refresh() }
      else setError(res.error)
    })
  }

  return (
    <>
      <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--lead-line)' }}>
        <h2 className="text-[16px] font-semibold" style={{ color: 'var(--lead-ink)' }}>
          {isEdit ? 'Workspace settings' : 'New workspace'}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5" style={{ color: 'var(--lead-muted)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="space-y-4">
          {!isEdit && (
            <p className="text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
              Starts with the default stages. To reuse an existing workflow instead, use “Duplicate” on a workspace.
            </p>
          )}

          <div>
            <label className={labelCls} style={{ color: 'var(--lead-body)' }}>Name</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputCls} style={inputStyle} />
          </div>

          <div>
            <label className={labelCls} style={{ color: 'var(--lead-body)' }}>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} className={inputCls} style={inputStyle} />
          </div>

          <div>
            <label className={labelCls} style={{ color: 'var(--lead-body)' }}>Color</label>
            <div className="flex flex-wrap items-center gap-2">
              {COLORS.map((c) => {
                const active = color === c.value
                return (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => setColor(c.value)}
                    aria-label={c.label}
                    aria-pressed={active}
                    className="flex h-7 w-7 items-center justify-center rounded-full"
                    style={{
                      background: c.value ?? 'transparent',
                      border: c.value
                        ? `2px solid ${active ? 'var(--lead-ink)' : 'transparent'}`
                        : `1px dashed var(--lead-line-strong)`,
                      boxShadow: active && c.value ? '0 0 0 2px var(--lead-page)' : undefined,
                    }}
                  >
                    {!c.value && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--lead-muted)" strokeWidth="2" strokeLinecap="round" aria-hidden>
                        <path d="M5 12h14" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {error && <div className="text-[12px]" style={{ color: '#dc2626' }}>{error}</div>}
          {saved && <div className="text-[12px]" style={{ color: '#16a34a' }}>Saved.</div>}

          <div className="flex items-center justify-between pt-1">
            {isEdit && workspace?.is_default ? (
              <span className="text-[11.5px]" style={{ color: 'var(--lead-muted)' }}>Default workspace — can&apos;t be deleted</span>
            ) : isEdit ? (
              <button type="button" onClick={remove} disabled={pending} className="text-[12.5px] font-medium" style={{ color: '#dc2626' }}>Delete workspace</button>
            ) : (
              <span />
            )}
            <button type="button" onClick={submit} disabled={pending} className="rounded-md px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--lead-accent)' }}>
              {pending ? 'Saving…' : isEdit ? 'Save' : 'Create workspace'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
