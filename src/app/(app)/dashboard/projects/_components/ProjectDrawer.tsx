'use client'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createProject, updateProject, deleteProject, archiveProject, unarchiveProject, searchLeads, type LeadOption } from '../actions/projects'
import { SubmissionsPanel } from '../../leads/_components/SubmissionsPanel'
import { ConversationPanel } from '../../leads/_components/ConversationPanel'
import { SequenceConfig } from './SequenceConfig'
import type { ProjectCardRow } from '../_lib/queries'
import type { ProjectStageRow } from '@/lib/projects/types'

type Props =
  | { mode: 'create'; stages: ProjectStageRow[]; createStageId: string; onClose: () => void }
  | { mode: 'edit'; project: ProjectCardRow; stages: ProjectStageRow[]; onClose: () => void }

type Tab = 'overview' | 'submissions' | 'conversation' | 'followup'

const CLOSE_ANIM_MS = 200

export function ProjectDrawer(props: Props) {
  const { onClose } = props
  // Portal target only exists on the client; gate the first render so the
  // deep-link drawer never references `document` during SSR.
  const [mounted, setMounted] = useState(false)
  // `visible` drives the enter/exit transition: false → off-screen, true → in.
  const [visible, setVisible] = useState(false)
  const closingRef = useRef(false)

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), [])

  // Flip to visible on the frame after mount so the CSS transition runs from
  // the off-screen state instead of snapping straight to open.
  useEffect(() => {
    if (!mounted) return
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [mounted])

  // Slide the panel out, then tell the parent to unmount once the animation
  // has finished — so closing feels as smooth as opening.
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

  // Lock background scroll while the drawer is open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  if (!mounted) return null

  const theme = document.querySelector('[data-leads-root]')?.getAttribute('data-theme') ?? 'light'

  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end" data-leads-root data-theme={theme}>
      {/* Transparent click-catcher — no dimming, so the board behind stays at
          full brightness and remains visible/readable while the drawer is open.
          The panel's shadow provides the depth separation. */}
      <div
        className="absolute inset-0"
        onClick={requestClose}
        aria-hidden
      />
      <div
        className="relative flex h-full w-full max-w-[560px] flex-col overflow-hidden shadow-2xl transition-transform duration-200 ease-out will-change-transform"
        style={{
          // Frosted glass: a translucent sheet over a blur so the project board
          // behind stays visible instead of a solid white wall, while the form
          // text stays readable.
          background: 'color-mix(in srgb, var(--lead-page) 80%, transparent)',
          backdropFilter: 'blur(16px) saturate(160%)',
          WebkitBackdropFilter: 'blur(16px) saturate(160%)',
          borderLeft: '1px solid var(--lead-line)',
          transform: visible ? 'translateX(0)' : 'translateX(100%)',
        }}
        role="dialog"
        aria-modal="true"
      >
        {props.mode === 'create'
          ? <CreateBody stages={props.stages} createStageId={props.createStageId} onClose={requestClose} />
          : <EditBody project={props.project} stages={props.stages} onClose={requestClose} />}
      </div>
    </div>,
    document.body,
  )
}

function DrawerHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--lead-line)' }}>
      <h2 className="text-[16px] font-semibold" style={{ color: 'var(--lead-ink)' }}>{title}</h2>
      <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5" style={{ color: 'var(--lead-muted)' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

const inputStyle = { borderColor: 'var(--lead-line)', background: 'var(--lead-surface)', color: 'var(--lead-ink)' } as const
const inputCls = 'w-full rounded-md border px-2.5 py-1.5 text-[13px]'
const labelCls = 'mb-1 block text-[12px] font-medium'

