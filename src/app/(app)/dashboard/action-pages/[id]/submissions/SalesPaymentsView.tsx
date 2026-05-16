'use client'

import { useTransition } from 'react'
import type { OrderPayment } from '@/lib/order-payments/types'
import { verifyPayment, rejectPayment } from './payment-actions'

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface SalesPaymentRow {
  payment: OrderPayment
  submission: {
    id: string
    created_at: string
    data: Record<string, unknown>
  }
}

interface Props {
  payments: SalesPaymentRow[]
  actionPageId: string
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function relTime(isoStr: string) {
  const ms = Date.now() - new Date(isoStr).getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const wk = Math.floor(day / 7)
  if (wk < 5) return `${wk}w ago`
  const mo = Math.floor(day / 30)
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(day / 365)}y ago`
}

function truncate(str: string | null | undefined, max: number): string {
  if (!str) return '—'
  return str.length > max ? str.slice(0, max) + '…' : str
}

/* ------------------------------------------------------------------ */
/*  Status pill meta                                                    */
/* ------------------------------------------------------------------ */

const STATUS_META: Record<string, { label: string; bg: string; ink: string; dot: string }> = {
  submitted: {
    label: 'Awaiting verification',
    bg: 'rgba(217,119,6,0.10)',
    ink: '#92400E',
    dot: '#D97706',
  },
  verified: {
    label: 'Verified',
    bg: 'rgba(31,122,77,0.10)',
    ink: '#1F5C3A',
    dot: '#1F7A4D',
  },
  rejected: {
    label: 'Rejected',
    bg: 'rgba(220,38,38,0.10)',
    ink: '#991B1B',
    dot: '#DC2626',
  },
}

/* ------------------------------------------------------------------ */
/*  PaymentActions (local copy — small enough)                         */
/* ------------------------------------------------------------------ */

function PaymentActions({
  paymentId,
  pageId,
}: {
  paymentId: string
  pageId: string
}) {
  const [pending, start] = useTransition()

  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => verifyPayment(paymentId, pageId))}
        className="rounded border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50"
        style={{
          borderColor: '#1F7A4D',
          color: '#1F5C3A',
          background: 'rgba(31,122,77,0.06)',
        }}
      >
        Mark as paid
      </button>
      <details className="inline-block">
        <summary
          className="cursor-pointer list-none rounded border px-2 py-1 text-xs font-medium"
          style={{
            borderColor: '#DC2626',
            color: '#991B1B',
            background: 'rgba(220,38,38,0.06)',
          }}
        >
          Reject…
        </summary>
        <form
          className="mt-1 grid gap-1"
          action={async (fd: FormData) => {
            const reason = String(fd.get('reason') ?? '').trim()
            if (!reason) return
            await rejectPayment(paymentId, reason, pageId)
          }}
        >
          <textarea
            name="reason"
            required
            maxLength={500}
            placeholder="Reason for rejection…"
            className="w-full rounded border p-1.5 text-xs outline-none"
            style={{ borderColor: '#E8E6DE', color: '#1A1915', minWidth: '200px' }}
            rows={3}
          />
          <button
            type="submit"
            className="rounded px-2 py-1 text-xs font-medium text-white"
            style={{ background: '#DC2626' }}
          >
            Submit rejection
          </button>
        </form>
      </details>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Status Pill                                                         */
/* ------------------------------------------------------------------ */

function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.submitted
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ background: m.bg, color: m.ink }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.dot }} />
      {m.label}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export default function SalesPaymentsView({ payments, actionPageId }: Props) {
  return (
    <section className="rounded-2xl border border-[#E8E6DE] bg-white overflow-hidden">
      {/* Section header */}
      <div className="flex items-baseline gap-3 border-b border-[#E8E6DE] px-5 py-4">
        <h2 className="text-[15px] font-semibold text-[#1A1915]">Payments</h2>
        <span className="text-[13px] text-[#6B6960]">
          {payments.length} received
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#F0EFE8]" style={{ background: '#FAFAF7' }}>
              {[
                'Created',
                'Buyer',
                'Method',
                'Amount',
                'Note',
                'Proof',
                'Status',
                'Actions',
              ].map((col) => (
                <th
                  key={col}
                  className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide"
                  style={{ color: '#9C9A90' }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payments.map(({ payment: p, submission: s }) => {
              const data = s.data as Record<string, unknown>
              const buyerName =
                typeof data.contact_name === 'string' && data.contact_name
                  ? data.contact_name
                  : 'Unknown'
              const buyerContact =
                typeof data.contact_phone === 'string' && data.contact_phone
                  ? data.contact_phone
                  : typeof data.contact_email === 'string' && data.contact_email
                    ? data.contact_email
                    : null

              const amountStr =
                p.amount != null
                  ? `${p.amount.toLocaleString()} ${p.currency ?? ''}`
                  : '—'

              return (
                <tr
                  key={p.id}
                  className="border-b border-[#F6F5F1] last:border-b-0 hover:bg-[#FAFAF7] transition-colors"
                >
                  {/* Created */}
                  <td className="whitespace-nowrap px-4 py-3 text-[#6B6960]">
                    {relTime(s.created_at)}
                  </td>

                  {/* Buyer */}
                  <td className="px-4 py-3">
                    <div className="font-medium text-[#1A1915]">{buyerName}</div>
                    {buyerContact && (
                      <div className="text-[11px] text-[#9C9A90]">{buyerContact}</div>
                    )}
                  </td>

                  {/* Method */}
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-[#1A1915]">{p.method_name}</span>
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{ background: '#EFEEE8', color: '#6B6960' }}
                      >
                        {p.method_kind}
                      </span>
                    </div>
                  </td>

                  {/* Amount */}
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-[#1A1915]">
                    {amountStr}
                  </td>

                  {/* Note */}
                  <td className="px-4 py-3 text-[#6B6960]">
                    {truncate(p.note, 60)}
                  </td>

                  {/* Proof */}
                  <td className="px-4 py-3">
                    {p.proof_url ? (
                      <a
                        href={p.proof_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block overflow-hidden rounded-lg border border-[#D9D6CC] transition-opacity hover:opacity-80"
                        title="View payment proof"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.proof_url}
                          alt="Payment proof"
                          width={40}
                          height={40}
                          className="h-10 w-10 object-cover"
                        />
                      </a>
                    ) : (
                      <span className="text-[#9C9A90]">—</span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <StatusPill status={p.status} />
                      {p.status === 'rejected' && p.rejection_reason && (
                        <p className="text-[11px] text-[#991B1B]">
                          {p.rejection_reason}
                        </p>
                      )}
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    {p.status === 'submitted' ? (
                      <PaymentActions paymentId={p.id} pageId={actionPageId} />
                    ) : (
                      <span className="text-[11px] text-[#9C9A90]">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
