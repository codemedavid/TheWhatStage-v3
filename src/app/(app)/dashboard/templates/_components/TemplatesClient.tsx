'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  countVariables,
  renderTemplate,
  type TemplateButton,
  type TemplateFormInput,
  type TemplateMetaStatus,
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
  refreshTemplateStatus,
  resetRejectedTemplates,
  setTemplateCategories,
  submitTemplateForReview,
  updateTemplate,
} from '../actions'

const S = {
  serif:      'var(--font-instrument-serif)',
  ink:        '#1A1915',
  ink2:       '#3F3D36',
  ink3:       '#6B6960',
  ink4:       '#9C9A90',
  border:     '#E8E6DE',
  accent:     '#1F7A4D',
  accentSoft: '#F2F8F4',
  surface:    '#FFFFFF',
  surface2:   '#F6F5F1',
  danger:     '#B91C1C',
  warn:       '#92400E',
  warnSoft:   '#FFFBEB',
}

interface Props {
  initialTemplates: MessengerMessageTemplateWithCategories[]
  initialCategories: TemplateCategory[]
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
  return {
    id: null,
    name: '',
    display_name: '',
    language: 'en_US',
    body_text: '',
    sample_values: [],
    buttons: [],
    footer: '',
  }
}

function fromTemplate(t: MessengerMessageTemplateWithCategories): DraftState {
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

function statusBadge(status: TemplateMetaStatus) {
  switch (status) {
    case 'approved':
      return { label: 'Approved', bg: '#DCFCE7', color: '#166534' }
    case 'pending':
      return { label: 'Pending review', bg: '#FEF3C7', color: '#92400E' }
    case 'rejected':
      return { label: 'Rejected', bg: '#FEE2E2', color: '#991B1B' }
    case 'disabled':
      return { label: 'Disabled', bg: '#F3F4F6', color: '#6B7280' }
    default:
      return { label: 'Draft', bg: '#F3F4F6', color: '#374151' }
  }
}

type StatusFilter = 'approved' | 'all' | 'pending' | 'rejected' | 'draft'

export function TemplatesClient({ initialTemplates, initialCategories }: Props) {
  const [templates, setTemplates] = useState<MessengerMessageTemplateWithCategories[]>(initialTemplates)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('approved')

  const [categories, setCategories] = useState<TemplateCategory[]>(initialCategories)
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [draftCategoryIds, setDraftCategoryIds] = useState<string[]>([])
  const [newCategoryLabel, setNewCategoryLabel] = useState('')
  const [showNewCategory, setShowNewCategory] = useState(false)

  const visibleTemplates = useMemo(() => {
    return templates.filter((t) => {
      if (statusFilter !== 'all' && t.meta_status !== statusFilter) return false
      if (selectedCategoryIds.length === 0) return true
      return t.categories.some((c) => selectedCategoryIds.includes(c.id))
    })
  }, [templates, statusFilter, selectedCategoryIds])

  const [selectedId, setSelectedId] = useState<string | null>(
    initialTemplates[0]?.id ?? null,
  )
  const [draft, setDraft] = useState<DraftState>(
    initialTemplates[0] ? fromTemplate(initialTemplates[0]) : emptyDraft(),
  )
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  )

  const variableCount = countVariables(draft.body_text)
  const preview = renderTemplate(draft.body_text, draft.sample_values)

  function selectTemplate(t: MessengerMessageTemplateWithCategories) {
    setIsCreating(false)
    setSelectedId(t.id)
    setDraft(fromTemplate(t))
    setDraftCategoryIds(t.categories.map((c) => c.id))
    setError(null)
  }

  function startCreate() {
    setIsCreating(true)
    setSelectedId(null)
    setDraft(emptyDraft())
    setDraftCategoryIds([])
    setError(null)
  }

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
    setDraft({
      ...draft,
      buttons: [
        ...draft.buttons,
        { type: 'postback', text: '', payload: '' },
      ],
    })
  }

  function updateButton(idx: number, patch: Partial<TemplateButton>) {
    const next = [...draft.buttons]
    next[idx] = { ...next[idx], ...patch }
    setDraft({ ...draft, buttons: next })
  }

  function removeButton(idx: number) {
    setDraft({ ...draft, buttons: draft.buttons.filter((_, i) => i !== idx) })
  }

  async function refresh() {
    // Server action result drives the canonical state. We re-read by triggering
    // a soft path navigation through revalidatePath; for snappier UX we mutate
    // local state in handlers below.
  }

  void refresh

  function handleSave() {
    setError(null)
    const input: TemplateFormInput = {
      name: draft.name,
      display_name: draft.display_name,
      language: draft.language,
      body_text: draft.body_text,
      sample_values: draft.sample_values,
      buttons: draft.buttons,
      footer: draft.footer,
    }
    startTransition(async () => {
      let id: string
      if (draft.id) {
        const r = await updateTemplate(draft.id, input)
        if (!r.ok) { setError(r.error); return }
        id = draft.id
      } else {
        const r = await createTemplate(input)
        if (!r.ok) { setError(r.error); return }
        id = r.data.id
      }
      const c = await setTemplateCategories(id, draftCategoryIds)
      if (!c.ok) { setError(c.error); return }
      if (draft.id) {
        window.location.reload()
      } else {
        window.location.href = `/dashboard/templates?selected=${id}`
      }
    })
  }

  function handleDelete() {
    if (!draft.id) return
    if (!confirm('Delete this template? This cannot be undone.')) return
    startTransition(async () => {
      const r = await deleteTemplate(draft.id!)
      if (!r.ok) { setError(r.error); return }
      setTemplates((prev) => prev.filter((t) => t.id !== draft.id))
      const next = templates.find((t) => t.id !== draft.id) ?? null
      if (next) selectTemplate(next)
      else {
        setSelectedId(null)
        setDraft(emptyDraft())
      }
    })
  }

  function handleDuplicate() {
    if (!draft.id) return
    startTransition(async () => {
      const r = await duplicateTemplate(draft.id!)
      if (!r.ok) { setError(r.error); return }
      window.location.href = `/dashboard/templates?selected=${r.data.id}`
    })
  }

  function handleSubmit() {
    if (!draft.id) return
    if (!confirm('Submit this template to Meta for review? The body will be locked while pending.')) return
    startTransition(async () => {
      const r = await submitTemplateForReview(draft.id!)
      if (!r.ok) { setError(r.error); return }
      // Reload to pick up the canonical status returned by Meta — utility
      // templates often come back as 'approved' immediately, so we can't
      // optimistically assume 'pending' here.
      window.location.reload()
    })
  }

  function handleRefreshStatus() {
    if (!draft.id) return
    setError(null)
    startTransition(async () => {
      const r = await refreshTemplateStatus(draft.id!)
      if (!r.ok) { setError(r.error); return }
      window.location.reload()
    })
  }

  function handleResetRejected() {
    const count = templates.filter((t) => t.meta_status === 'rejected').length
    if (count === 0) return
    if (!confirm(`Move ${count} rejected template${count === 1 ? '' : 's'} back to draft? You can re-submit them once your Facebook app has the right permissions.`)) return
    startTransition(async () => {
      const r = await resetRejectedTemplates()
      if (!r.ok) { setError(r.error); return }
      window.location.reload()
    })
  }

  const locked =
    selected?.meta_status === 'pending' || selected?.meta_status === 'approved'

  return (
    <div style={{ display: 'flex', height: '100vh', background: S.surface2, color: S.ink }}>
      {/* ── List column ── */}
      <aside
        style={{
          width: 320,
          borderRight: `1px solid ${S.border}`,
          background: S.surface,
          padding: '24px 16px',
          height: '100vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
          <h1 style={{ fontFamily: S.serif, fontSize: 28, margin: 0 }}>Templates</h1>
          <button
            onClick={startCreate}
            style={{
              border: `1px solid ${S.accent}`,
              background: S.accent,
              color: '#fff',
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            + New
          </button>
        </div>
        <p style={{ fontSize: 12, color: S.ink3, margin: '0 0 12px' }}>
          Utility messages must be pre-registered with Meta before they can be sent
          outside the 24-hour window.
        </p>

        {/* ── Category filter chips ── */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: S.ink3, marginBottom: 6 }}>Categories</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {categories.map((c) => {
              const active = selectedCategoryIds.includes(c.id)
              return (
                <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <button
                    onClick={() =>
                      setSelectedCategoryIds((prev) =>
                        prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                      )
                    }
                    style={{
                      border: `1px solid ${active ? S.accent : S.border}`,
                      background: active ? S.accentSoft : S.surface,
                      color: active ? S.accent : S.ink2,
                      padding: '4px 8px',
                      borderRadius: 999,
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
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
                        setTemplates((prev) =>
                          prev.map((t) => ({ ...t, categories: t.categories.filter((x) => x.id !== c.id) })),
                        )
                      }}
                      style={{
                        border: 'none', background: 'transparent', color: S.ink4,
                        fontSize: 12, cursor: 'pointer', padding: '0 2px 0 4px',
                      }}
                    >
                      ×
                    </button>
                  )}
                </span>
              )
            })}
            {showNewCategory ? (
              <span style={{ display: 'inline-flex', gap: 4 }}>
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
              </span>
            ) : (
              <button
                onClick={() => setShowNewCategory(true)}
                style={{
                  border: `1px dashed ${S.border}`, background: 'transparent', color: S.ink3,
                  padding: '4px 8px', borderRadius: 999, fontSize: 11, cursor: 'pointer',
                }}
              >
                + New
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: S.ink3 }}>Show</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            style={{ ...inputStyle, padding: '4px 6px', fontSize: 12, width: 'auto' }}
          >
            <option value="approved">Approved ({templates.filter((t) => t.meta_status === 'approved').length})</option>
            <option value="pending">Pending ({templates.filter((t) => t.meta_status === 'pending').length})</option>
            <option value="rejected">Rejected ({templates.filter((t) => t.meta_status === 'rejected').length})</option>
            <option value="draft">Draft ({templates.filter((t) => t.meta_status === 'draft').length})</option>
            <option value="all">All ({templates.length})</option>
          </select>
        </div>

        {/* Reset banner: only shown when there are rejected templates AND the
            user is currently looking at them. Bulk resubmission only makes
            sense after the underlying cause (e.g. an App permission gap) is
            fixed, so we expose this as an explicit action rather than auto-
            retrying anything. */}
        {statusFilter === 'rejected' &&
          templates.some((t) => t.meta_status === 'rejected') && (
            <div
              style={{
                background: S.warnSoft,
                color: S.warn,
                border: `1px solid ${S.border}`,
                borderRadius: 6,
                padding: '8px 10px',
                marginBottom: 10,
                fontSize: 11,
                lineHeight: 1.4,
              }}
            >
              <div style={{ marginBottom: 6 }}>
                Meta rejected these templates. Open one to see the reason — a
                common cause is the Facebook app missing the
                {' '}<code>pages_utility_messaging</code> permission.
              </div>
              <button
                onClick={handleResetRejected}
                disabled={pending}
                style={{
                  ...btnSecondary,
                  padding: '4px 10px',
                  fontSize: 11,
                }}
              >
                Move all rejected back to draft
              </button>
            </div>
          )}

        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {visibleTemplates.length === 0 && (
            <li style={{ fontSize: 12, color: S.ink3, padding: '8px 4px' }}>
              No templates in this view.
            </li>
          )}
          {visibleTemplates.map((t) => {
            const sel = selectedId === t.id
            const badge = statusBadge(t.meta_status)
            return (
              <li
                key={t.id}
                onClick={() => selectTemplate(t)}
                style={{
                  padding: '10px 12px',
                  marginBottom: 4,
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: sel ? S.accentSoft : 'transparent',
                  border: `1px solid ${sel ? S.accent : 'transparent'}`,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: S.ink }}>
                  {t.display_name}
                </div>
                <div style={{ fontSize: 11, color: S.ink3, fontFamily: 'var(--font-geist-mono)', marginTop: 2 }}>
                  {t.name}
                </div>
                <span
                  style={{
                    display: 'inline-block',
                    fontSize: 10,
                    background: badge.bg,
                    color: badge.color,
                    padding: '2px 6px',
                    borderRadius: 4,
                    marginTop: 6,
                  }}
                >
                  {badge.label}
                </span>
              </li>
            )
          })}
        </ul>
      </aside>

      {/* ── Editor column ── */}
      <main style={{ flex: 1, padding: 32, maxWidth: 820, height: '100vh', overflowY: 'auto' }}>
        {!isCreating && !selected && (
          <p style={{ color: S.ink3 }}>Select a template or create a new one.</p>
        )}
        {(isCreating || selected) && (
          <>
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontFamily: S.serif, fontSize: 24, margin: 0 }}>
                {isCreating ? 'New template' : draft.display_name || draft.name}
              </h2>
              {selected && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={handleDuplicate} disabled={pending} style={btnSecondary}>
                    Duplicate
                  </button>
                  <button onClick={handleDelete} disabled={pending} style={{ ...btnSecondary, color: S.danger, borderColor: S.danger }}>
                    Delete
                  </button>
                </div>
              )}
            </header>

            {locked && (
              <div style={{ background: S.warnSoft, color: S.warn, padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 16 }}>
                This template is {selected?.meta_status}. Editing the body or buttons
                will reset it to draft and require re-submission.
              </div>
            )}
            {selected?.meta_status === 'rejected' && selected.meta_rejection_reason && (
              <div style={{ background: '#FEE2E2', color: '#991B1B', padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 16 }}>
                Rejected by Meta: {selected.meta_rejection_reason}
              </div>
            )}

            <div style={{ display: 'grid', gap: 16 }}>
              <Field label="Display name">
                <input
                  type="text"
                  value={draft.display_name}
                  onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
                  style={inputStyle}
                />
              </Field>

              <Field label="Categories" hint="Tag this template so it appears under those filters across the app.">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {categories.map((c) => {
                    const on = draftCategoryIds.includes(c.id)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          setDraftCategoryIds((prev) =>
                            prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                          )
                        }
                        style={{
                          border: `1px solid ${on ? S.accent : S.border}`,
                          background: on ? S.accentSoft : S.surface,
                          color: on ? S.accent : S.ink2,
                          padding: '4px 10px',
                          borderRadius: 999,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        {c.label}
                      </button>
                    )
                  })}
                </div>
              </Field>

              <Field label="Internal name (lowercase, digits, underscores)">
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  style={{ ...inputStyle, fontFamily: 'var(--font-geist-mono)' }}
                />
              </Field>
              <Field label="Language">
                <input
                  type="text"
                  value={draft.language}
                  onChange={(e) => setDraft({ ...draft, language: e.target.value })}
                  style={{ ...inputStyle, maxWidth: 160 }}
                  placeholder="en_US"
                />
              </Field>
              <Field
                label={`Body (${variableCount} variable${variableCount === 1 ? '' : 's'})`}
                hint="Use {{1}}, {{2}}, … for placeholders that get filled in at send time."
              >
                <textarea
                  value={draft.body_text}
                  onChange={(e) => setBody(e.target.value)}
                  rows={5}
                  style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
                />
              </Field>

              {variableCount > 0 && (
                <Field label="Sample values" hint="Required by Meta when reviewing — these are not sent to leads.">
                  <div style={{ display: 'grid', gap: 6 }}>
                    {Array.from({ length: variableCount }).map((_, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--font-geist-mono)', fontSize: 12, color: S.ink3, width: 36 }}>
                          {`{{${i + 1}}}`}
                        </span>
                        <input
                          type="text"
                          value={draft.sample_values[i] ?? ''}
                          onChange={(e) => setSampleValue(i, e.target.value)}
                          style={{ ...inputStyle, flex: 1 }}
                          placeholder={`Sample for variable ${i + 1}`}
                        />
                      </div>
                    ))}
                  </div>
                </Field>
              )}

              <Field
                label={`Buttons (${draft.buttons.length}/3)`}
                hint="Optional. URL buttons can link to an action page. Postback buttons send a payload back to your bot."
              >
                <div style={{ display: 'grid', gap: 8 }}>
                  {draft.buttons.map((b, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <select
                        value={b.type}
                        onChange={(e) =>
                          updateButton(i, { type: e.target.value as TemplateButton['type'] })
                        }
                        style={{ ...inputStyle, width: 120 }}
                      >
                        <option value="postback">Postback</option>
                        <option value="url">URL</option>
                        <option value="phone_number">Phone</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Button label"
                        value={b.text}
                        onChange={(e) => updateButton(i, { text: e.target.value })}
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      {b.type === 'url' && (
                        <input
                          type="text"
                          placeholder="https://…"
                          value={b.url ?? ''}
                          onChange={(e) => updateButton(i, { url: e.target.value })}
                          style={{ ...inputStyle, flex: 1.4 }}
                        />
                      )}
                      {b.type === 'postback' && (
                        <input
                          type="text"
                          placeholder="payload"
                          value={b.payload ?? ''}
                          onChange={(e) => updateButton(i, { payload: e.target.value })}
                          style={{ ...inputStyle, flex: 1.2, fontFamily: 'var(--font-geist-mono)' }}
                        />
                      )}
                      {b.type === 'phone_number' && (
                        <input
                          type="text"
                          placeholder="+15551234567"
                          value={b.phone_number ?? ''}
                          onChange={(e) => updateButton(i, { phone_number: e.target.value })}
                          style={{ ...inputStyle, flex: 1.2 }}
                        />
                      )}
                      <button
                        onClick={() => removeButton(i)}
                        style={{ ...btnSecondary, padding: '6px 10px', color: S.danger, borderColor: S.danger }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {draft.buttons.length < 3 && (
                    <button onClick={addButton} style={{ ...btnSecondary, alignSelf: 'flex-start' }}>
                      + Add button
                    </button>
                  )}
                </div>
              </Field>

              <Field label="Preview">
                <div
                  style={{
                    background: S.surface2,
                    border: `1px solid ${S.border}`,
                    borderRadius: 8,
                    padding: 14,
                    fontSize: 14,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {preview || <span style={{ color: S.ink4 }}>Type a body to see the preview…</span>}
                  {draft.buttons.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                      {draft.buttons.map((b, i) => (
                        <div
                          key={i}
                          style={{
                            border: `1px solid ${S.border}`,
                            background: S.surface,
                            color: S.accent,
                            textAlign: 'center',
                            padding: '8px 10px',
                            borderRadius: 6,
                            fontSize: 13,
                            fontWeight: 500,
                          }}
                        >
                          {b.text || '(button)'}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Field>
            </div>

            {error && (
              <p style={{ color: S.danger, marginTop: 16, fontSize: 13 }}>{error}</p>
            )}

            <footer style={{ display: 'flex', gap: 10, marginTop: 24, alignItems: 'center' }}>
              <button onClick={handleSave} disabled={pending} style={btnPrimary}>
                {pending ? 'Saving…' : draft.id ? 'Save changes' : 'Create template'}
              </button>
              {selected && (selected.meta_status === 'draft' || selected.meta_status === 'rejected') && (
                <button onClick={handleSubmit} disabled={pending} style={btnSecondary}>
                  Submit to Meta for review
                </button>
              )}
              {selected?.meta_status === 'pending' && (
                <>
                  <button onClick={handleRefreshStatus} disabled={pending} style={btnSecondary}>
                    {pending ? 'Refreshing…' : 'Refresh status'}
                  </button>
                  <span style={{ fontSize: 12, color: S.ink3 }}>
                    Submitted {selected.submitted_at ? new Date(selected.submitted_at).toLocaleString() : ''} — awaiting Meta review.
                  </span>
                </>
              )}
            </footer>
          </>
        )}
      </main>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: S.ink2 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: S.ink3 }}>{hint}</span>}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  border: `1px solid ${S.border}`,
  background: S.surface,
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 13,
  color: S.ink,
  outline: 'none',
  width: '100%',
}

const btnPrimary: React.CSSProperties = {
  background: S.accent,
  color: '#fff',
  border: `1px solid ${S.accent}`,
  padding: '8px 16px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
}

const btnSecondary: React.CSSProperties = {
  background: S.surface,
  color: S.ink2,
  border: `1px solid ${S.border}`,
  padding: '8px 14px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
}
