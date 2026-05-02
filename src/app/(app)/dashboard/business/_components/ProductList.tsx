import Link from 'next/link'
import { formatPrice } from '@/lib/business/pricing'
import type { ProductListItem } from '../_lib/queries'
import { createProduct } from '../products/actions'
import { StatusBadge, productStatusTone } from './ui'

export function ProductList({
  products,
  status,
  q,
}: {
  products: ProductListItem[]
  status?: string
  q?: string
}) {
  if (products.length === 0) {
    const filtered = (status && status !== 'all') || (q && q.trim())
    return (
      <div className="px-6 py-14 text-center">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-[#F3F4F6] text-[#6B7280]">
          ◯
        </div>
        <h2 className="text-[14px] font-semibold text-[#111827]">
          {filtered ? 'No products match these filters' : 'No products yet'}
        </h2>
        <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-[#6B7280]">
          {filtered
            ? 'Try clearing the search or switching tabs.'
            : 'Add your first product with a title, price, and a short description customers can see.'}
        </p>
        {!filtered && (
          <form action={createProduct} className="mt-4 inline-block">
            <button
              type="submit"
              className="rounded-md bg-[#059669] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#047857]"
            >
              Add product
            </button>
          </form>
        )}
      </div>
    )
  }

  return (
    <table className="min-w-full text-[13px]">
      <thead className="bg-[#FAFAFA] text-left text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
        <tr>
          <th className="w-10 px-4 py-2.5"></th>
          <th className="px-2 py-2.5">Product</th>
          <th className="px-3 py-2.5">Status</th>
          <th className="px-3 py-2.5">Inventory</th>
          <th className="px-3 py-2.5 text-right">Price</th>
          <th className="px-4 py-2.5">Updated</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#F3F4F6]">
        {products.map((product) => (
          <tr key={product.id} className="group hover:bg-[#FAFAFA]">
            <td className="px-4 py-3">
              <div className="flex size-9 items-center justify-center rounded-md border border-[#E5E7EB] bg-[#F9FAFB] text-[12px] font-medium uppercase text-[#9CA3AF]">
                {product.title.slice(0, 2)}
              </div>
            </td>
            <td className="px-2 py-3">
              <Link
                href={`/dashboard/business/products/${product.id}`}
                className="font-medium text-[#111827] group-hover:text-[#047857]"
              >
                {product.title}
              </Link>
              <div className="mt-0.5 max-w-md truncate text-[12px] text-[#9CA3AF]">
                {product.summary ?? product.slug}
              </div>
            </td>
            <td className="px-3 py-3">
              <StatusBadge tone={productStatusTone(product.status)}>{product.status}</StatusBadge>
            </td>
            <td className="px-3 py-3 text-[#6B7280]">
              {product.inventory_status.replaceAll('_', ' ')}
            </td>
            <td className="px-3 py-3 text-right tabular-nums text-[#111827]">
              {formatPrice({
                amount: product.price_amount,
                currency: product.currency,
                pricingModel: product.pricing_model,
              })}
            </td>
            <td className="px-4 py-3 text-[#6B7280]">
              {new Date(product.updated_at).toLocaleDateString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
