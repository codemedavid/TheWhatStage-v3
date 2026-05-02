import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { OrderList } from '../_components/OrderList'
import { fetchOrders } from '../_lib/queries'
import { PageHeader } from '../_components/ui'

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const all = await fetchOrders(supabase, user.id)
  const activeStatus = sp.status ?? 'all'
  const orders = activeStatus === 'all' ? all : all.filter((o) => o.status === activeStatus)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Orders"
        description="Capture orders submitted from your catalog pages."
        back={{ href: '/dashboard/business', label: 'My Business' }}
      />

      <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_0_rgba(17,24,39,0.04)]">
        <nav className="flex flex-wrap gap-1 border-b border-[#F3F4F6] px-4 py-3">
          {TABS.map((tab) => {
            const isActive = tab.value === activeStatus
            const href =
              tab.value === 'all'
                ? '/dashboard/business/orders'
                : `/dashboard/business/orders?status=${tab.value}`
            return (
              <Link
                key={tab.value}
                href={href}
                className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition ${
                  isActive
                    ? 'bg-[#F3F4F6] text-[#111827]'
                    : 'text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#111827]'
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>
        <OrderList orders={orders} filtered={activeStatus !== 'all'} />
      </div>
    </div>
  )
}
