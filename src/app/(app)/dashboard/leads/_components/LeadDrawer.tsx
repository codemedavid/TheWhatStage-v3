'use client'
import { forwardRef, useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { createLead, updateLead, deleteLead } from '../actions/leads'
import {
  loadLatestStageRationale,
  type LatestStageRationale,
} from '../actions/messenger'
import type { StageRow, FieldDefRow, LeadRow, CampaignOption } from '../_lib/queries'
import { ConversationPanel } from './ConversationPanel'
import { CommentsPanel } from './CommentsPanel'
import { SubmissionsPanel } from './SubmissionsPanel'
import { OrdersPanel } from './OrdersPanel'
import { CartsPanel } from './CartsPanel'
import { StageJourney } from './StageJourney'

type Tab =
  | 'details'
  | 'conversation'
  | 'comments'
  | 'orders'
  | 'carts'
  | 'appointments'
  | 'forms'

type FormShape = {
  id: string
  stage_id: string
  name: string
  email: string | null
  phone: string | null
  company: string | null
  job_title: string | null
  source: string | null
  estimated_value: number | null
  notes: string | null
  custom_fields: Record<string, unknown>
  campaign_id: string | null
}

export function LeadDrawer({
  mode, lead, stages, fieldDefs, campaigns, onClose, presetStageId,
}: {
  mode: 'create' | 'edit'
  lead?: LeadRow
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
  campaigns: CampaignOption[]
  onClose: () => void
  presetStageId?: string
}) {
  const [pending, start] = useTransition()
  const [deleting, startDelete] = useTransition()
  const [, startTransition] = useTransition()
  const [mounted, setMounted] = useState(false)
  const [tab, setTab] = useState<Tab>('details')
  const formRef = useRef<HTMLFormElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<FormShape>(
    lead
      ? { ...lead, campaign_id: lead.campaign_id ?? null }
      : {
          id: '',
          stage_id: presetStageId ?? stages[0]?.id ?? '',
          name: '', email: '', phone: '', company: '', job_title: '',
          source: '', estimated_value: null, notes: '', custom_fields: {},
          campaign_id: null,
        },
  )

  // Track whether the user explicitly chose a campaign value. In create mode
  // we leave campaign_id off the payload when untouched so the server's
  // weighted-random pick runs; once the user picks anything (a campaign or
  // "Main bot"), we honor that explicit choice.
  const [campaignTouched, setCampaignTouched] = useState(false)
  const set = <K extends keyof FormShape>(k: K, v: FormShape[K]) =>
    setForm((f) => ({ ...f, [k]: v }))
  const setCF = (key: string, v: unknown) =>
    setForm((f) => ({ ...f, custom_fields: { ...f.custom_fields, [key]: v } }))

  useEffect(() => {
    startTransition(() => setMounted(true))
    firstFieldRef.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [startTransition])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        formRef.current?.requestSubmit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    start(async () => {
      const base = {
        stage_id: form.stage_id,
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        company: form.company || null,
        job_title: form.job_title || null,
        source: form.source || null,
        estimated_value:
          form.estimated_value === null || form.estimated_value === undefined
            ? null
            : Number(form.estimated_value),
        notes: form.notes || null,
        custom_fields: form.custom_fields,
      }
      if (mode === 'create') {
        const payload = campaignTouched
          ? { ...base, campaign_id: form.campaign_id }
          : base
        await createLead(payload)
      } else {
        await updateLead(form.id, { ...base, campaign_id: form.campaign_id })
      }
      onClose()
    })
  }

  const onDelete = () => {
    if (!confirm('Delete this lead? This cannot be undone.')) return
    startDelete(async () => {
      await deleteLead(form.id)
      onClose()
    })
  }

  if (!mounted) return null

  const root = document.querySelector('[data-leads-root]') as HTMLElement | null
  const theme = root?.getAttribute('data-theme') ?? 'light'

  return createPortal(
    <div
      data-leads-root
      data-theme={theme}
      className="fixed inset-0 z-[100] flex justify-end"
      style={{ background: 'rgba(20,17,11,0.45)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form
        ref={formRef}
        onSubmit={submit}
        className="flex h-full w-full max-w-[520px] flex-col"
        style={{
          background: 'var(--lead-surface)',
          boxShadow: 'var(--lead-shadow-lg)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-6 py-4"
          style={{ borderBottom: '1px solid var(--lead-line)' }}
        >
          <div className="flex-1">
            <div
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--lead-muted)' }}
            >
              {mode === 'create' ? 'New lead' : 'Edit lead'}
            </div>
            <div
              className="mt-0.5 truncate text-[16px] font-semibold"
              style={{ color: 'var(--lead-ink)' }}
            >
              {form.name || 'Untitled'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="lead-focus inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors"
            style={{ color: 'var(--lead-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--lead-surface-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs (edit only) */}
        {mode === 'edit' && (
          <div
            className="flex gap-4 px-6"
            style={{ borderBottom: '1px solid var(--lead-line)' }}
          >
            {(
              [
                'details',
                'conversation',
                'comments',
                'orders',
                'carts',
                'appointments',
                'forms',
              ] as const
            ).map((t) => {
              const active = tab === t
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className="lead-focus relative h-9 text-[12.5px] font-medium transition-colors"
                  style={{
                    color: active ? 'var(--lead-ink)' : 'var(--lead-muted)',
                  }}
                >
                  {t === 'details'
                    ? 'Details'
                    : t === 'conversation'
                      ? 'Conversation'
                      : t === 'comments'
                        ? 'Comments'
                        : t === 'orders'
                          ? 'Orders'
                          : t === 'carts'
                            ? 'Carts'
                            : t === 'appointments'
                              ? 'Appointments'
                              : 'Forms'}
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-x-0 -bottom-px h-[2px]"
                      style={{ background: 'var(--lead-accent)' }}
                    />
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {mode === 'edit' && tab === 'conversation' ? (
            <ConversationPanel leadId={form.id} />
          ) : mode === 'edit' && tab === 'comments' ? (
            <CommentsPanel leadId={form.id} />
          ) : mode === 'edit' && tab === 'orders' ? (
            <OrdersPanel leadId={form.id} />
          ) : mode === 'edit' && tab === 'carts' ? (
            <CartsPanel leadId={form.id} />
          ) : mode === 'edit' && tab === 'appointments' ? (
            <SubmissionsPanel
              leadId={form.id}
              kinds={['booking']}
              emptyMessage="No appointments booked yet."
            />
          ) : mode === 'edit' && tab === 'forms' ? (
            <SubmissionsPanel
              leadId={form.id}
              kinds={['form', 'qualification']}
              emptyMessage="No form or qualification submissions yet."
            />
          ) : (
            <>
          {mode === 'edit' && form.id && (
            <StageRationale leadId={form.id} stageId={form.stage_id} />
          )}
          <Section label="Stage">
            <SegmentedStages
              stages={stages}
              value={form.stage_id}
              onChange={(v) => set('stage_id', v)}
            />
          </Section>

          <Section label="Campaign">
            <Select
              value={form.campaign_id ?? ''}
              onChange={(v) => {
                setCampaignTouched(true)
                set('campaign_id', v === '' ? null : v)
              }}
              options={[
                { value: '', label: 'Main bot (no campaign)' },
                ...campaigns.map((c) => ({
                  value: c.id,
                  label:
                    c.enabled && c.status === 'active'
                      ? c.name
                      : `${c.name} (${c.status})`,
                })),
              ]}
            />
            {mode === 'create' && !campaignTouched && (
              <div
                className="mt-1.5 text-[11.5px]"
                style={{ color: 'var(--lead-faint)' }}
              >
                Auto-pick from active campaigns on save (falls back to main bot).
              </div>
            )}
          </Section>

          <Section label="Details">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name" required full>
                <Input ref={firstFieldRef} value={form.name} onChange={(v) => set('name', v)} required />
              </Field>
              <Field label="Email">
                <Input value={form.email ?? ''} onChange={(v) => set('email', v)} type="email" />
              </Field>
              <Field label="Phone">
                <Input value={form.phone ?? ''} onChange={(v) => set('phone', v)} />
              </Field>
              {mode === 'edit' && (() => {
                const detectedEmails = (lead?.emails ?? []).filter(
                  (e) => e && e !== form.email,
                )
                const detectedPhones = (lead?.phones ?? []).filter(
                  (p) => p && p !== form.phone,
                )
                if (!detectedEmails.length && !detectedPhones.length) return null
                return (
                  <div className="col-span-2 space-y-2">
                    <DetectedRow
                      label="Detected emails"
                      values={detectedEmails}
                      onPick={(v) => set('email', v)}
                      activeLabel="Use as primary"
                    />
                    <DetectedRow
                      label="Detected phones"
                      values={detectedPhones}
                      onPick={(v) => set('phone', v)}
                      activeLabel="Use as primary"
                    />
                  </div>
                )
              })()}
              <Field label="Company">
                <Input value={form.company ?? ''} onChange={(v) => set('company', v)} />
              </Field>
              <Field label="Job title">
                <Input value={form.job_title ?? ''} onChange={(v) => set('job_title', v)} />
              </Field>
              <Field label="Source">
                <Input value={form.source ?? ''} onChange={(v) => set('source', v)} />
              </Field>
              <Field label="Estimated value">
                <Input
                  type="number"
                  value={form.estimated_value === null ? '' : String(form.estimated_value)}
                  onChange={(v) => set('estimated_value', v === '' ? null : Number(v))}
                  prefix="₱"
                />
              </Field>
            </div>
          </Section>

          {mode === 'edit' && form.id && (
            <Section label="Stage journey">
              <StageJourney leadId={form.id} stageId={form.stage_id} />
            </Section>
          )}

          <Section label="Notes">
            <textarea
              value={form.notes ?? ''}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Anything worth remembering"
              className="lead-focus w-full rounded-lg px-3 py-2 text-[13px] outline-none placeholder:text-[color:var(--lead-faint)]"
              style={{
                background: 'var(--lead-surface)',
                border: '1px solid var(--lead-line)',
                color: 'var(--lead-ink)',
                minHeight: 96,
                resize: 'vertical',
              }}
            />
          </Section>

          {fieldDefs.length > 0 && (
            <Section label="Custom fields">
              <div className="grid grid-cols-2 gap-3">
                {fieldDefs.map((fd) => (
                  <Field key={fd.id} label={fd.label}>
                    {fd.type === 'select' && fd.options ? (
                      <Select
                        value={String(form.custom_fields[fd.key] ?? '')}
                        onChange={(v) => setCF(fd.key, v)}
                        options={[{ value: '', label: '—' }, ...fd.options.map((o) => ({ value: o, label: o }))]}
                      />
                    ) : (
                      <Input
                        type={fd.type === 'number' ? 'number' : fd.type === 'date' ? 'date' : 'text'}
                        value={String(form.custom_fields[fd.key] ?? '')}
                        onChange={(v) => setCF(fd.key, fd.type === 'number' ? Number(v) : v)}
                      />
                    )}
                  </Field>
                ))}
              </div>
            </Section>
          )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-2 px-6 py-3"
          style={{ borderTop: '1px solid var(--lead-line)' }}
        >
          {mode === 'edit' && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting || pending}
              className="lead-focus inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-medium transition-colors disabled:opacity-50"
              style={{ color: 'var(--lead-danger)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--lead-danger-soft)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              Delete
            </button>
          )}
          <span className="ml-auto hidden text-[11px] tabular-nums sm:inline" style={{ color: 'var(--lead-faint)' }}>
            <kbd className="font-mono">⌘</kbd> + <kbd className="font-mono">Enter</kbd> to save
          </span>
          <button
            type="button"
            onClick={onClose}
            className="lead-focus inline-flex h-8 items-center rounded-full px-3.5 text-[12.5px] font-medium transition-colors"
            style={{
              color: 'var(--lead-body)',
              border: '1px solid var(--lead-line)',
              background: 'var(--lead-surface)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--lead-surface-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--lead-surface)')}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || !form.name.trim()}
            className="lead-focus inline-flex h-8 items-center rounded-full px-3.5 text-[12.5px] font-medium text-white transition-colors disabled:opacity-50"
            style={{ background: 'var(--lead-accent)' }}
            onMouseEnter={(e) => !pending && form.name.trim() && (e.currentTarget.style.background = 'var(--lead-accent-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--lead-accent)')}
          >
            {pending ? 'Saving' : mode === 'create' ? 'Create lead' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

function StageRationale({ leadId, stageId }: { leadId: string; stageId: string }) {
  const [data, setData] = useState<LatestStageRationale | null | 'loading'>('loading')
  const [, startTransition] = useTransition()
  useEffect(() => {
    let cancelled = false
    startTransition(() => setData('loading'))
    loadLatestStageRationale(leadId)
      .then((r) => {
        if (!cancelled) startTransition(() => setData(r))
      })
      .catch(() => {
        if (!cancelled) startTransition(() => setData(null))
      })
    return () => {
      cancelled = true
    }
  }, [leadId, stageId, startTransition])

  if (data === 'loading' || data === null) return null
  const isAi = data.source === 'classifier' || data.source === 'deep_classifier'
  const when = new Date(data.created_at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  return (
    <div
      className="mb-6 rounded-lg px-3 py-2.5"
      style={{
        background: 'var(--lead-surface-2)',
        border: '1px solid var(--lead-line)',
      }}
    >
      <div
        className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--lead-muted)' }}
      >
        <span>{isAi ? 'AI placed in this stage' : 'Moved to this stage'}</span>
        {isAi && data.confidence && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[9.5px]"
            style={{
              background: 'var(--lead-surface)',
              border: '1px solid var(--lead-line)',
              color: 'var(--lead-body)',
            }}
          >
            {data.confidence}
          </span>
        )}
        <span className="ml-auto font-normal normal-case tracking-normal" style={{ color: 'var(--lead-faint)' }}>
          {when}
        </span>
      </div>
      <div className="text-[12.5px] leading-relaxed" style={{ color: 'var(--lead-body)' }}>
        {data.reason?.trim() || (isAi ? 'No reason recorded.' : 'Manually moved.')}
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 last:mb-0">
      <div
        className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--lead-muted)' }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function SegmentedStages({
  stages, value, onChange,
}: {
  stages: StageRow[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="lead-scroll flex gap-1 overflow-x-auto">
      {stages.map((s) => {
        const active = s.id === value
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(s.id)}
            className="lead-focus h-8 shrink-0 rounded-full px-3 text-[12.5px] font-medium transition-colors"
            style={{
              color: active ? '#fff' : 'var(--lead-body)',
              background: active ? 'var(--lead-accent)' : 'var(--lead-surface)',
              border: `1px solid ${active ? 'var(--lead-accent)' : 'var(--lead-line)'}`,
            }}
          >
            {s.name}
          </button>
        )
      })}
    </div>
  )
}

function DetectedRow({
  label, values, onPick, activeLabel,
}: {
  label: string
  values: string[]
  onPick: (v: string) => void
  activeLabel: string
}) {
  if (!values.length) return null
  return (
    <div>
      <div
        className="mb-1 text-[11px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--lead-muted)' }}
      >
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onPick(v)}
            title={activeLabel}
            className="lead-focus inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] transition-colors"
            style={{
              background: 'var(--lead-surface-2)',
              border: '1px solid var(--lead-line)',
              color: 'var(--lead-body)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--lead-accent-ring)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--lead-surface-2)')}
          >
            <span className="font-mono tabular-nums">{v}</span>
            <span style={{ color: 'var(--lead-faint)' }}>↑</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Field({
  label, children, required, full,
}: {
  label: string
  children: React.ReactNode
  required?: boolean
  full?: boolean
}) {
  return (
    <label className={`block ${full ? 'col-span-2' : ''}`}>
      <span
        className="mb-1 block text-[11.5px] font-medium"
        style={{ color: 'var(--lead-muted)' }}
      >
        {label}{required && <span style={{ color: 'var(--lead-accent)' }}> *</span>}
      </span>
      {children}
    </label>
  )
}

const Input = forwardRef<HTMLInputElement, {
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
  prefix?: string
}>(function Input({ value, onChange, type = 'text', required, prefix }, ref) {
  return (
    <div
      className="flex h-9 items-center rounded-lg px-2.5 transition-colors focus-within:[box-shadow:0_0_0_2px_var(--lead-page),_0_0_0_4px_var(--lead-accent-ring)]"
      style={{
        background: 'var(--lead-surface)',
        border: '1px solid var(--lead-line)',
      }}
    >
      {prefix && (
        <span className="mr-1 text-[13px]" style={{ color: 'var(--lead-muted)' }}>{prefix}</span>
      )}
      <input
        ref={ref}
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent text-[13px] outline-none placeholder:text-[color:var(--lead-faint)]"
        style={{ color: 'var(--lead-ink)' }}
      />
    </div>
  )
})

function Select({
  value, onChange, options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="lead-focus h-9 w-full rounded-lg px-2 text-[13px] outline-none"
      style={{
        background: 'var(--lead-surface)',
        border: '1px solid var(--lead-line)',
        color: 'var(--lead-ink)',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
