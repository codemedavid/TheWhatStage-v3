'use client'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { updateProjectStage, deleteProjectStage } from '../actions/stages'
import { SequenceConfig } from './SequenceConfig'
import type { ProjectStageKind, ProjectStageRow } from '@/lib/projects/types'

type Tab = 'settings' | 'followup'

const CLOSE_ANIM_MS = 200

// Curated palette for the stage dot — keeps colors on-brand instead of a raw
// color picker. `null` clears the dot.
const COLORS: { label: string; value: string | null }[] = [
  { label: 'None', value: null },
  { label: 'Slate', value: '#64748b' },
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Violet', value: '#8b5cf6' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Green', value: '#16a34a' },
  { label: 'Red', value: '#dc2626' },
]

const KINDS: { label: string; value: ProjectStageKind }[] = [
  { label: 'Open', value: 'open' },
  { label: 'Won', value: 'won' },
  { label: 'Lost', value: 'lost' },
]

const inputStyle = { borderColor: 'var(--lead-line)', background: 'var(--lead-surface)', color: 'var(--lead-ink)' } as const
const inputCls = 'w-full rounded-md border px-2.5 py-1.5 text-[13px]'
const labelCls = 'mb-1 block text-[12px] font-medium'

export function StageSettingsDrawer({ stage, onClose }: { stage: ProjectStageRow; onClose: () => void }) {
  // Portal target only exists on the client; gate the first render so SSR never
  // references `document`. Mirrors ProjectDrawer.
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
        <StageSettingsBody stage={stage} onClose={requestClose} />
      </div>
    </div>,
    document.body,
  )
}

function StageSettingsBody({ stage, onClose }: { stage: ProjectStageRow; onClose: () => void }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('settings')
  const [name, setName] = useState(stage.name)
  const [color, setColor] = useState<string | null>(stage.color)
  const [kind, setKind] = useState<ProjectStageKind>(stage.kind ?? 'open')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, start] = useTransition()

  const save = () => {
    setError(null); setSaved(false)
    if (!name.trim()) { setError('Name is required'); return }
    start(async () => {
      try {
        await updateProjectStage(stage.id, { name: name.trim(), color, kind })
        setSaved(true)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save')
      }
    })
  }

  const remove = () => {
    if (!confirm(`Delete the "${stage.name}" stage? Its projects move to your default stage.`)) return
    setError(null)
    start(async () => {
      try { await deleteProjectStage(stage.id); onClose(); router.refresh() }
      catch (e) { setError(e instanceof Error ? e.message : 'Failed to delete') }
    })
  }

  return (
    <>
      <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--lead-line)' }}>
        <h2 className="text-[16px] font-semibold" style={{ color: 'var(--lead-ink)' }}>Stage settings</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5" style={{ color: 'var(--lead-muted)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-1 border-b px-3" style={{ borderColor: 'var(--lead-line)' }}>
        {(['settings', 'followup'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="px-3 py-2.5 text-[12.5px] font-medium"
            style={{
              color: tab === t ? 'var(--lead-accent)' : 'var(--lead-muted)',
              borderBottom: tab === t ? '2px solid var(--lead-accent)' : '2px solid transparent',
            }}
          >
            {t === 'followup' ? 'Follow-up' : 'Settings'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'settings' && (
          <div className="space-y-4">
            <div>
              <label className={labelCls} style={{ color: 'var(--lead-body)' }}>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputCls} style={inputStyle} />
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

            <div>
              <label className={labelCls} style={{ color: 'var(--lead-body)' }}>Kind</label>
              <div className="flex gap-2">
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => setKind(k.value)}
                    className="rounded-md border px-3 py-1.5 text-[12.5px] font-medium"
                    style={{
                      borderColor: kind === k.value ? 'var(--lead-accent)' : 'var(--lead-line)',
                      background: kind === k.value ? 'var(--lead-accent-soft)' : 'var(--lead-surface)',
                      color: kind === k.value ? 'var(--lead-accent)' : 'var(--lead-body)',
                    }}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px]" style={{ color: 'var(--lead-muted)' }}>
                Won/Lost stages mark deals as closed for value reporting.
              </p>
            </div>

            {error && <div className="text-[12px]" style={{ color: '#dc2626' }}>{error}</div>}
            {saved && <div className="text-[12px]" style={{ color: '#16a34a' }}>Saved.</div>}

            <div className="flex items-center justify-between pt-1">
              {stage.is_default ? (
                <span className="text-[11.5px]" style={{ color: 'var(--lead-muted)' }}>Default stage — can&apos;t be deleted</span>
              ) : (
                <button type="button" onClick={remove} disabled={pending} className="text-[12.5px] font-medium" style={{ color: '#dc2626' }}>Delete stage</button>
              )}
              <button type="button" onClick={save} disabled={pending} className="rounded-md px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--lead-accent)' }}>
                {pending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {tab === 'followup' && <SequenceConfig stageId={stage.id} stageName={stage.name} />}
      </div>
    </>
  )
}
