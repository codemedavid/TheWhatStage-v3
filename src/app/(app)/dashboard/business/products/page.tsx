import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProductList } from '../_components/ProductList'
import { fetchProducts } from '../_lib/queries'
import { createProduct } from './actions'
import { PageHeader } from '../_components/ui'

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'published', label: 'Active' },
  { value: 'draft', label: 'Drafts' },
  { value: 'archived', label: 'Archived' },
] as const

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const products = await fetchProducts(supabase, user.id, sp)
  const activeStatus = sp.status ?? 'all'
  const q = sp.q ?? ''

  return (
    <div className="space-y-5">
      <PageHeader
        title="Products"
        description="Reusable items for your chatbot, catalog pages, and recommendations."
        back={{ href: '/dashboard/business', label: 'My Business' }}
        actions={
          <form action={createProduct}>
            <button
              type="submit"
              className="rounded-md bg-[#059669] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#047857]"
            >
              Add product
            </button>
          </form>
        }
      />

      <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_0_rgba(17,24,39,0.04)]">
        <div className="flex flex-col gap-3 border-b border-[#F3F4F6] px-4 py-3 md:flex-row md:items-center md:justify-between">
          <nav className="flex flex-wrap gap-1">
            {TABS.map((tab) => {
              const isActive = tab.value === activeStatus
              const params = new URLSearchParams()
              if (tab.value !== 'all') params.set('status', tab.value)
              if (q) params.set('q', q)
              const href = params.toString()
                ? `/dashboard/business/products?${params.toString()}`
                : '/dashboard/business/products'
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
          <form className="flex items-center gap-2" action="/dashboard/business/products">
            {activeStatus !== 'all' && <input type="hidden" name="status" value={activeStatus} />}
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]"
              >
                ⌕
              </span>
              <input
                name="q"
                defaultValue={q}
                placeholder="Search products"
                className="w-56 rounded-md border border-[#E5E7EB] bg-white py-1.5 pl-7 pr-3 text-[13px] text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:outline-none focus:ring-1 focus:ring-[#059669]"
              />
            </div>
          </form>
        </div>
        <ProductList products={products} status={activeStatus} q={q} />
      </div>
    </div>
  )
}
