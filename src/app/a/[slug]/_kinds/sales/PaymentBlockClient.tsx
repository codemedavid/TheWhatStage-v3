'use client'
import { useState } from 'react'
import type { PublicPaymentMethod } from '@/lib/payment-methods/public'

interface Claims { psid: string; pageId: string; exp: number }

interface Props {
  slug: string
  pageId: string
  methods: PublicPaymentMethod[]
  accent: string
  claims: Claims | null
  rawToken: string | null
  defaultCurrency: string
}

export default function PaymentBlockClient({
  slug, methods, accent, claims, rawToken, defaultCurrency,
}: Props) {
  const [methodId, setMethodId] = useState<string>(methods.length === 1 ? methods[0].id : '')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(defaultCurrency)
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [note, setNote] = useState('')
  const [proofUrl, setProofUrl] = useState('')
  const [proofFileId, setProofFileId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const ready =
    !!methodId && Number(amount) > 0 && name.trim() && contact.trim() && !!proofUrl

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/action-pages/${slug}/payment-proofs`, {
        method: 'POST', body: fd,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'upload_failed')
      setProofUrl(body.url); setProofFileId(body.fileId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload_failed')
    } finally {
      setUploading(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready) return
    setSubmitting(true); setError(null)
    try {
      const fd = new FormData()
      fd.append('slug', slug)
      if (claims) {
        fd.append('p', claims.psid)
        fd.append('g', claims.pageId)
        fd.append('e', String(claims.exp))
        if (rawToken) fd.append('t', rawToken)
      }
      fd.append('data.payment_method_id', methodId)
      fd.append('data.payment_proof_url', proofUrl)
      fd.append('data.payment_proof_file_id', proofFileId)
      fd.append('data.payment_amount', amount)
      fd.append('data.payment_currency', currency)
      fd.append('data.payment_note', note)
      fd.append('data.contact_name', name)
      fd.append('data.contact_phone', contact)
      fd.append('outcome', 'payment_submitted')

      const res = await fetch('/api/action-pages/submit', { method: 'POST', body: fd })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? 'submit_failed')
      }
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'submit_failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <p className="text-lg font-semibold">Thanks — we&apos;ve received your payment proof.</p>
        <p className="mt-1 text-sm text-gray-600">We&apos;ll confirm shortly.</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <h3 className="text-lg font-semibold">Proceed to payment</h3>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Payment method</legend>
        {methods.map((m) => (
          <label
            key={m.id}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3"
            style={methodId === m.id ? { borderColor: accent, background: `${accent}10` } : undefined}
          >
            <input
              type="radio" name="method" className="mt-1"
              checked={methodId === m.id}
              onChange={() => setMethodId(m.id)}
            />
            <div className="flex-1">
              <div className="font-medium">{m.name}</div>
              {m.account_name ? <div className="text-xs text-gray-600">{m.account_name}</div> : null}
              {m.account_number ? <div className="text-xs text-gray-600">{m.account_number}</div> : null}
              {m.instructions ? (
                <p className="mt-1 whitespace-pre-line text-xs text-gray-700">{m.instructions}</p>
              ) : null}
              {m.qr_image_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={m.qr_image_url} alt="QR" className="mt-2 h-32 w-32 rounded border" />
              ) : null}
            </div>
          </label>
        ))}
      </fieldset>

      <div className="grid grid-cols-[1fr_120px] gap-2">
        <label className="grid gap-1 text-sm">
          Amount
          <input
            type="number" min="0" step="0.01" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="rounded border border-gray-300 p-2"
            required
          />
        </label>
        <label className="grid gap-1 text-sm">
          Currency
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            className="rounded border border-gray-300 p-2"
            required
          />
        </label>
      </div>

      <label className="grid gap-1 text-sm">
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)}
               className="rounded border border-gray-300 p-2" required />
      </label>
      <label className="grid gap-1 text-sm">
        Phone or email
        <input value={contact} onChange={(e) => setContact(e.target.value)}
               className="rounded border border-gray-300 p-2" required />
      </label>

      <label className="grid gap-1 text-sm">
        Payment screenshot (required)
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile} />
        {uploading ? <span className="text-xs">Uploading…</span> : null}
        {proofUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={proofUrl} alt="Proof" className="mt-1 h-32 w-32 rounded border object-cover" />
        ) : null}
      </label>

      <label className="grid gap-1 text-sm">
        Note (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)}
                  className="rounded border border-gray-300 p-2" maxLength={500} />
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={!ready || submitting || uploading}
        className="rounded-lg px-4 py-2 font-semibold text-white disabled:opacity-50"
        style={{ background: accent }}
      >
        {submitting ? 'Submitting…' : 'Submit payment proof'}
      </button>
    </form>
  )
}
