'use client'

import { useEffect, useState, useTransition } from 'react'
import { loadLeadOrders, type LeadOrder } from '../actions/orders'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rows: LeadOrder[] }

export function OrdersPanel({ leadId }: { leadId: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    startTransition(() => setState({ kind: 'loading' }))
    loadLeadOrders(leadId)
      .then((rows) => {
        if (!cancelled) startTransition(() => setState({ kind: 'ready', rows }))
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          startTransition(() => setState({
            kind: 'error',
            message: e instanceof Error ? e.message : 'Failed to load',
          }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [leadId, startTransition])

  if (state.kind === 'loading') {
    return (
      <div className="text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
        Loading orders…
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className="text-[12.5px]" style={{ color: 'var(--lead-danger)' }}>
        {state.message}
      </div>
    )
  }
  if (state.rows.length === 0) {
    return (
      <div
        className="rounded-lg p-4 text-[12.5px]"
        style={{
          background: 'var(--lead-surface-2)',
          border: '1px solid var(--lead-line)',
          color: 'var(--lead-muted)',
        }}
      >
        No orders for this lead yet.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {state.rows.map((o) => (
        <OrderCard key={o.id} order={o} />
      ))}
    </div>
  )
}

function OrderCard({ order }: { order: LeadOrder }) {
  const [open, setOpen] = useState(false)
  const when = new Date(order.created_at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  const itemCount = order.items.reduce((sum, i) => sum + i.quantity, 0)
  return (
    <div
      className="rounded-lg"
      style={{
        background: 'var(--lead-surface)',
        border: '1px solid var(--lead-line)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="lead-focus flex w-full items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{
            background: 'var(--lead-surface-2)',
            color: 'var(--lead-muted)',
          }}
        >
          Order
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-medium"
          style={{ color: 'var(--lead-ink)' }}
        >
          {itemCount} {itemCount === 1 ? 'item' : 'items'} ·{' '}
          {formatMoney(order.subtotal_amount, order.currency)}
        </span>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
          style={{
            background: statusBg(order.status),
            color: statusFg(order.status),
          }}
        >
          {order.status}
        </span>
        <span
          className="shrink-0 text-[11px] tabular-nums"
          style={{ color: 'var(--lead-faint)' }}
        >
          {when}
        </span>
      </button>
      {open && (
        <div
          className="border-t px-3 py-2.5"
          style={{ borderColor: 'var(--lead-line)' }}
        >
          {order.items.length === 0 ? (
            <div className="text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
              No line items recorded.
            </div>
          ) : (
            <table className="w-full text-[12.5px]">
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-1.5 pr-2" style={{ color: 'var(--lead-ink)' }}>
                      <span className="font-medium">{item.title_snapshot}</span>
                      {item.sku_snapshot && (
                        <span
                          className="ml-1.5 text-[11px]"
                          style={{ color: 'var(--lead-faint)' }}
                        >
                          {item.sku_snapshot}
                        </span>
                      )}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right tabular-nums"
                      style={{ color: 'var(--lead-muted)' }}
                    >
                      × {item.quantity}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right tabular-nums"
                      style={{ color: 'var(--lead-muted)' }}
                    >
                      {formatMoney(item.unit_amount, item.currency)}
                    </td>
                    <td
                      className="py-1.5 pl-2 text-right tabular-nums"
                      style={{ color: 'var(--lead-ink)' }}
                    >
                      {formatMoney(item.line_total_amount, item.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '1px solid var(--lead-line)' }}>
                  <td
                    colSpan={3}
                    className="py-2 pr-2 text-right text-[11.5px] font-medium"
                    style={{ color: 'var(--lead-muted)' }}
                  >
                    Subtotal
                  </td>
                  <td
                    className="py-2 pl-2 text-right text-[13px] font-semibold tabular-nums"
                    style={{ color: 'var(--lead-ink)' }}
                  >
                    {formatMoney(order.subtotal_amount, order.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          <div
            className="mt-3 grid grid-cols-2 gap-2 text-[11.5px]"
            style={{ color: 'var(--lead-muted)' }}
          >
            <div>
              <span style={{ color: 'var(--lead-faint)' }}>Payment</span>{' '}
              <span style={{ color: 'var(--lead-body)' }}>
                {order.payment_status.replaceAll('_', ' ')}
              </span>
            </div>
            {order.customer_phone && (
              <div className="truncate">
                <span style={{ color: 'var(--lead-faint)' }}>Phone</span>{' '}
                <span style={{ color: 'var(--lead-body)' }}>{order.customer_phone}</span>
              </div>
            )}
            {order.customer_email && (
              <div className="col-span-2 truncate">
                <span style={{ color: 'var(--lead-faint)' }}>Email</span>{' '}
                <span style={{ color: 'var(--lead-body)' }}>{order.customer_email}</span>
              </div>
            )}
          </div>

          {order.customer_notes && (
            <div
              className="mt-2 whitespace-pre-wrap rounded px-2 py-1.5 text-[12px]"
              style={{
                background: 'var(--lead-surface-2)',
                color: 'var(--lead-body)',
              }}
            >
              {order.customer_notes}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount}`
  }
}

function statusBg(status: LeadOrder['status']): string {
  if (status === 'fulfilled' || status === 'confirmed') return 'rgba(5,150,105,0.12)'
  if (status === 'cancelled') return 'rgba(220,38,38,0.10)'
  return 'var(--lead-surface-2)'
}

function statusFg(status: LeadOrder['status']): string {
  if (status === 'fulfilled' || status === 'confirmed') return '#047857'
  if (status === 'cancelled') return '#B91C1C'
  return 'var(--lead-body)'
}
