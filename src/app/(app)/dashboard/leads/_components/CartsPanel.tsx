'use client'

import { useEffect, useState, useTransition } from 'react'
import { loadLeadCarts, type LeadCart } from '../actions/carts'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rows: LeadCart[] }

export function CartsPanel({ leadId }: { leadId: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    startTransition(() => setState({ kind: 'loading' }))
    loadLeadCarts(leadId)
      .then((rows) => {
        if (!cancelled) startTransition(() => setState({ kind: 'ready', rows }))
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          startTransition(() =>
            setState({
              kind: 'error',
              message: e instanceof Error ? e.message : 'Failed to load',
            }),
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [leadId, startTransition])

  if (state.kind === 'loading') {
    return (
      <div className="text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
        Loading carts…
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
        No carts for this lead yet.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {state.rows.map((c) => (
        <CartCard key={c.id} cart={c} />
      ))}
    </div>
  )
}

function CartCard({ cart }: { cart: LeadCart }) {
  const [open, setOpen] = useState(false)
  const when = new Date(cart.created_at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  const itemCount = cart.items.reduce((sum, i) => sum + i.quantity, 0)
  const subtotal =
    cart.total_amount ??
    cart.items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0)

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
          Cart
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-medium"
          style={{ color: 'var(--lead-ink)' }}
        >
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
          {cart.action_page_title ? ` · ${cart.action_page_title}` : ''}
          {' · '}
          {formatMoney(subtotal, cart.currency)}
        </span>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
          style={{
            background: statusBg(cart.status),
            color: statusFg(cart.status),
          }}
        >
          {cart.status}
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
          {cart.items.length === 0 ? (
            <div className="text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
              Empty cart.
            </div>
          ) : (
            <table className="w-full text-[12.5px]">
              <tbody>
                {cart.items.map((item) => (
                  <tr key={item.id}>
                    <td className="py-1.5 pr-2" style={{ color: 'var(--lead-ink)' }}>
                      <span className="font-medium">{item.name}</span>
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
                      {formatMoney(item.unit_price, cart.currency)}
                    </td>
                    <td
                      className="py-1.5 pl-2 text-right tabular-nums"
                      style={{ color: 'var(--lead-ink)' }}
                    >
                      {formatMoney(item.unit_price * item.quantity, cart.currency)}
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
                    {formatMoney(subtotal, cart.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
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

function statusBg(status: LeadCart['status']): string {
  if (status === 'converted') return 'rgba(5,150,105,0.12)'
  if (status === 'abandoned') return 'rgba(217,119,6,0.12)'
  return 'var(--lead-surface-2)'
}

function statusFg(status: LeadCart['status']): string {
  if (status === 'converted') return '#047857'
  if (status === 'abandoned') return '#B45309'
  return 'var(--lead-body)'
}
