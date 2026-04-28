'use client'
import { useState, useTransition } from 'react'
import { createLead, updateLead } from '../actions/leads'
import type { StageRow, FieldDefRow, LeadRow } from '../_lib/queries'

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
}

export function LeadDrawer({
  mode, lead, stages, fieldDefs, onClose,
}: {
  mode: 'create' | 'edit'
  lead?: LeadRow
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
  onClose: () => void
}) {
  const [pending, start] = useTransition()
  const [form, setForm] = useState<FormShape>(
    lead ?? {
      id: '',
      stage_id: stages[0]?.id ?? '',
      name: '', email: '', phone: '', company: '', job_title: '',
      source: '', estimated_value: null, notes: '', custom_fields: {},
    },
  )

  const set = <K extends keyof FormShape>(k: K, v: FormShape[K]) =>
    setForm((f) => ({ ...f, [k]: v }))
  const setCF = (key: string, v: unknown) =>
    setForm((f) => ({ ...f, custom_fields: { ...f.custom_fields, [key]: v } }))

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    start(async () => {
      const payload = {
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
      if (mode === 'create') await createLead(payload)
      else await updateLead(form.id, payload)
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex justify-end" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="w-[420px] h-full bg-white p-5 overflow-y-auto space-y-3"
      >
        <h2 className="text-lg font-semibold">
          {mode === 'create' ? 'Add Lead' : 'Edit Lead'}
        </h2>

        <Field label="Stage">
          <select
            value={form.stage_id}
            onChange={(e) => set('stage_id', e.target.value)}
            className="w-full border rounded-md px-2 py-1.5 text-sm"
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Name *">
          <Input value={form.name} onChange={(v) => set('name', v)} required />
        </Field>
        <Field label="Email">
          <Input value={form.email ?? ''} onChange={(v) => set('email', v)} type="email" />
        </Field>
        <Field label="Phone">
          <Input value={form.phone ?? ''} onChange={(v) => set('phone', v)} />
        </Field>
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
          />
        </Field>
        <Field label="Notes">
          <textarea
            value={form.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            className="w-full border rounded-md px-2 py-1.5 text-sm h-24"
          />
        </Field>

        {fieldDefs.length > 0 && (
          <div className="border-t pt-3 space-y-3">
            <div className="text-xs font-semibold text-[#6B7280] uppercase">Custom fields</div>
            {fieldDefs.map((fd) => (
              <Field key={fd.id} label={fd.label}>
                {fd.type === 'select' && fd.options ? (
                  <select
                    value={String(form.custom_fields[fd.key] ?? '')}
                    onChange={(e) => setCF(fd.key, e.target.value)}
                    className="w-full border rounded-md px-2 py-1.5 text-sm"
                  >
                    <option value="">—</option>
                    {fd.options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
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
        )}

        <div className="flex justify-end gap-2 pt-3">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border rounded-md">
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="px-3 py-1.5 text-sm bg-[#059669] text-white rounded-md disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-[#374151] mb-1">{label}</div>
      {children}
    </label>
  )
}

function Input({
  value, onChange, type = 'text', required,
}: {
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <input
      type={type}
      value={value}
      required={required}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border rounded-md px-2 py-1.5 text-sm"
    />
  )
}
