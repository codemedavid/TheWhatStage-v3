'use client'

import { useRef, useState } from 'react'
import {
  PAYMENT_METHOD_KINDS,
  type PaymentMethodInput,
  type PaymentMethodKind,
} from '@/lib/payment-methods/types'

interface FormState {
  id?: string
  kind: PaymentMethodKind
  name: string
  instructions: string
  details: Record<string, string>
  enabled: boolean
}

interface Props {
  initial: {
    id?: string
    kind: PaymentMethodKind
    name: string
    instructions: string | null
    details: Record<string, string | undefined>
    enabled: boolean
  }
  onSave: (input: PaymentMethodInput) => void | Promise<void>
  onCancel: () => void
}

function detailsAsRecord(d: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

export function PaymentMethodForm({ initial, onSave, onCancel }: Props) {
  const [state, setState] = useState<FormState>({
    id: initial.id,
    kind: initial.kind,
    name: initial.name,
    instructions: initial.instructions ?? '',
    details: detailsAsRecord(initial.details),
    enabled: initial.enabled,
  })
  const [submitting, setSubmitting] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  function setDetail(key: string, value: string) {
    setState((s) => ({ ...s, details: { ...s.details, [key]: value } }))
  }

  async function handleUpload(file: File) {
    setUploading(true)
    setUploadError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/payment-methods/images', { method: 'POST', body: fd })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `upload_failed_${res.status}`)
      }
      const { url } = (await res.json()) as { url: string }
      setDetail('qr_image_url', url)
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await onSave({
        kind: state.kind,
        name: state.name,
        instructions: state.instructions,
        details: state.details,
        enabled: state.enabled,
      })
    } finally {
      setSubmitting(false)
    }
  }

  const qr = state.details.qr_image_url ?? ''

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-zinc-200 bg-white p-4 shadow-[0_1px_0_rgba(17,24,39,0.04)]"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-zinc-900">
          {state.id ? 'Edit payment method' : 'New payment method'}
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={state.kind}
            onChange={(e) =>
              setState((s) => ({ ...s, kind: e.target.value as PaymentMethodKind }))
            }
            disabled={!!state.id}
            className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[12.5px] text-zinc-800"
          >
            {PAYMENT_METHOD_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Display name"
          value={state.name}
          onChange={(v) => setState((s) => ({ ...s, name: v }))}
          placeholder={
            state.kind === 'gcash'
              ? 'e.g. GCash · Maria S.'
              : state.kind === 'bank_transfer'
                ? 'e.g. BPI Savings'
                : 'e.g. PayPal'
          }
          required
        />
        <Field
          label="Account name"
          value={state.details.account_name ?? ''}
          onChange={(v) => setDetail('account_name', v)}
          placeholder="Name on the account"
        />
        <Field
          label={state.kind === 'gcash' ? 'GCash number' : 'Account number'}
          value={state.details.account_number ?? ''}
          onChange={(v) => setDetail('account_number', v)}
          placeholder={state.kind === 'gcash' ? '0917xxxxxxx' : '1234-5678-90'}
          mono
        />
        {state.kind === 'bank_transfer' && (
          <>
            <Field
              label="Bank name"
              value={state.details.bank_name ?? ''}
              onChange={(v) => setDetail('bank_name', v)}
              placeholder="e.g. BPI, BDO, UBP"
            />
            <Field
              label="Branch (optional)"
              value={state.details.branch ?? ''}
              onChange={(v) => setDetail('branch', v)}
              placeholder="e.g. Makati"
            />
          </>
        )}
      </div>

      <div className="mt-4">
        <label className="mb-0.5 block text-[10.5px] font-medium uppercase tracking-wide text-zinc-500">
          QR code or screenshot (optional)
        </label>
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="group relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-zinc-300 bg-zinc-50 hover:border-emerald-400"
          >
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="" className="size-full object-contain" />
            ) : (
              <span className="text-[10.5px] font-medium uppercase tracking-wide text-zinc-400">
                {uploading ? 'Uploading…' : 'Upload'}
              </span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleUpload(f)
            }}
          />
          <div className="flex-1 space-y-2">
            <Field
              label="QR / image URL"
              value={qr}
              onChange={(v) => setDetail('qr_image_url', v)}
              placeholder="https://… or click the tile to upload"
            />
            {qr && (
              <button
                type="button"
                onClick={() => setDetail('qr_image_url', '')}
                className="text-[11.5px] font-medium text-zinc-500 hover:text-rose-600"
              >
                Remove image
              </button>
            )}
            {uploadError && (
              <p className="text-[11.5px] text-rose-600">{uploadError}</p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <label className="mb-0.5 block text-[10.5px] font-medium uppercase tracking-wide text-zinc-500">
          Instructions (optional)
        </label>
        <textarea
          value={state.instructions}
          onChange={(e) => setState((s) => ({ ...s, instructions: e.target.value }))}
          rows={3}
          placeholder="e.g. Send the exact amount, then upload your receipt below."
          className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[13px] text-zinc-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => setState((s) => ({ ...s, enabled: e.target.checked }))}
            className="size-3.5 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span className="text-[12.5px] font-medium text-zinc-700">Enabled</span>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !state.name.trim()}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : state.id ? 'Save changes' : 'Create method'}
          </button>
        </div>
      </div>
    </form>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  mono,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
  mono?: boolean
}) {
  return (
    <div>
      <label className="mb-0.5 block text-[10.5px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
        {required ? <span className="ml-1 text-rose-500">*</span> : null}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className={`w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[13px] text-zinc-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  )
}
