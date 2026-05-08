'use client'

import { useState, useTransition } from 'react'
import {
  PAYMENT_METHOD_KINDS,
  paymentMethodKindLabel,
  type PaymentMethod,
  type PaymentMethodInput,
  type PaymentMethodKind,
} from '@/lib/payment-methods/types'
import {
  createPaymentMethod,
  deletePaymentMethod,
  setPaymentMethodEnabled,
  updatePaymentMethod,
} from '../actions'
import { PaymentMethodForm } from './PaymentMethodForm'

interface Props {
  initial: PaymentMethod[]
}

export function PaymentMethodsClient({ initial }: Props) {
  const [methods, setMethods] = useState<PaymentMethod[]>(initial)
  const [editing, setEditing] = useState<PaymentMethod | null>(null)
  const [creating, setCreating] = useState<PaymentMethodKind | null>(null)
  const [, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function handleSave(input: PaymentMethodInput, id?: string) {
    setError(null)
    try {
      if (id) {
        await updatePaymentMethod(id, input)
        setMethods((arr) =>
          arr.map((m) =>
            m.id === id
              ? {
                  ...m,
                  kind: input.kind,
                  name: input.name.trim(),
                  instructions: input.instructions.trim() || null,
                  details: input.details,
                  enabled: input.enabled,
                }
              : m,
          ),
        )
        setEditing(null)
      } else {
        const newId = await createPaymentMethod(input)
        setMethods((arr) => [
          ...arr,
          {
            id: newId,
            user_id: '',
            kind: input.kind,
            name: input.name.trim(),
            instructions: input.instructions.trim() || null,
            details: input.details,
            enabled: input.enabled,
            position: arr.length,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ])
        setCreating(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this payment method? Pages using it will stop showing it.')) return
    setError(null)
    try {
      await deletePaymentMethod(id)
      setMethods((arr) => arr.filter((m) => m.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  function handleToggle(id: string, enabled: boolean) {
    setMethods((arr) => arr.map((m) => (m.id === id ? { ...m, enabled } : m)))
    startTransition(async () => {
      try {
        await setPaymentMethodEnabled(id, enabled)
      } catch {
        // revert
        setMethods((arr) => arr.map((m) => (m.id === id ? { ...m, enabled: !enabled } : m)))
      }
    })
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-zinc-900">
            Payment methods
          </h1>
          <p className="mt-1 text-[13px] text-zinc-600">
            Add the channels you accept (GCash, bank transfer, etc.). Attach
            them to checkout on your action pages so buyers know how to pay.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {PAYMENT_METHOD_KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => {
                setEditing(null)
                setCreating(k.value)
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-sm hover:bg-emerald-700"
            >
              + {k.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
          {error}
        </div>
      )}

      {(creating || editing) && (
        <div className="mb-6">
          <PaymentMethodForm
            initial={
              editing ?? {
                id: '',
                kind: creating ?? 'gcash',
                name: '',
                instructions: '',
                details: {},
                enabled: true,
              }
            }
            onSave={(input) => handleSave(input, editing?.id)}
            onCancel={() => {
              setEditing(null)
              setCreating(null)
            }}
          />
        </div>
      )}

      {methods.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
          <h3 className="text-[15px] font-semibold text-zinc-900">
            No payment methods yet
          </h3>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] text-zinc-500">
            Add at least one (e.g. GCash) so buyers can pay you. You&apos;ll
            attach methods to action pages from each page&apos;s editor.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_1px_0_rgba(17,24,39,0.04)]">
          {methods.map((m) => (
            <li key={m.id} className="flex items-start gap-4 p-4">
              <div className="size-12 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
                {m.details.qr_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.details.qr_image_url}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                    {m.kind === 'gcash' ? 'GC' : m.kind === 'bank_transfer' ? 'BANK' : '···'}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-zinc-900">{m.name}</span>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-600">
                    {paymentMethodKindLabel(m.kind)}
                  </span>
                  {!m.enabled && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-amber-800">
                      Disabled
                    </span>
                  )}
                </div>
                <div className="mt-1 space-y-0.5 text-[12.5px] text-zinc-600">
                  {m.details.account_name && (
                    <div>
                      <span className="text-zinc-400">Account name · </span>
                      {m.details.account_name}
                    </div>
                  )}
                  {m.details.account_number && (
                    <div>
                      <span className="text-zinc-400">Account # · </span>
                      <span className="font-mono">{m.details.account_number}</span>
                    </div>
                  )}
                  {m.details.bank_name && (
                    <div>
                      <span className="text-zinc-400">Bank · </span>
                      {m.details.bank_name}
                    </div>
                  )}
                  {m.instructions && (
                    <div className="mt-1 line-clamp-2 italic text-zinc-500">
                      {m.instructions}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <span className="text-[11.5px] font-medium text-zinc-600">
                    {m.enabled ? 'Enabled' : 'Off'}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={m.enabled}
                    onClick={() => handleToggle(m.id, !m.enabled)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                      m.enabled ? 'bg-emerald-600' : 'bg-zinc-300'
                    }`}
                  >
                    <span
                      className={`inline-block size-4 rounded-full bg-white shadow transition ${
                        m.enabled ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </label>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(null)
                      setEditing(m)
                    }}
                    className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[11.5px] font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(m.id)}
                    className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[11.5px] font-medium text-zinc-600 hover:bg-rose-50 hover:text-rose-700"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
