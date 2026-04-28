'use client'
import { useState, useTransition } from 'react'
import { createFieldDef, deleteFieldDef } from '../actions/fields'
import type { FieldDefRow } from '../_lib/queries'

export function FieldDefManager({ defs }: { defs: FieldDefRow[] }) {
  const [pending, start] = useTransition()
  const [form, setForm] = useState({ key: '', label: '', type: 'text', options: '' })

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    start(async () => {
      await createFieldDef({
        key: form.key,
        label: form.label,
        type: form.type as 'text' | 'number' | 'date' | 'select',
        options:
          form.type === 'select'
            ? form.options.split(',').map((s) => s.trim()).filter(Boolean)
            : null,
      })
      setForm({ key: '', label: '', type: 'text', options: '' })
    })
  }

  const remove = (d: FieldDefRow) => {
    if (
      !confirm(
        `Delete field "${d.label}"? Existing values for this key will be removed.`,
      )
    )
      return
    start(async () => {
      await deleteFieldDef(d.id)
    })
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="border p-3 rounded-md grid grid-cols-4 gap-2 items-end">
        <Field label="Key (slug)">
          <input
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value })}
            className="border rounded px-2 py-1 text-sm w-full"
            placeholder="industry"
          />
        </Field>
        <Field label="Label">
          <input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            className="border rounded px-2 py-1 text-sm w-full"
          />
        </Field>
        <Field label="Type">
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="border rounded px-2 py-1 text-sm w-full"
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="select">Select</option>
          </select>
        </Field>
        {form.type === 'select' && (
          <Field label="Options (comma sep)">
            <input
              value={form.options}
              onChange={(e) => setForm({ ...form, options: e.target.value })}
              className="border rounded px-2 py-1 text-sm w-full"
            />
          </Field>
        )}
        <button
          disabled={pending}
          className="col-span-4 justify-self-end px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-md"
        >
          Add field
        </button>
      </form>

      <ul className="border rounded-md divide-y">
        {defs.length === 0 && (
          <li className="p-3 text-sm text-[#6B7280]">No custom fields yet.</li>
        )}
        {defs.map((d) => (
          <li key={d.id} className="p-3 flex items-center gap-3">
            <div className="flex-1">
              <div className="text-sm font-medium">
                {d.label}
                <span className="text-xs text-[#6B7280] ml-2">
                  ({d.type}, key: {d.key})
                </span>
              </div>
              {d.options && (
                <div className="text-xs">Options: {d.options.join(', ')}</div>
              )}
            </div>
            <button
              onClick={() => remove(d)}
              className="px-2 py-1 text-sm border border-red-300 text-red-700 rounded"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs mb-1">{label}</div>
      {children}
    </label>
  )
}