function EditBody({ project, stages, onClose }: { project: ProjectCardRow; stages: ProjectStageRow[]; onClose: () => void }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overview')
  const [title, setTitle] = useState(project.title)
  const [value, setValue] = useState(project.value != null ? String(project.value) : '')
  const [description, setDescription] = useState(project.description ?? '')
  const [aiInstructions, setAiInstructions] = useState(project.ai_instructions ?? '')
  const [notes, setNotes] = useState(project.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const stage = stages.find((s) => s.id === project.stage_id)

  const save = () => {
    setError(null)
    start(async () => {
      try {
        await updateProject(project.id, {
          title: title.trim(),
          value: value.trim() === '' ? null : Number(value),
          description: description.trim() || null,
          ai_instructions: aiInstructions.trim() || null,
          notes: notes.trim() || null,
        })
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save')
      }
    })
  }

  const remove = () => {
    if (!confirm('Delete this project?')) return
    start(async () => {
      try { await deleteProject(project.id); onClose(); router.refresh() }
      catch (e) { setError(e instanceof Error ? e.message : 'Failed to delete') }
    })
  }

  const toggleArchive = () => {
    start(async () => {
      try {
        if (project.is_archived) await unarchiveProject(project.id)
        else await archiveProject(project.id)
        onClose()
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to archive')
      }
    })
  }

  return (
    <>
      <DrawerHeader title={project.title} onClose={onClose} />
      <div className="flex items-center gap-1 border-b px-3" style={{ borderColor: 'var(--lead-line)' }}>
        {(['overview', 'submissions', 'conversation', 'followup'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="px-3 py-2.5 text-[12.5px] font-medium capitalize"
            style={{
              color: tab === t ? 'var(--lead-accent)' : 'var(--lead-muted)',
              borderBottom: tab === t ? '2px solid var(--lead-accent)' : '2px solid transparent',
            }}
          >
            {t === 'followup' ? 'Follow-up' : t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'overview' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
              <span>Customer:</span>
              <Link href={`/dashboard/leads?lead=${project.lead_id}`} className="font-medium underline" style={{ color: 'var(--lead-accent)' }}>
                {project.lead_name ?? 'Unknown'}
              </Link>
              {stage && <span className="ml-auto rounded-full px-2 py-0.5 text-[11px]" style={{ background: 'var(--lead-accent-soft)', color: 'var(--lead-accent)' }}>{stage.name}</span>}
            </div>

            {(project.lead_company || project.lead_email || project.lead_phone) && (
              <div
                className="space-y-0.5 rounded-md border px-3 py-2 text-[12px]"
                style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface-2)', color: 'var(--lead-body)' }}
              >
                {project.lead_company && (
                  <div><span style={{ color: 'var(--lead-muted)' }}>Company: </span>{project.lead_company}</div>
                )}
                {project.lead_email && (
                  <div><span style={{ color: 'var(--lead-muted)' }}>Email: </span>{project.lead_email}</div>
                )}
                {project.lead_phone && (
                  <div><span style={{ color: 'var(--lead-muted)' }}>Phone: </span>{project.lead_phone}</div>
                )}
              </div>
            )}

            <div>
              <label className={labelCls} style={{ color: 'var(--lead-body)' }}>Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} style={inputStyle} />
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <label className={labelCls} style={{ color: 'var(--lead-body)' }}>Value ({project.currency})</label>
                <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="0" className={inputCls} style={inputStyle} />
              </div>
            </div>

            <div>
              <label className={labelCls} style={{ color: 'var(--lead-body)' }}>Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} style={inputStyle} />
            </div>

            <div>
              <label className={labelCls} style={{ color: 'var(--lead-accent)' }}>
                AI instructions — what the assistant should know/say about this customer
              </label>
              <textarea
                value={aiInstructions}
                onChange={(e) => setAiInstructions(e.target.value)}
                rows={4}
                placeholder="e.g. This client is price-sensitive and waiting on a revised quote. Emphasize the bundle discount; don't push add-ons."
                className={inputCls}
                style={inputStyle}
              />
              <p className="mt-1 text-[11px]" style={{ color: 'var(--lead-muted)' }}>
                Used to align both the live chatbot and proactive follow-ups for this customer.
              </p>
            </div>

            <div>
              <label className={labelCls} style={{ color: 'var(--lead-body)' }}>Internal notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} style={inputStyle} />
            </div>

            {error && <div className="text-[12px]" style={{ color: '#dc2626' }}>{error}</div>}

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-3">
                <button type="button" onClick={remove} disabled={pending} className="text-[12.5px] font-medium" style={{ color: '#dc2626' }}>Delete</button>
                <button type="button" onClick={toggleArchive} disabled={pending} className="text-[12.5px] font-medium" style={{ color: 'var(--lead-muted)' }}>
                  {project.is_archived ? 'Unarchive' : 'Archive'}
                </button>
              </div>
              <button type="button" onClick={save} disabled={pending} className="rounded-md px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--lead-accent)' }}>
                {pending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {tab === 'submissions' && (
          <SubmissionsPanel
            leadId={project.lead_id}
            emptyMessage="No submissions for this customer yet."
          />
        )}

        {tab === 'conversation' && <ConversationPanel leadId={project.lead_id} />}

        {tab === 'followup' && stage && (
          <SequenceConfig stageId={stage.id} stageName={stage.name} />
        )}
      </div>
    </>
  )
}

function CreateBody({ stages, createStageId, onClose }: { stages: ProjectStageRow[]; createStageId: string; onClose: () => void }) {
  const router = useRouter()
  const [lead, setLead] = useState<LeadOption | null>(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<LeadOption[]>([])
  const [title, setTitle] = useState('')
  const [value, setValue] = useState('')
  const [stageId, setStageId] = useState(createStageId)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (lead) return
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => {
      searchLeads(q).then(setResults).catch(() => setResults([]))
    }, 200)
    return () => { if (searchRef.current) clearTimeout(searchRef.current) }
  }, [q, lead])

  const create = () => {
    setError(null)
    if (!lead) { setError('Pick a customer'); return }
    if (!title.trim()) { setError('Title is required'); return }
    start(async () => {
      try {
        const id = await createProject({
          lead_id: lead.id,
          stage_id: stageId,
          title: title.trim(),
          value: value.trim() === '' ? null : Number(value),
        })
        onClose()
        router.push(`/dashboard/projects?project=${id}`)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create')
      }
    })
  }

  return (
    <>
      <DrawerHeader title="New project" onClose={onClose} />
      <div className="flex-1 space-y-3 overflow-y-auto p-5">
        <div>
          <label className={labelCls} style={{ color: 'var(--lead-body)' }}>Customer</label>
          {lead ? (
            <div className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-[13px]" style={inputStyle}>
              <span>{lead.name}</span>
              <button type="button" onClick={() => { setLead(null); setQ('') }} className="text-[12px]" style={{ color: 'var(--lead-accent)' }}>Change</button>
            </div>
          ) : (
            <>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads by name…" className={inputCls} style={inputStyle} />
              {results.length > 0 && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded-md border" style={{ borderColor: 'var(--lead-line)' }}>
                  {results.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => { setLead(r); if (!title) setTitle(`Project — ${r.name}`) }}
                      className="block w-full px-2.5 py-1.5 text-left text-[13px] hover:bg-[color:var(--lead-accent-tint)]"
                      style={{ color: 'var(--lead-ink)' }}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <label className={labelCls} style={{ color: 'var(--lead-body)' }}>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} style={inputStyle} />
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <label className={labelCls} style={{ color: 'var(--lead-body)' }}>Value</label>
            <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="0" className={inputCls} style={inputStyle} />
          </div>
          <div className="flex-1">
            <label className={labelCls} style={{ color: 'var(--lead-body)' }}>Stage</label>
            <select value={stageId} onChange={(e) => setStageId(e.target.value)} className={inputCls} style={inputStyle}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        {error && <div className="text-[12px]" style={{ color: '#dc2626' }}>{error}</div>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-[12.5px]" style={{ borderColor: 'var(--lead-line)', color: 'var(--lead-body)' }}>Cancel</button>
          <button type="button" onClick={create} disabled={pending} className="rounded-md px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--lead-accent)' }}>
            {pending ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </>
  )
}
