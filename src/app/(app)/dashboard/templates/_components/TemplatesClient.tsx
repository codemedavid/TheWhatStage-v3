'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import {
  countVariables,
  renderTemplate,
  type TemplateButton,
  type TemplateCategory,
  type MessengerMessageTemplateWithCategories,
} from '@/lib/messenger-templates/types'
import {
  createCategory,
  createTemplate,
  deleteCategory,
  deleteTemplate,
  duplicateTemplate,
  listCategories,
  refreshTemplateStatuses,
  resetRejectedTemplates,
  setTemplateCategories,
  submitTemplatesForReview,
  updateTemplate,
} from '../actions'
import { S, inputStyle, btnPrimary, btnSecondary } from './tokens'
import { StatusSpine, type StatusFilter } from './StatusSpine'
import { SelectionBulkBar } from './SelectionBulkBar'
import { TemplateListRow } from './TemplateListRow'
import { PermissionBanner } from './PermissionBanner'
import { CategoryChips } from '../../_components/CategoryChips'
import { useTemplatePolling } from '../_hooks/useTemplatePolling'

type Template = MessengerMessageTemplateWithCategories

interface Props {
  initialTemplates: Template[]
  initialCategories: TemplateCategory[]
  initialStatus?: StatusFilter
  initialSelectedId?: string | null
}

interface DraftState {
  id: string | null
  name: string
  display_name: string
  language: string
  body_text: string
  sample_values: string[]
  buttons: TemplateButton[]
  footer: string
}

function emptyDraft(): DraftState {
  return { id: null, name: '', display_name: '', language: 'en_US', body_text: '', sample_values: [], buttons: [], footer: '' }
}

function fromTemplate(t: Template): DraftState {
  return {
    id: t.id,
    name: t.name,
    display_name: t.display_name,
    language: t.language,
    body_text: t.body_text,
    sample_values: [...t.sample_values],
    buttons: t.buttons.map((b) => ({ ...b })),
    footer: t.footer ?? '',
  }
}

/** Upsert rows into the list by id, preserving order + appending new ones. */
function mergeRows(prev: Template[], rows: Template[]): Template[] {
  if (rows.length === 0) return prev
  const byId = new Map(rows.map((r) => [r.id, r]))
  const merged = prev.map((t) => byId.get(t.id) ?? t)
  for (const r of rows) {
    if (!prev.some((t) => t.id === r.id)) merged.push(r)
  }
  return merged
}

