import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatPrice } from '@/lib/business/pricing'
import { fetchBusinessStats } from './_lib/queries'
import { createProduct } from './products/actions'
import { PageHeader, SectionCard, StatTile, StatusBadge, orderStatusTone, productStatusTone } from './_components/ui'

export default async function BusinessIndexPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const stats = await fetchBusinessStats(supabase, user.id)

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Business"
        description="Sell products and capture orders straight from your chatbot and catalog pages."
        actions={
          <>
            <Link
              href="/dashboard/business/products"
              className="rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-[13px] font-medium text-[#374151] hover:border-[#D1D5DB]"
            >
              View all products
            </Link>
            <form action={createProduct}>
              <button
                type="submit"
                className="rounded-md bg-[#059669] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#047857]"
              >
                Add product
              </button>
            </form>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Products" value={stats.totalProducts} hint={`${stats.publishedProducts} live`} />
        <StatTile label="Drafts" value={stats.draftProducts} hint="Not yet published" />
        <StatTile label="Orders" value={stats.totalOrders} hint={`${stats.newOrders} new`} />
        <StatTile label="Archived" value={stats.archivedProducts} hint="Hidden from catalog" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SectionCard
          title="Recent products"
          description="Latest changes in your catalog."
          actions={
            <Link
              href="/dashboard/business/products"
              className="text-[12.5px] font-medium text-[#047857] hover:underline"
            >
              See all
            </Link>
          }
        >
          {stats.recentProducts.length === 0 ? (
            <EmptyHint label="No products yet." />
          ) : (
            <ul className="-mx-1 divide-y divide-[#F3F4F6]">
              {stats.recentProducts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-1 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/dashboard/business/products/${p.id}`}
                      className="block truncate text-[13.5px] font-medium text-[#111827] hover:text-[#047857]"
                    >
                      {p.title}
                    </Link>
                    <div className="mt-0.5 truncate text-[12px] text-[#9CA3AF]">{p.summary ?? p.slug}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge tone={productStatusTone(p.status)}>{p.status}</StatusBadge>
                    <span className="w-24 text-right text-[12.5px] tabular-nums text-[#374151]">
                      {formatPrice({
                        amount: p.price_amount,
                        currency: p.currency,
                        pricingModel: p.pricing_model,
                      })}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Recent orders"
          description="Latest captures from your catalog pages."
          actions={
            <Link
              href="/dashboard/business/orders"
              className="text-[12.5px] font-medium text-[#047857] hover:underline"
            >
              See all
            </Link>
          }
        >
          {stats.recentOrders.length === 0 ? (
            <EmptyHint label="No orders yet." />
          ) : (
            <ul className="-mx-1 divide-y divide-[#F3F4F6]">
              {stats.recentOrders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 px-1 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/dashboard/business/orders/${o.id}`}
                      className="block truncate text-[13.5px] font-medium text-[#111827] hover:text-[#047857]"
                    >
                      {o.customer_name || 'Unnamed customer'}
                    </Link>
                    <div className="mt-0.5 text-[12px] text-[#9CA3AF]">
                      {new Date(o.created_at).toLocaleDateString()} · {o.customer_phone || 'no phone'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge tone={orderStatusTone(o.status)}>{o.status}</StatusBadge>
                    <span className="w-24 text-right text-[12.5px] tabular-nums text-[#374151]">
                      {formatMoney(o.subtotal_amount, o.currency)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  )
}

function EmptyHint({ label }: { label: string }) {
  return <div className="py-6 text-center text-[12.5px] text-[#9CA3AF]">{label}</div>
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${currency} ${amount}`
  }
}
