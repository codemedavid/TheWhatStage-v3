'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  countVariables,
  renderTemplate,
  type MessengerMessageTemplate,
  type TemplateButton,
  type TemplateFormInput,
  type TemplateMetaStatus,
} from '@/lib/messenger-templates/types'
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  refreshTemplateStatus,
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
  initialTemplates: MessengerMessageTemplate[]
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

function fromTemplate(t: MessengerMessageTemplate): DraftState {
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

export function TemplatesClient({ initialTemplates }: Props) {
  const [templates, setTemplates] = useState(initialTemplates)
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

  function selectTemplate(t: MessengerMessageTemplate) {
    setIsCreating(false)
    setSelectedId(t.id)
    setDraft(fromTemplate(t))
    setError(null)
  }

  function startCreate() {
    setIsCreating(true)
    setSelectedId(null)
    setDraft(emptyDraft())
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
      try {
        if (draft.id) {
          await updateTemplate(draft.id, input)
          setTemplates((prev) =>
            prev.map((t) =>
              t.id === draft.id
                ? {
                    ...t,
                    name: draft.name.toLowerCase(),
                    display_name: draft.display_name,
                    language: draft.language,
                    body_text: draft.body_text,
                    sample_values: draft.sample_values,
                    buttons: draft.buttons,
                    footer: draft.footer || null,
                    variable_count: variableCount,
                    // status may have been reset server-side; user can refresh
                  }
                : t,
            ),
          )
        } else {
          const newId = await createTemplate(input)
          const newRow: MessengerMessageTemplate = {
            id: newId,
            user_id: '',
            page_id: null,
            name: draft.name.toLowerCase(),
            display_name: draft.display_name,
            category: 'utility',
            language: draft.language,
            body_text: draft.body_text,
            variable_count: variableCount,
            sample_values: draft.sample_values,
            buttons: draft.buttons,
            header: null,
            footer: draft.footer || null,
            meta_template_id: null,
            meta_status: 'draft',
            meta_rejection_reason: null,
            submitted_at: null,
            approved_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
          setTemplates((prev) => [...prev, newRow])
          setSelectedId(newId)
          setDraft({ ...draft, id: newId, name: draft.name.toLowerCase() })
          setIsCreating(false)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  function handleDelete() {
    if (!draft.id) return
    if (!confirm('Delete this template? This cannot be undone.')) return
    startTransition(async () => {
      try {
        await deleteTemplate(draft.id!)
        setTemplates((prev) => prev.filter((t) => t.id !== draft.id))
        const next = templates.find((t) => t.id !== draft.id) ?? null
        if (next) selectTemplate(next)
        else {
          setSelectedId(null)
          setDraft(emptyDraft())
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  function handleDuplicate() {
    if (!draft.id) return
    startTransition(async () => {
      try {
        const newId = await duplicateTemplate(draft.id!)
        // Lightweight refetch via reload — duplicate copies many fields and
        // we'd rather not reproduce that logic on the client.
        window.location.href = `/dashboard/templates?selected=${newId}`
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  function handleSubmit() {
    if (!draft.id) return
    if (!confirm('Submit this template to Meta for review? The body will be locked while pending.')) return
    startTransition(async () => {
      try {
        await submitTemplateForReview(draft.id!)
        // Reload to pick up the canonical status returned by Meta — utility
        // templates often come back as 'approved' immediately, so we can't
        // optimistically assume 'pending' here.
        window.location.reload()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  function handleRefreshStatus() {
    if (!draft.id) return
    setError(null)
    startTransition(async () => {
      try {
        await refreshTemplateStatus(draft.id!)
        window.location.reload()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  const locked =
    selected?.meta_status === 'pending' || selected?.meta_status === 'approved'

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: S.surface2, color: S.ink }}>
      {/* ── List column ── */}
      <aside
        style={{
          width: 320,
          borderRight: `1px solid ${S.border}`,
          background: S.surface,
          padding: '24px 16px',
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
        <p style={{ fontSize: 12, color: S.ink3, margin: '0 0 16px' }}>
          Utility messages must be pre-registered with Meta before they can be sent
          outside the 24-hour window.
        </p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {templates.map((t) => {
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
      <main style={{ flex: 1, padding: 32, maxWidth: 820 }}>
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
