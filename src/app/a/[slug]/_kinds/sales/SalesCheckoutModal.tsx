'use client'

import { useEffect, useMemo, useState } from 'react'
import type { PublicPaymentMethod } from '@/lib/payment-methods/public'
import type { SalesFallbackField } from './schema'

interface Claims {
  psid: string
  pageId: string
  exp: number
}

interface Props {
  slug: string
  pageId: string
  ctaLabel: string
  submitButtonLabel: string
  successMessage: string
  fields: SalesFallbackField[]
  paymentEnabled: boolean
  paymentMethods: PublicPaymentMethod[]
  defaultCurrency: string
  priceAmount: number | null
  accent: string
  ctaFg: string
  claims: Claims | null
  rawToken: string | null
}

type Step = 'form' | 'payment' | 'done'

function inputTypeFor(key: string): string {
  if (key === 'email') return 'email'
  if (key === 'phone') return 'tel'
  return 'text'
}

export function SalesCheckoutModal({
  slug,
  ctaLabel,
  submitButtonLabel,
  successMessage,
  fields,
  paymentEnabled,
  paymentMethods,
  defaultCurrency,
  priceAmount,
  accent,
  ctaFg,
  claims,
  rawToken,
}: Props) {
  const enabledFields = useMemo(
    () => fields.filter((f) => f.enabled),
    [fields],
  )
  const hasPayment = paymentEnabled && paymentMethods.length > 0

  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('form')
  const [formValues, setFormValues] = useState<Record<string, string>>({})

  const [methodId, setMethodId] = useState<string>(
    paymentMethods.length === 1 ? paymentMethods[0].id : '',
  )
  const [amount, setAmount] = useState(
    priceAmount && priceAmount > 0 ? String(priceAmount) : '',
  )
  const [currency, setCurrency] = useState(defaultCurrency)
  const [note, setNote] = useState('')
  const [proofUrl, setProofUrl] = useState('')
  const [proofFileId, setProofFileId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.hash === '#convert') setOpen(true)
    const onHash = () => {
      if (window.location.hash === '#convert') setOpen(true)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  function close() {
    setOpen(false)
    setError(null)
  }

  function updateField(key: string, value: string) {
    setFormValues((prev) => ({ ...prev, [key]: value }))
  }

  function validateForm(): string | null {
    for (const field of enabledFields) {
      const value = (formValues[field.key] ?? '').trim()
      if (!value && field.required) {
        return `Please fill in ${field.label}.`
      }
      if (field.key === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return 'Please enter a valid email address.'
      }
    }
    return null
  }

  async function submitFormStep(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }
    if (hasPayment) {
      setStep('payment')
      return
    }
    await submitAll()
  }

  async function handleProofUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/action-pages/${slug}/payment-proofs`, {
        method: 'POST',
        body: fd,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'upload_failed')
      setProofUrl(body.url)
      setProofFileId(body.fileId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload_failed')
    } finally {
      setUploading(false)
    }
  }

  async function submitAll(): Promise<void> {
    setSubmitting(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('slug', slug)
      if (claims) {
        fd.append('p', claims.psid)
        fd.append('g', claims.pageId)
        fd.append('e', String(claims.exp))
        if (rawToken) fd.append('t', rawToken)
      }
      for (const field of enabledFields) {
        const value = (formValues[field.key] ?? '').trim()
        if (value) fd.append(field.key, value)
      }
      if (hasPayment && methodId) {
        fd.append('data.payment_method_id', methodId)
        fd.append('data.payment_proof_url', proofUrl)
        if (proofFileId) fd.append('data.payment_proof_file_id', proofFileId)
        if (amount) fd.append('data.payment_amount', amount)
        if (currency) fd.append('data.payment_currency', currency)
        if (note) fd.append('data.payment_note', note)
      }

      const res = await fetch('/api/action-pages/submit', {
        method: 'POST',
        body: fd,
        redirect: 'manual',
      })
      // The submit endpoint returns a 303 redirect for FormData posts. With
      // redirect: 'manual' the browser surfaces it as an opaque response;
      // treat that as success. JSON callers would get { ok: true }.
      if (res.type === 'opaqueredirect' || res.ok) {
        setStep('done')
      } else {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? 'submit_failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'submit_failed')
    } finally {
      setSubmitting(false)
    }
  }

  const paymentReady =
    !!methodId &&
    Number(amount) > 0 &&
    !!proofUrl &&
    !uploading &&
    !submitting

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setStep('form')
          setOpen(true)
        }}
        className="w-full rounded-md px-5 py-3 text-[15px] font-semibold shadow-sm"
        style={{ backgroundColor: accent, color: ctaFg }}
      >
        {ctaLabel}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) close()
          }}
        >
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
              <div className="flex items-center gap-3">
                {step === 'payment' && hasPayment ? (
                  <button
                    type="button"
                    onClick={() => {
                      setStep('form')
                      setError(null)
                    }}
                    className="text-[12px] font-medium text-[#6B7280] hover:text-[#111827]"
                  >
                    ← Back
                  </button>
                ) : null}
                <h3 className="text-[15px] font-semibold text-[#111827]">
                  {step === 'done'
                    ? 'All set'
                    : step === 'payment'
                      ? 'Payment'
                      : ctaLabel}
                </h3>
              </div>
              <button
                type="button"
                onClick={close}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[#6B7280] hover:bg-[#F3F4F6]"
                aria-label="Close"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {hasPayment && step !== 'done' ? (
              <div className="flex items-center gap-2 border-b border-[#F3F4F6] px-5 py-2 text-[11px] font-medium text-[#6B7280]">
                <span
                  className={step === 'form' ? 'text-[#111827]' : ''}
                >
                  1. Your details
                </span>
                <span>›</span>
                <span
                  className={step === 'payment' ? 'text-[#111827]' : ''}
                >
                  2. Payment
                </span>
              </div>
            ) : null}

            <div className="p-5">
              {step === 'form' ? (
                <form onSubmit={submitFormStep} className="space-y-4">
                  {enabledFields.map((field) => (
                    <div key={field.key} className="space-y-1">
                      <label
                        htmlFor={`sf-${field.key}`}
                        className="block text-[12px] font-semibold text-[#374151]"
                      >
                        {field.label}
                        {field.required ? (
                          <span className="ml-0.5 text-red-600">*</span>
                        ) : null}
                      </label>
                      {field.key === 'message' ? (
                        <textarea
                          id={`sf-${field.key}`}
                          name={field.key}
                          required={field.required}
                          rows={4}
                          value={formValues[field.key] ?? ''}
                          onChange={(e) => updateField(field.key, e.target.value)}
                          className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
                        />
                      ) : (
                        <input
                          id={`sf-${field.key}`}
                          name={field.key}
                          type={inputTypeFor(field.key)}
                          required={field.required}
                          value={formValues[field.key] ?? ''}
                          onChange={(e) => updateField(field.key, e.target.value)}
                          className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
                        />
                      )}
                    </div>
                  ))}
                  {error ? (
                    <p className="text-[13px] text-red-600">{error}</p>
                  ) : null}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full rounded-md px-4 py-3 text-[14px] font-semibold disabled:opacity-50"
                    style={{ backgroundColor: accent, color: ctaFg }}
                  >
                    {submitting
                      ? 'Submitting…'
                      : hasPayment
                        ? 'Continue to payment'
                        : submitButtonLabel}
                  </button>
                </form>
              ) : null}

              {step === 'payment' && hasPayment ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (paymentReady) void submitAll()
                  }}
                  className="grid gap-4"
                >
                  <fieldset className="grid gap-2">
                    <legend className="text-[12px] font-semibold text-[#374151]">
                      Payment method
                    </legend>
                    {paymentMethods.map((m) => (
                      <label
                        key={m.id}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3"
                        style={
                          methodId === m.id
                            ? {
                                borderColor: accent,
                                background: `${accent}10`,
                              }
                            : undefined
                        }
                      >
                        <input
                          type="radio"
                          name="method"
                          className="mt-1"
                          checked={methodId === m.id}
                          onChange={() => setMethodId(m.id)}
                        />
                        <div className="flex-1">
                          <div className="text-[14px] font-medium">{m.name}</div>
                          {m.account_name ? (
                            <div className="text-[12px] text-gray-600">{m.account_name}</div>
                          ) : null}
                          {m.account_number ? (
                            <div className="text-[12px] text-gray-600">{m.account_number}</div>
                          ) : null}
                          {m.instructions ? (
                            <p className="mt-1 whitespace-pre-line text-[12px] text-gray-700">
                              {m.instructions}
                            </p>
                          ) : null}
                          {m.qr_image_url ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={m.qr_image_url}
                              alt="QR"
                              className="mt-2 h-32 w-32 rounded border"
                            />
                          ) : null}
                        </div>
                      </label>
                    ))}
                  </fieldset>

                  <div className="grid grid-cols-[1fr_120px] gap-2">
                    <label className="grid gap-1 text-[12px] font-semibold text-[#374151]">
                      Amount
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="rounded border border-gray-300 p-2 text-[14px] font-normal"
                        required
                      />
                    </label>
                    <label className="grid gap-1 text-[12px] font-semibold text-[#374151]">
                      Currency
                      <input
                        value={currency}
                        onChange={(e) =>
                          setCurrency(e.target.value.toUpperCase().slice(0, 3))
                        }
                        className="rounded border border-gray-300 p-2 text-[14px] font-normal"
                        required
                      />
                    </label>
                  </div>

                  <label className="grid gap-1 text-[12px] font-semibold text-[#374151]">
                    Payment screenshot (required)
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleProofUpload}
                      className="text-[12px] font-normal"
                    />
                    {uploading ? (
                      <span className="text-[12px] font-normal">Uploading…</span>
                    ) : null}
                    {proofUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={proofUrl}
                        alt="Proof"
                        className="mt-1 h-32 w-32 rounded border object-cover"
                      />
                    ) : null}
                  </label>

                  <label className="grid gap-1 text-[12px] font-semibold text-[#374151]">
                    Note (optional)
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="rounded border border-gray-300 p-2 text-[14px] font-normal"
                      maxLength={500}
                    />
                  </label>

                  {error ? (
                    <p className="text-[13px] text-red-600">{error}</p>
                  ) : null}

                  <button
                    type="submit"
                    disabled={!paymentReady}
                    className="w-full rounded-md px-4 py-3 text-[14px] font-semibold disabled:opacity-50"
                    style={{ backgroundColor: accent, color: ctaFg }}
                  >
                    {submitting ? 'Submitting…' : 'Submit payment proof'}
                  </button>
                </form>
              ) : null}

              {step === 'done' ? (
                <div className="text-center">
                  <p className="text-[15px] font-semibold text-[#111827]">
                    {successMessage}
                  </p>
                  <p className="mt-1 text-[13px] text-[#6B7280]">
                    We&apos;ll be in touch shortly.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
