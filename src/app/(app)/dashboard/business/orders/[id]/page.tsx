import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchOrder } from '../../_lib/queries'
import { PageHeader, SectionCard, StatusBadge, orderStatusTone } from '../../_components/ui'

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${currency} ${amount}`
  }
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const order = await fetchOrder(supabase, user.id, id)
  if (!order) notFound()

  const itemsTotal = order.items.reduce((acc, i) => acc + i.line_total_amount, 0)

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Order · ${order.customer_name || 'Unnamed customer'}`}
        back={{ href: '/dashboard/business/orders', label: 'Orders' }}
        description={new Date(order.created_at).toLocaleString()}
        actions={
          <>
            <StatusBadge tone={orderStatusTone(order.status)}>{order.status}</StatusBadge>
            <StatusBadge tone="gray">{order.payment_status.replaceAll('_', ' ')}</StatusBadge>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <SectionCard title="Items">
            {order.items.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-[#9CA3AF]">No items on this order.</p>
            ) : (
              <table className="min-w-full text-[13px]">
                <tbody className="divide-y divide-[#F3F4F6]">
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-3 pr-2 font-medium text-[#111827]">{item.title_snapshot}</td>
                      <td className="px-3 py-3 text-[#6B7280]">× {item.quantity}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-[#6B7280]">
                        {formatMoney(item.unit_amount, item.currency)}
                      </td>
                      <td className="py-3 pl-3 text-right tabular-nums text-[#111827]">
                        {formatMoney(item.line_total_amount, item.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-[#E5E7EB]">
                  <tr>
                    <td colSpan={3} className="py-3 pr-3 text-right text-[12.5px] font-medium text-[#6B7280]">
                      Subtotal
                    </td>
                    <td className="py-3 text-right tabular-nums text-[14px] font-semibold text-[#111827]">
                      {formatMoney(itemsTotal, order.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </SectionCard>

          {order.customer_notes && (
            <SectionCard title="Customer notes">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#374151]">
                {order.customer_notes}
              </p>
            </SectionCard>
          )}
        </div>

        <aside className="space-y-5">
          <SectionCard title="Customer">
            <dl className="space-y-2.5 text-[13px]">
              <Row label="Name" value={order.customer_name || '—'} />
              <Row label="Phone" value={order.customer_phone || '—'} />
              <Row label="Email" value={order.customer_email || '—'} />
            </dl>
          </SectionCard>

          <SectionCard title="Summary">
            <dl className="space-y-2.5 text-[13px]">
              <Row label="Status" value={order.status} />
              <Row label="Payment" value={order.payment_status.replaceAll('_', ' ')} />
              <Row label="Currency" value={order.currency} />
              <Row label="Total" value={formatMoney(order.subtotal_amount, order.currency)} strong />
            </dl>
          </SectionCard>
        </aside>
      </div>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12.5px] text-[#6B7280]">{label}</dt>
      <dd className={`text-right tabular-nums ${strong ? 'font-semibold text-[#111827]' : 'text-[#374151]'}`}>
        {value}
      </dd>
    </div>
  )
}
