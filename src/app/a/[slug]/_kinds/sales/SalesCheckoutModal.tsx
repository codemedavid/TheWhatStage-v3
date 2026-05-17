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
  priceLabel: string | null
  productName: string
  productTypeLabel: string
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function CopyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
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
  priceLabel,
  productName,
  productTypeLabel,
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
  const fixedAmount = priceAmount && priceAmount > 0 ? String(priceAmount) : ''
  const currency = defaultCurrency
  const [note, setNote] = useState('')
  const [proofUrl, setProofUrl] = useState('')
  const [proofFileId, setProofFileId] = useState('')
  const [proofName, setProofName] = useState('')
  const [proofSize, setProofSize] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedMethod = useMemo(
    () => paymentMethods.find((m) => m.id === methodId) ?? null,
    [paymentMethods, methodId],
  )

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

  async function uploadProofFile(file: File) {
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
      setProofName(file.name)
      setProofSize(file.size)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload_failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleProofInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadProofFile(file)
  }

  async function handleProofDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    await uploadProofFile(file)
  }

  function removeProof() {
    setProofUrl('')
    setProofFileId('')
    setProofName('')
    setProofSize(0)
  }

  function copy(label: string, value: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(value)
    }
    setCopiedField(label)
    setTimeout(
      () => setCopiedField((c) => (c === label ? null : c)),
      1600,
    )
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
        if (fixedAmount) fd.append('data.payment_amount', fixedAmount)
        if (currency) fd.append('data.payment_currency', currency)
        if (note) fd.append('data.payment_note', note)
      }

      const res = await fetch('/api/action-pages/submit', {
        method: 'POST',
        body: fd,
        redirect: 'manual',
      })
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
    !!methodId && !!proofUrl && !uploading && !submitting

  const firstName = (formValues.name ?? formValues.full_name ?? '')
    .trim()
    .split(/\s+/)[0]
  const refCode = useMemo(
    () => `WS-${Math.floor(Math.random() * 900000 + 100000)}`,
    [],
  )

  const serif = "'Instrument Serif', Georgia, serif"
  const mono =
    "var(--font-geist-mono), ui-monospace, 'SF Mono', Menlo, monospace"

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
          style={{
            backgroundColor: 'rgba(31,30,29,0.55)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) close()
          }}
        >
          <div
            className="relative flex w-full max-w-[560px] flex-col overflow-hidden rounded-[20px] bg-white shadow-2xl"
            style={{ maxHeight: 'calc(100vh - 56px)' }}
          >
            {/* Header */}
            <header
              className="border-b px-5 py-4"
              style={{ background: '#FBF8F1', borderColor: '#E5DFD0' }}
            >
              <div className="flex items-center gap-3">
                {step === 'payment' && hasPayment ? (
                  <button
                    type="button"
                    onClick={() => {
                      setStep('form')
                      setError(null)
                    }}
                    aria-label="Back"
                    className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-[#6B6862] hover:bg-[#F5F1E8] hover:text-[#1F1E1D]"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <line x1="19" y1="12" x2="5" y2="12" />
                      <polyline points="12 19 5 12 12 5" />
                    </svg>
                  </button>
                ) : null}
                <h3
                  className="flex-1 text-[22px] italic"
                  style={{
                    fontFamily: serif,
                    fontWeight: 400,
                    letterSpacing: '-0.01em',
                    color: '#1F1E1D',
                  }}
                >
                  {step === 'done'
                    ? 'All set'
                    : step === 'payment'
                      ? 'Payment'
                      : ctaLabel}
                </h3>
                <button
                  type="button"
                  onClick={close}
                  className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-[#6B6862] hover:bg-[#F5F1E8] hover:text-[#1F1E1D]"
                  aria-label="Close"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {hasPayment && step !== 'done' ? (
                <div
                  className="mt-3 flex items-center gap-2 uppercase"
                  style={{
                    fontFamily: mono,
                    fontSize: 11,
                    letterSpacing: '0.06em',
                  }}
                >
                  <Stepper step={step} accent={accent} />
                </div>
              ) : null}
            </header>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {step === 'form' ? (
                <form onSubmit={submitFormStep} className="space-y-4">
                  {enabledFields.map((field) => (
                    <div key={field.key} className="space-y-1">
                      <label
                        htmlFor={`sf-${field.key}`}
                        className="block text-[13px] font-medium text-[#3A3835]"
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
                          className="w-full rounded-[12px] border bg-white px-3 py-2.5 text-[14px] outline-none"
                          style={{ borderColor: '#E5DFD0' }}
                        />
                      ) : (
                        <input
                          id={`sf-${field.key}`}
                          name={field.key}
                          type={inputTypeFor(field.key)}
                          required={field.required}
                          value={formValues[field.key] ?? ''}
                          onChange={(e) => updateField(field.key, e.target.value)}
                          className="w-full rounded-[12px] border bg-white px-3 py-2.5 text-[14px] outline-none"
                          style={{ borderColor: '#E5DFD0' }}
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
                    className="w-full rounded-full px-4 py-3 text-[14.5px] font-medium disabled:opacity-50"
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
                >
                  {/* Order summary */}
                  <div
                    className="mb-6 flex items-center gap-3.5 rounded-[12px] border p-3.5"
                    style={{ background: '#FBF8F1', borderColor: '#E5DFD0' }}
                  >
                    <div
                      className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-lg italic"
                      style={{
                        background: '#1F1E1D',
                        color: accent,
                        fontFamily: serif,
                        fontSize: 22,
                      }}
                    >
                      {productName.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14.5px] font-medium text-[#1F1E1D]">
                        {productName}
                      </div>
                      <div
                        className="mt-0.5 uppercase"
                        style={{
                          fontFamily: mono,
                          fontSize: 10.5,
                          letterSpacing: '0.06em',
                          color: '#6B6862',
                        }}
                      >
                        {productTypeLabel}
                      </div>
                    </div>
                    <div className="flex flex-col items-end text-right">
                      <span
                        className="uppercase"
                        style={{
                          fontFamily: mono,
                          fontSize: 10,
                          letterSpacing: '0.08em',
                          color: '#6B6862',
                        }}
                      >
                        Total
                      </span>
                      <span
                        className="italic leading-none"
                        style={{
                          fontFamily: serif,
                          fontSize: 24,
                          color: accent,
                          letterSpacing: '-0.01em',
                        }}
                      >
                        {priceLabel ?? `${currency} ${fixedAmount || '—'}`}
                      </span>
                    </div>
                  </div>

                  {/* Section 01 — Payment method / send */}
                  <SectionLabel num="01" title="Send payment" accent={accent} />
                  <p className="-mt-1.5 mb-3.5 text-[13px] leading-[1.5] text-[#6B6862]">
                    Open your banking app and scan the QR, or copy the account
                    details below.
                  </p>

                  {paymentMethods.length > 1 ? (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {paymentMethods.map((m) => {
                        const selected = methodId === m.id
                        return (
                          <button
                            type="button"
                            key={m.id}
                            onClick={() => setMethodId(m.id)}
                            className="rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition"
                            style={
                              selected
                                ? {
                                    background: accent,
                                    color: ctaFg,
                                    borderColor: accent,
                                  }
                                : {
                                    background: 'white',
                                    color: '#3A3835',
                                    borderColor: '#D6CFBE',
                                  }
                            }
                          >
                            {m.name}
                          </button>
                        )
                      })}
                    </div>
                  ) : null}

                  {selectedMethod ? (
                    <div
                      className="mb-4 grid gap-5 rounded-[12px] border p-5"
                      style={{
                        background: '#FBF8F1',
                        borderColor: '#E5DFD0',
                        gridTemplateColumns: selectedMethod.qr_image_url
                          ? '168px 1fr'
                          : '1fr',
                      }}
                    >
                      {selectedMethod.qr_image_url ? (
                        <div className="relative h-[168px] w-[168px] rounded-[10px] bg-white p-2.5 shadow-sm">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={selectedMethod.qr_image_url}
                            alt="QR code"
                            className="h-full w-full object-contain"
                          />
                          <span
                            className="absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded bg-white px-2 py-0.5 uppercase"
                            style={{
                              fontFamily: mono,
                              fontSize: 9,
                              letterSpacing: '0.1em',
                              color: '#6B6862',
                            }}
                          >
                            {selectedMethod.name}
                          </span>
                        </div>
                      ) : null}

                      <div className="flex min-w-0 flex-col gap-2">
                        <AccountRow
                          label="Method"
                          value={selectedMethod.name}
                          mono={mono}
                        />
                        {selectedMethod.account_name ? (
                          <AccountRow
                            label="Account name"
                            value={selectedMethod.account_name}
                            mono={mono}
                          />
                        ) : null}
                        {selectedMethod.bank_name ? (
                          <AccountRow
                            label="Bank"
                            value={selectedMethod.bank_name}
                            mono={mono}
                          />
                        ) : null}
                        {selectedMethod.account_number ? (
                          <AccountRow
                            label="Account number"
                            value={selectedMethod.account_number}
                            monoValue
                            mono={mono}
                            copyKey="acct"
                            copied={copiedField === 'acct'}
                            onCopy={() =>
                              copy('acct', selectedMethod.account_number ?? '')
                            }
                          />
                        ) : null}
                        {selectedMethod.instructions ? (
                          <p className="mt-1 whitespace-pre-line text-[12.5px] leading-[1.5] text-[#3A3835]">
                            {selectedMethod.instructions}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {fixedAmount ? (
                    <div
                      className="mb-6 flex items-start gap-2.5 rounded-[12px] px-3.5 py-2.5 text-[12.5px] leading-[1.5]"
                      style={{
                        background: 'color-mix(in oklab, ' + accent + ' 18%, transparent)',
                        color: '#6E2E1B',
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                        style={{ marginTop: 1, flexShrink: 0, color: accent }}
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                      <span>
                        Send the exact amount:{' '}
                        <strong>{priceLabel ?? `${currency} ${fixedAmount}`}</strong>.
                        Transfer fees may apply on top.
                      </span>
                    </div>
                  ) : null}

                  {/* Section 02 — Upload screenshot */}
                  <SectionLabel
                    num="02"
                    title="Upload your screenshot"
                    accent={accent}
                  />
                  <p className="-mt-1.5 mb-3.5 text-[13px] leading-[1.5] text-[#6B6862]">
                    Drag it here or pick from your device. PNG or JPG.
                  </p>

                  {!proofUrl ? (
                    <label
                      className="block cursor-pointer rounded-[12px] border border-dashed px-4 py-6 text-center transition"
                      style={{
                        borderColor: dragOver ? accent : '#D6CFBE',
                        borderWidth: 1.5,
                        background: dragOver
                          ? 'color-mix(in oklab, ' + accent + ' 12%, #FBF8F1)'
                          : '#FBF8F1',
                      }}
                      onDragOver={(e) => {
                        e.preventDefault()
                        setDragOver(true)
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleProofDrop}
                    >
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={handleProofInput}
                      />
                      <div
                        className="mx-auto mb-2.5 grid h-[38px] w-[38px] place-items-center rounded-[10px] border bg-white"
                        style={{ borderColor: '#E5DFD0', color: accent }}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                      </div>
                      <div className="text-[14.5px] font-medium text-[#1F1E1D]">
                        <span style={{ color: accent }}>
                          {uploading ? 'Uploading…' : 'Tap to upload'}
                        </span>{' '}
                        — or drop a file here
                      </div>
                      <div
                        className="mt-1 uppercase"
                        style={{
                          fontFamily: mono,
                          fontSize: 12,
                          color: '#6B6862',
                          letterSpacing: '0.04em',
                        }}
                      >
                        PNG · JPG · WEBP
                      </div>
                    </label>
                  ) : (
                    <div
                      className="flex items-center gap-3 rounded-[12px] border p-3"
                      style={{
                        background: '#FBF8F1',
                        borderColor: '#5C7C5A',
                      }}
                    >
                      <div
                        className="grid h-11 w-11 flex-shrink-0 place-items-center overflow-hidden rounded-md border bg-white"
                        style={{ borderColor: '#E5DFD0' }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={proofUrl}
                          alt="Proof"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium text-[#1F1E1D]">
                          {proofName || 'Uploaded'}
                        </div>
                        <div
                          className="mt-0.5 uppercase"
                          style={{
                            fontFamily: mono,
                            fontSize: 10.5,
                            letterSpacing: '0.06em',
                            color: '#6B6862',
                          }}
                        >
                          {proofSize ? `${formatBytes(proofSize)} · uploaded` : 'Uploaded'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={removeProof}
                        aria-label="Remove"
                        className="grid h-7 w-7 place-items-center rounded-full text-[#6B6862] hover:bg-[#F2DDD2] hover:text-[#C96442]"
                      >
                        <span className="text-[20px] leading-none">×</span>
                      </button>
                    </div>
                  )}

                  <div className="h-5" />

                  {/* Section 03 — Note */}
                  <SectionLabel num="03" title="Anything else?" accent={accent} />
                  <p className="-mt-1.5 mb-3 text-[13px] leading-[1.5] text-[#6B6862]">
                    Optional. Anything to share with the seller.
                  </p>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="e.g. “Reference 1234567890”"
                    className="w-full rounded-[12px] border bg-white px-3.5 py-3 text-[14px] outline-none"
                    style={{ borderColor: '#E5DFD0', minHeight: 72 }}
                  />

                  {error ? (
                    <p className="mt-3 text-[13px] text-red-600">{error}</p>
                  ) : null}
                </form>
              ) : null}

              {step === 'done' ? (
                <div className="px-2 py-10 text-center">
                  <div
                    className="mx-auto mb-5 grid h-[84px] w-[84px] place-items-center rounded-full"
                    style={{ background: '#DDE7D7', color: '#5C7C5A' }}
                  >
                    <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </div>
                  <h2
                    className="mb-2.5 leading-[1.1]"
                    style={{
                      fontFamily: serif,
                      fontSize: 32,
                      fontWeight: 400,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    Thanks
                    {firstName ? ', ' : '.'}
                    {firstName ? (
                      <em style={{ color: accent }}>{firstName}.</em>
                    ) : null}
                  </h2>
                  <p
                    className="mx-auto mb-6 max-w-[380px] text-[15px] leading-[1.55] text-[#6B6862]"
                  >
                    {successMessage}
                  </p>
                  {hasPayment ? (
                    <div
                      className="mx-auto mb-6 inline-flex items-center gap-2.5 rounded-full border px-4 py-2"
                      style={{
                        background: '#FBF8F1',
                        borderColor: '#E5DFD0',
                        fontFamily: mono,
                        fontSize: 12,
                        color: '#3A3835',
                        letterSpacing: '0.04em',
                      }}
                    >
                      <span
                        className="inline-block h-[7px] w-[7px] rounded-full"
                        style={{ background: '#5C7C5A' }}
                      />
                      Usually ~15 min · we’ll email an update
                    </div>
                  ) : null}
                  <div
                    className="mt-7 flex items-baseline justify-between border-t pt-5 uppercase"
                    style={{
                      borderColor: '#E5DFD0',
                      fontFamily: mono,
                      fontSize: 11,
                      letterSpacing: '0.06em',
                      color: '#6B6862',
                    }}
                  >
                    <span>Ref · {refCode}</span>
                    <span>Submitted · just now</span>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Footer */}
            {step === 'payment' && hasPayment ? (
              <footer
                className="flex items-center justify-between gap-3 border-t bg-white px-6 py-4"
                style={{ borderColor: '#E5DFD0' }}
              >
                <div
                  className="flex items-center gap-1.5 uppercase"
                  style={{
                    fontFamily: mono,
                    fontSize: 10.5,
                    letterSpacing: '0.08em',
                    color: '#6B6862',
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#5C7C5A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span>Secured · WhatStage</span>
                </div>
                <button
                  type="button"
                  disabled={!paymentReady}
                  onClick={() => void submitAll()}
                  className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-[14.5px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ backgroundColor: accent, color: ctaFg }}
                >
                  {submitting ? 'Submitting…' : 'Submit payment proof'}
                  {!submitting ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  ) : null}
                </button>
              </footer>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}

function Stepper({ step, accent }: { step: Step; accent: string }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'form', label: 'Details' },
    { key: 'payment', label: 'Payment' },
    { key: 'done', label: 'Done' },
  ]
  const currentIndex = steps.findIndex((s) => s.key === step)
  return (
    <>
      {steps.map((s, i) => {
        const done = i < currentIndex
        const current = i === currentIndex
        const color = done ? '#5C7C5A' : current ? '#6E2E1B' : '#A19F98'
        return (
          <span
            key={s.key}
            className="contents"
            style={{ color }}
          >
            <span className="inline-flex items-center gap-1.5" style={{ color }}>
              <span
                className="grid h-[18px] w-[18px] place-items-center rounded-full border text-[10px]"
                style={{
                  borderColor: done
                    ? '#5C7C5A'
                    : current
                      ? accent
                      : 'currentColor',
                  background: done ? '#5C7C5A' : current ? accent : 'transparent',
                  color: done || current ? 'white' : 'currentColor',
                }}
              >
                {done ? '✓' : i + 1}
              </span>
              <span>{s.label}</span>
            </span>
            {i < steps.length - 1 ? (
              <span
                className="h-px flex-1"
                style={{ background: done ? '#5C7C5A' : '#D6CFBE' }}
              />
            ) : null}
          </span>
        )
      })}
    </>
  )
}

function SectionLabel({
  num,
  title,
  accent,
}: {
  num: string
  title: string
  accent: string
}) {
  return (
    <div className="mb-3 flex items-baseline gap-2.5">
      <span
        className="rounded-full px-1.5 py-[3px]"
        style={{
          fontFamily:
            "var(--font-geist-mono), ui-monospace, 'SF Mono', Menlo, monospace",
          fontSize: 10,
          letterSpacing: '0.12em',
          color: accent,
          background: 'color-mix(in oklab, ' + accent + ' 18%, transparent)',
        }}
      >
        {num}
      </span>
      <span
        style={{
          fontFamily: "'Instrument Serif', Georgia, serif",
          fontSize: 18,
          letterSpacing: '-0.005em',
          color: '#1F1E1D',
        }}
      >
        {title}
      </span>
    </div>
  )
}

function AccountRow({
  label,
  value,
  monoValue,
  mono,
  copyKey,
  copied,
  onCopy,
}: {
  label: string
  value: string
  monoValue?: boolean
  mono: string
  copyKey?: string
  copied?: boolean
  onCopy?: () => void
}) {
  return (
    <div className="flex flex-col">
      <span
        className="mb-1 uppercase"
        style={{
          fontFamily: mono,
          fontSize: 10,
          letterSpacing: '0.1em',
          color: '#6B6862',
        }}
      >
        {label}
      </span>
      <span
        className="flex items-center gap-2 font-medium text-[#1F1E1D]"
        style={
          monoValue
            ? { fontFamily: mono, fontSize: 14, letterSpacing: '0.04em' }
            : { fontSize: 15 }
        }
      >
        <span className="break-all">{value}</span>
        {copyKey && onCopy ? (
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border bg-white px-2 py-1 uppercase transition"
            style={{
              fontFamily: mono,
              fontSize: 10.5,
              letterSpacing: '0.08em',
              color: copied ? '#5C7C5A' : '#6B6862',
              borderColor: copied ? '#5C7C5A' : '#E5DFD0',
              background: copied ? '#DDE7D7' : 'white',
            }}
          >
            {copied ? (
              <>
                <CheckIcon /> Copied
              </>
            ) : (
              <>
                <CopyIcon /> Copy
              </>
            )}
          </button>
        ) : null}
      </span>
    </div>
  )
}