export function TemplatesClient({ initialTemplates, initialCategories, initialStatus, initialSelectedId }: Props) {
  const initialOpen =
    (initialSelectedId && initialTemplates.find((t) => t.id === initialSelectedId)) ||
    initialTemplates[0] ||
    null

  const [templates, setTemplates] = useState<Template[]>(initialTemplates)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus ?? 'all')

  const [categories, setCategories] = useState<TemplateCategory[]>(initialCategories)
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [draftCategoryIds, setDraftCategoryIds] = useState<string[]>(
    () => initialOpen?.categories.map((c) => c.id) ?? [],
  )
  const [newCategoryLabel, setNewCategoryLabel] = useState('')
  const [showNewCategory, setShowNewCategory] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(initialOpen?.id ?? null)
  const [draft, setDraft] = useState<DraftState>(initialOpen ? fromTemplate(initialOpen) : emptyDraft())
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [permissionError, setPermissionError] = useState(false)
  const [resubmitNotice, setResubmitNotice] = useState(false)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  const selected = useMemo(() => templates.find((t) => t.id === selectedId) ?? null, [templates, selectedId])

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: templates.length, draft: 0, pending: 0, approved: 0, rejected: 0, disabled: 0 }
    for (const t of templates) c[t.meta_status] = (c[t.meta_status] ?? 0) + 1
    return c
  }, [templates])

  const visibleTemplates = useMemo(() => {
    return templates.filter((t) => {
      if (statusFilter !== 'all' && t.meta_status !== statusFilter) return false
      if (selectedCategoryIds.length === 0) return true
      return t.categories.some((c) => selectedCategoryIds.includes(c.id))
    })
  }, [templates, statusFilter, selectedCategoryIds])

  // ── live polling of pending templates ──
  const pendingIds = useMemo(() => templates.filter((t) => t.meta_status === 'pending').map((t) => t.id), [templates])
  const runRefresh = useCallback(async (ids: string[]) => {
    const r = await refreshTemplateStatuses(ids)
    if (r.ok && r.data.length) {
      const rows = r.data.map((o) => o.row).filter(Boolean) as Template[]
      setTemplates((prev) => mergeRows(prev, rows))
    }
  }, [])
  const { active: pollingActive } = useTemplatePolling(pendingIds, runRefresh)

  // ── selection helpers ──
  const visibleIds = visibleTemplates.map((t) => t.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))
  // Bulk actions operate ONLY on rows that are both selected AND currently
  // visible, so a selection can never act on rows the user has filtered away.
  const selectedTemplates = visibleTemplates.filter((t) => selectedIds.has(t.id))
  const submittableCount = selectedTemplates.filter((t) => t.meta_status === 'draft' || t.meta_status === 'rejected').length
  const refreshableCount = selectedTemplates.filter((t) => t.meta_status === 'pending').length

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (allVisibleSelected) visibleIds.forEach((id) => n.delete(id))
      else visibleIds.forEach((id) => n.add(id))
      return n
    })
  }
  const clearSelection = () => setSelectedIds(new Set())

  // Make sure a just-saved/created/duplicated row is actually visible: relax
  // the status filter AND the category filter if either would hide it.
  function revealRow(row: Template) {
    if (statusFilter !== 'all' && statusFilter !== row.meta_status) setStatusFilter(row.meta_status)
    if (selectedCategoryIds.length > 0 && !row.categories.some((c) => selectedCategoryIds.includes(c.id))) {
      setSelectedCategoryIds([])
    }
  }

  function openTemplate(t: Template) {
    setIsCreating(false)
    setSelectedId(t.id)
    setDraft(fromTemplate(t))
    setDraftCategoryIds(t.categories.map((c) => c.id))
    setError(null)
    setResubmitNotice(false)
  }

  function startCreate() {
    setIsCreating(true)
    setSelectedId(null)
    setDraft(emptyDraft())
    setDraftCategoryIds([])
    setError(null)
    setResubmitNotice(false)
  }

  // ── editor field helpers ──
  const variableCount = countVariables(draft.body_text)
  const preview = renderTemplate(draft.body_text, draft.sample_values)

  function setSampleValue(idx: number, value: string) {
    const next = [...draft.sample_values]
    next[idx] = value
    setDraft({ ...draft, sample_values: next })
  }
  function setBody(body: string) {
    const count = countVariables(body)
    const samples = [...draft.sample_values]
    while (samples.length < count) samples.push('')
    samples.length = count
    setDraft({ ...draft, body_text: body, sample_values: samples })
  }
  function addButton() {
    if (draft.buttons.length >= 3) return
    setDraft({ ...draft, buttons: [...draft.buttons, { type: 'postback', text: '', payload: '' }] })
  }
  function updateButton(idx: number, patch: Partial<TemplateButton>) {
    const next = [...draft.buttons]
    next[idx] = { ...next[idx], ...patch }
    setDraft({ ...draft, buttons: next })
  }
  function removeButton(idx: number) {
    setDraft({ ...draft, buttons: draft.buttons.filter((_, i) => i !== idx) })
  }

  // ── save (create/update) ──
  function handleSave() {
    setError(null)
    setResubmitNotice(false)
    const input = {
      name: draft.name,
      display_name: draft.display_name,
      language: draft.language,
      body_text: draft.body_text,
      sample_values: draft.sample_values,
      buttons: draft.buttons,
      footer: draft.footer,
    }
    const prevStatus = selected?.meta_status
    startTransition(async () => {
      let row: Template
      if (draft.id) {
        const r = await updateTemplate(draft.id, input)
        if (!r.ok) { setError(r.error); return }
        const c = await setTemplateCategories(draft.id, draftCategoryIds)
        if (!c.ok) { setError(c.error); return }
        row = c.data
        if ((prevStatus === 'pending' || prevStatus === 'approved') && row.meta_status === 'draft') {
          setResubmitNotice(true)
        }
      } else {
        const r = await createTemplate(input)
        if (!r.ok) { setError(r.error); return }
        const c = await setTemplateCategories(r.data.id, draftCategoryIds)
        if (!c.ok) { setError(c.error); return }
        row = c.data
        setIsCreating(false)
      }
      setTemplates((prev) => mergeRows(prev, [row]))
      setSelectedId(row.id)
      setDraft(fromTemplate(row))
      setDraftCategoryIds(row.categories.map((cc) => cc.id))
      revealRow(row)
    })
  }

  function handleDelete() {
    if (!draft.id) return
    if (!confirm('Delete this template? This cannot be undone.')) return
    const id = draft.id
    startTransition(async () => {
      const r = await deleteTemplate(id)
      if (!r.ok) { setError(r.error); return }
      setTemplates((prev) => prev.filter((t) => t.id !== id))
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
      const next = templates.find((t) => t.id !== id) ?? null
      if (next) openTemplate(next)
      else { setSelectedId(null); setDraft(emptyDraft()); setDraftCategoryIds([]) }
    })
  }

  function handleDuplicate() {
    if (!draft.id) return
    const id = draft.id
    startTransition(async () => {
      const r = await duplicateTemplate(id)
      if (!r.ok) { setError(r.error); return }
      setTemplates((prev) => mergeRows(prev, [r.data]))
      openTemplate(r.data)
      revealRow(r.data)
    })
  }

  // editor single-submit — same bulk code path
  function handleSubmit() {
    if (!draft.id) return
    if (!confirm('Submit this template to Meta for review? The body will be locked while pending.')) return
    const id = draft.id
    startTransition(async () => {
      const r = await submitTemplatesForReview([id])
      if (!r.ok) { setError(r.error); return }
      const o = r.data[0]
      if (o?.row) {
        setTemplates((prev) => mergeRows(prev, [o.row!]))
        setDraft(fromTemplate(o.row))
        setDraftCategoryIds(o.row.categories.map((c) => c.id))
        revealRow(o.row)
      }
      if (o?.outcome === 'permission_error') setPermissionError(true)
      else if (o?.outcome === 'rejected') setError(`Meta rejected the submission: ${o.error ?? ''}`)
      else if (o?.outcome === 'error') setError(o.error ?? 'Submission failed.')
    })
  }

  function handleResetRejected() {
    const count = templates.filter((t) => t.meta_status === 'rejected').length
    if (count === 0) return
    if (!confirm(`Move ${count} rejected template${count === 1 ? '' : 's'} back to draft? You can re-submit them once your Facebook app has the right permissions.`)) return
    startTransition(async () => {
      const r = await resetRejectedTemplates()
      if (!r.ok) { setError(r.error); return }
      setTemplates((prev) => mergeRows(prev, r.data.rows))
    })
  }

  // ── bulk actions ──
  async function handleBulkSubmit() {
    const ids = selectedTemplates.filter((t) => t.meta_status === 'draft' || t.meta_status === 'rejected').map((t) => t.id)
    if (ids.length === 0) return
    if (!confirm(`Submit ${ids.length} template${ids.length === 1 ? '' : 's'} to Meta for review?`)) return
    setBulkBusy(true); setError(null); setToast(null)
    const r = await submitTemplatesForReview(ids)
    setBulkBusy(false)
    if (!r.ok) { setError(r.error); return }
    const rows = r.data.map((o) => o.row).filter(Boolean) as Template[]
    setTemplates((prev) => mergeRows(prev, rows))
    const n = (o: string) => r.data.filter((x) => x.outcome === o).length
    if (n('permission_error') > 0) setPermissionError(true)
    const parts: string[] = []
    if (n('approved')) parts.push(`${n('approved')} approved`)
    if (n('pending')) parts.push(`${n('pending')} submitted`)
    if (n('rejected')) parts.push(`${n('rejected')} rejected`)
    if (n('permission_error')) parts.push(`${n('permission_error')} need permission`)
    if (n('error')) parts.push(`${n('error')} skipped`)
    setToast(parts.join(' · ') || 'Done')
    clearSelection()
  }

  async function handleBulkRefresh() {
    const ids = selectedTemplates.filter((t) => t.meta_status === 'pending').map((t) => t.id)
    if (ids.length === 0) return
    setBulkBusy(true); setError(null)
    const r = await refreshTemplateStatuses(ids)
    setBulkBusy(false)
    if (!r.ok) { setError(r.error); return }
    const rows = r.data.map((o) => o.row).filter(Boolean) as Template[]
    setTemplates((prev) => mergeRows(prev, rows))
    setToast(rows.length ? `${rows.length} updated` : 'No changes yet — still pending')
  }

  const locked = selected?.meta_status === 'pending' || selected?.meta_status === 'approved'
  const approvedCount = counts.approved

  return (
    <div style={{ display: 'flex', height: '100vh', background: S.surface2, color: S.ink }}>
      <style>{`
        .tpl-spin { display:inline-block; width:10px; height:10px; border:2px solid currentColor; border-top-color:transparent; border-radius:50%; animation:tplspin .7s linear infinite; box-sizing:border-box; }
        @keyframes tplspin { to { transform: rotate(360deg); } }
      `}</style>

      {/* ── List column ── */}
      <aside style={{ width: 340, borderRight: `1px solid ${S.border}`, background: S.surface, padding: '20px 16px', height: '100vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <h1 style={{ fontFamily: S.serif, fontSize: 28, margin: 0 }}>Templates</h1>
          <button onClick={startCreate} style={{ border: `1px solid ${S.accent}`, background: S.accent, color: '#fff', padding: '6px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
            + New
          </button>
        </div>
        <p style={{ fontSize: 12, color: S.ink3, margin: '0 0 14px' }}>
          Utility templates must be pre-approved by Meta before they can be sent outside the 24-hour window. Select several and submit them in one go.
        </p>

        <StatusSpine value={statusFilter} counts={counts} onChange={(s) => setStatusFilter(s)} pollingActive={pollingActive} />

        {permissionError && <PermissionBanner onDismiss={() => setPermissionError(false)} />}

        {/* Category filter chips (with manage controls) */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: S.ink3, marginBottom: 6 }}>Categories</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {categories.map((c) => {
              const activeCat = selectedCategoryIds.includes(c.id)
              return (
                <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <button
                    onClick={() => setSelectedCategoryIds((prev) => (prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]))}
                    style={{ border: `1px solid ${activeCat ? S.accent : S.border}`, background: activeCat ? S.accentSoft : S.surface, color: activeCat ? S.accent : S.ink2, padding: '4px 8px', borderRadius: 999, fontSize: 11, cursor: 'pointer' }}
                  >
                    {c.label}
                  </button>
                  {!c.is_system && (
                    <button
                      title="Delete category"
                      onClick={async () => {
                        if (!confirm(`Delete category "${c.label}"? Templates tagged with it will be untagged.`)) return
                        const r = await deleteCategory(c.id)
                        if (!r.ok) { setError(r.error); return }
                        setCategories((prev) => prev.filter((x) => x.id !== c.id))
                        setSelectedCategoryIds((prev) => prev.filter((x) => x !== c.id))
                        setDraftCategoryIds((prev) => prev.filter((x) => x !== c.id))
                        setTemplates((prev) => prev.map((t) => ({ ...t, categories: t.categories.filter((x) => x.id !== c.id) })))
                      }}
                      style={{ border: 'none', background: 'transparent', color: S.ink4, fontSize: 12, cursor: 'pointer', padding: '0 2px 0 4px' }}
                    >
                      ×
                    </button>
                  )}
                </span>
              )
            })}
            {showNewCategory ? (
              <input
                autoFocus
                value={newCategoryLabel}
                onChange={(e) => setNewCategoryLabel(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Escape') { setShowNewCategory(false); setNewCategoryLabel('') }
                  if (e.key === 'Enter') {
                    const r = await createCategory(newCategoryLabel)
                    if (!r.ok) { setError(r.error); return }
                    const next = await listCategories()
                    setCategories(next)
                    setShowNewCategory(false)
                    setNewCategoryLabel('')
                    setSelectedCategoryIds((prev) => [...prev, r.data.id])
                  }
                }}
                placeholder="New category"
                style={{ ...inputStyle, padding: '2px 6px', fontSize: 11, width: 110 }}
              />
            ) : (
              <button onClick={() => setShowNewCategory(true)} style={{ border: `1px dashed ${S.border}`, background: 'transparent', color: S.ink3, padding: '4px 8px', borderRadius: 999, fontSize: 11, cursor: 'pointer' }}>
                + New
              </button>
            )}
          </div>
        </div>

        {/* Select-all */}
        {visibleTemplates.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: S.ink3, cursor: 'pointer' }}>
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} style={{ width: 15, height: 15, accentColor: S.accent, cursor: 'pointer' }} />
            Select all ({visibleTemplates.length} shown)
          </label>
        )}

        {selectedTemplates.length > 0 && (
          <SelectionBulkBar
            selectedCount={selectedTemplates.length}
            submittableCount={submittableCount}
            refreshableCount={refreshableCount}
            busy={bulkBusy}
            onSubmit={handleBulkSubmit}
            onRefresh={handleBulkRefresh}
            onClear={clearSelection}
          />
        )}

        {toast && (
          <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 6, background: S.accentSoft, color: S.accentInk, fontSize: 12 }}>
            {toast}
          </div>
        )}

        <ul style={{ listStyle: 'none', padding: 0, margin: 0, flex: 1 }}>
          {visibleTemplates.length === 0 && (
            <li style={{ fontSize: 12, color: S.ink3, padding: '12px 4px', lineHeight: 1.5 }}>
              {statusFilter === 'approved' && counts.pending > 0
                ? `Nothing approved yet — ${counts.pending} pending will appear here once Meta reviews them.`
                : 'No templates in this view.'}
            </li>
          )}
          {visibleTemplates.map((t) => (
            <TemplateListRow
              key={t.id}
              template={t}
              isOpen={selectedId === t.id}
              isSelected={selectedIds.has(t.id)}
              isPolling={pollingActive}
              onOpen={() => openTemplate(t)}
              onToggleSelect={() => toggleSelect(t.id)}
            />
          ))}
        </ul>

        {/* Reset rejected helper */}
        {counts.rejected > 0 && (
          <button onClick={handleResetRejected} disabled={pending} style={{ ...btnSecondary, marginTop: 10, fontSize: 11, padding: '5px 10px' }}>
            Move all rejected back to draft
          </button>
        )}
      </aside>

      {/* ── Editor column ── */}
      <main style={{ flex: 1, padding: 32, maxWidth: 860, height: '100vh', overflowY: 'auto' }}>
        {!isCreating && !selected && <p style={{ color: S.ink3 }}>Select a template or create a new one.</p>}
        {(isCreating || selected) && (
          <>
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontFamily: S.serif, fontSize: 24, margin: 0 }}>{isCreating ? 'New template' : draft.display_name || draft.name}</h2>
              {selected && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={handleDuplicate} disabled={pending} style={btnSecondary}>Duplicate</button>
                  <button onClick={handleDelete} disabled={pending} style={{ ...btnSecondary, color: S.danger, borderColor: S.danger }}>Delete</button>
                </div>
              )}
            </header>

            {/* status banners */}
            {selected?.meta_status === 'approved' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', background: S.accentSoft, color: S.accentInk, padding: '12px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16, border: `1px solid ${S.accent}` }}>
                <span><strong>Approved by Meta.</strong> Ready to send.</span>
                <a href={`/dashboard/agent?template=${selected.id}&mode=shared_template`} style={{ background: S.accent, color: '#fff', padding: '6px 12px', borderRadius: 6, fontSize: 12.5, fontWeight: 500, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                  Use in AI Follow-Up Agent →
                </a>
              </div>
            )}
            {selected?.meta_status === 'pending' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: S.warnSoft, color: S.warn, padding: '10px 14px', borderRadius: 8, fontSize: 12.5, marginBottom: 16 }}>
                <span className="tpl-spin" aria-hidden style={{ width: 11, height: 11 }} />
                Pending Meta review{selected.submitted_at ? ` — submitted ${new Date(selected.submitted_at).toLocaleString()}` : ''}. This updates automatically.
              </div>
            )}
            {resubmitNotice && (
              <div style={{ background: S.warnSoft, color: S.warn, padding: '10px 14px', borderRadius: 8, fontSize: 12.5, marginBottom: 16 }}>
                You changed a reviewed field, so this template is back to <strong>Draft</strong> and needs re-submission to Meta.
              </div>
            )}
            {(selected?.meta_status === 'rejected' || selected?.meta_status === 'disabled') && (
              <div style={{ background: selected.meta_status === 'rejected' ? '#FEE2E2' : '#F3F4F6', color: selected.meta_status === 'rejected' ? '#991B1B' : '#374151', padding: '10px 14px', borderRadius: 8, fontSize: 12.5, marginBottom: 16 }}>
                {selected.meta_status === 'rejected' ? 'Rejected by Meta' : 'Disabled by Meta'}
                {selected.meta_rejection_reason ? `: ${selected.meta_rejection_reason}` : '.'} Edit the body and re-submit.
              </div>
            )}
            {locked && (
              <div style={{ background: S.warnSoft, color: S.warn, padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 16 }}>
                Editing a reviewed field (name, body, language, buttons, footer) resets this template to draft and requires re-submission.
              </div>
            )}

            <div style={{ display: 'grid', gap: 16 }}>
              <Field label="Display name">
                <input type="text" value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} style={inputStyle} />
              </Field>

              <Field label="Categories" hint="Tag this template so it appears under those filters across the app.">
                <CategoryChips categories={categories} selectedIds={draftCategoryIds} size="md" onToggle={(id) => setDraftCategoryIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))} />
              </Field>

              <Field label="Internal name (lowercase, digits, underscores)">
                <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ ...inputStyle, fontFamily: S.mono }} />
              </Field>
              <Field label="Language">
                <input type="text" value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })} style={{ ...inputStyle, maxWidth: 160 }} placeholder="en_US" />
              </Field>
              <Field label={`Body (${variableCount} variable${variableCount === 1 ? '' : 's'})`} hint="Use {{1}}, {{2}}, … for placeholders that get filled in at send time.">
                <textarea value={draft.body_text} onChange={(e) => setBody(e.target.value)} rows={5} style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
              </Field>

              {variableCount > 0 && (
                <Field label="Sample values" hint="Required by Meta when reviewing — these are not sent to leads.">
                  <div style={{ display: 'grid', gap: 6 }}>
                    {Array.from({ length: variableCount }).map((_, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: S.mono, fontSize: 12, color: S.ink3, width: 36 }}>{`{{${i + 1}}}`}</span>
                        <input type="text" value={draft.sample_values[i] ?? ''} onChange={(e) => setSampleValue(i, e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder={`Sample for variable ${i + 1}`} />
                      </div>
                    ))}
                  </div>
                </Field>
              )}

              <Field label={`Buttons (${draft.buttons.length}/3)`} hint="Optional. URL buttons can link to an action page. Postback buttons send a payload back to your bot.">
                <div style={{ display: 'grid', gap: 8 }}>
                  {draft.buttons.map((b, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <select value={b.type} onChange={(e) => updateButton(i, { type: e.target.value as TemplateButton['type'] })} style={{ ...inputStyle, width: 120 }}>
                        <option value="postback">Postback</option>
                        <option value="url">URL</option>
                        <option value="phone_number">Phone</option>
                      </select>
                      <input type="text" placeholder="Button label" value={b.text} onChange={(e) => updateButton(i, { text: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
                      {b.type === 'url' && <input type="text" placeholder="https://…" value={b.url ?? ''} onChange={(e) => updateButton(i, { url: e.target.value })} style={{ ...inputStyle, flex: 1.4 }} />}
                      {b.type === 'postback' && <input type="text" placeholder="payload" value={b.payload ?? ''} onChange={(e) => updateButton(i, { payload: e.target.value })} style={{ ...inputStyle, flex: 1.2, fontFamily: S.mono }} />}
                      {b.type === 'phone_number' && <input type="text" placeholder="+15551234567" value={b.phone_number ?? ''} onChange={(e) => updateButton(i, { phone_number: e.target.value })} style={{ ...inputStyle, flex: 1.2 }} />}
                      <button onClick={() => removeButton(i)} style={{ ...btnSecondary, padding: '6px 10px', color: S.danger, borderColor: S.danger }}>×</button>
                    </div>
                  ))}
                  {draft.buttons.length < 3 && <button onClick={addButton} style={{ ...btnSecondary, alignSelf: 'flex-start' }}>+ Add button</button>}
                </div>
              </Field>

              <Field label="Preview">
                <div style={{ background: S.surface2, border: `1px solid ${S.border}`, borderRadius: 8, padding: 14, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {preview || <span style={{ color: S.ink4 }}>Type a body to see the preview…</span>}
                  {draft.buttons.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                      {draft.buttons.map((b, i) => (
                        <div key={i} style={{ border: `1px solid ${S.border}`, background: S.surface, color: S.accent, textAlign: 'center', padding: '8px 10px', borderRadius: 6, fontSize: 13, fontWeight: 500 }}>
                          {b.text || '(button)'}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Field>
            </div>

            {error && <p style={{ color: S.danger, marginTop: 16, fontSize: 13 }}>{error}</p>}

            <footer style={{ display: 'flex', gap: 10, marginTop: 24, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={handleSave} disabled={pending} style={btnPrimary}>
                {pending ? 'Saving…' : draft.id ? 'Save changes' : 'Create template'}
              </button>
              {selected && (selected.meta_status === 'draft' || selected.meta_status === 'rejected') && (
                <button onClick={handleSubmit} disabled={pending} style={btnSecondary}>
                  Submit to Meta for review
                </button>
              )}
            </footer>
          </>
        )}
      </main>

      {/* Agent shortcut when there are approved templates */}
      {approvedCount > 0 && !selected && (
        <div style={{ position: 'fixed', bottom: 20, right: 20 }}>
          <a href="/dashboard/agent?mode=shared_template" style={{ ...btnPrimary, textDecoration: 'none' }}>
            Go to AI Follow-Up Agent →
          </a>
        </div>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: S.ink2 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: S.ink3 }}>{hint}</span>}
    </label>
  )
}
