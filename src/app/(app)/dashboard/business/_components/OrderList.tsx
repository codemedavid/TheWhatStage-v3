import Link from 'next/link'
import type { OrderListItem } from '../_lib/queries'
import { StatusBadge, orderStatusTone } from './ui'

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${currency} ${amount}`
  }
}

export function OrderList({ orders, filtered }: { orders: OrderListItem[]; filtered?: boolean }) {
  if (orders.length === 0) {
    return (
      <div className="px-6 py-14 text-center">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-[#F3F4F6] text-[#6B7280]">
          ◯
        </div>
        <h2 className="text-[14px] font-semibold text-[#111827]">
          {filtered ? 'No orders match this filter' : 'No orders yet'}
        </h2>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-[#6B7280]">
          {filtered
            ? 'Try a different status tab.'
            : 'Catalog orders will appear here after a customer submits a cart.'}
        </p>
      </div>
    )
  }
  return (
    <table className="min-w-full text-[13px]">
      <thead className="bg-[#FAFAFA] text-left text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
        <tr>
          <th className="px-4 py-2.5">Customer</th>
          <th className="px-3 py-2.5">Status</th>
          <th className="px-3 py-2.5">Payment</th>
          <th className="px-3 py-2.5 text-right">Total</th>
          <th className="px-4 py-2.5">Created</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#F3F4F6]">
        {orders.map((order) => (
          <tr key={order.id} className="group hover:bg-[#FAFAFA]">
            <td className="px-4 py-3">
              <Link
                href={`/dashboard/business/orders/${order.id}`}
                className="font-medium text-[#111827] group-hover:text-[#047857]"
              >
                {order.customer_name || 'Unnamed customer'}
              </Link>
              <div className="mt-0.5 text-[12px] text-[#9CA3AF]">{order.customer_phone || 'No phone'}</div>
            </td>
            <td className="px-3 py-3">
              <StatusBadge tone={orderStatusTone(order.status)}>{order.status}</StatusBadge>
            </td>
            <td className="px-3 py-3 text-[#6B7280]">{order.payment_status.replaceAll('_', ' ')}</td>
            <td className="px-3 py-3 text-right tabular-nums text-[#111827]">
              {formatMoney(order.subtotal_amount, order.currency)}
            </td>
            <td className="px-4 py-3 text-[#6B7280]">
              {new Date(order.created_at).toLocaleDateString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
