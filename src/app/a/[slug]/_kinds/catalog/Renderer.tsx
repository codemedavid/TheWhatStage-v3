'use client'

import { useMemo, useState } from 'react'
import type { KindRendererProps } from '../types'

export default function CatalogRenderer({
  page,
  rawToken,
  claims,
  products = [],
}: KindRendererProps) {
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const items = useMemo(
    () =>
      Object.entries(quantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([id, quantity]) => ({ id, quantity })),
    [quantities],
  )
  const count = items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <div>
      {page.description ? (
        <header className="mb-6">
          <p className="mt-2 text-[14px] text-[#6B7280]">
            {page.description}
          </p>
        </header>
      ) : null}

      {products.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#D1D5DB] bg-[#F9FAFB] p-6 text-center text-[13px] text-[#6B7280]">
          No products are available right now.
        </div>
      ) : (
        <form action="/api/action-pages/submit" method="post" className="space-y-6">
          <input type="hidden" name="slug" value={page.slug} />
          {claims ? (
            <>
              <input type="hidden" name="p" value={claims.psid} />
              <input type="hidden" name="g" value={claims.pageId} />
              <input type="hidden" name="e" value={String(claims.exp)} />
              {rawToken ? (
                <input type="hidden" name="t" value={rawToken} />
              ) : null}
            </>
          ) : null}
          <input type="hidden" name="data.items" value={JSON.stringify(items)} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {products.map((product) => {
              const quantity = quantities[product.id] ?? 0

              return (
                <article
                  key={product.id}
                  className="rounded-lg border border-[#E5E7EB] bg-white p-4"
                >
                  <div className="aspect-[4/3] rounded-md bg-[#F3F4F6]" />
                  <h2 className="mt-3 text-[15px] font-semibold text-[#111827]">
                    {product.title}
                  </h2>
                  <p className="mt-1 min-h-10 text-[13px] text-[#6B7280]">
                    {product.summary ?? product.description ?? ''}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-[14px] font-semibold text-[#111827]">
                      {product.price_label}
                    </span>
                    <input
                      aria-label={`Quantity for ${product.title}`}
                      type="number"
                      min={0}
                      max={999}
                      value={quantity}
                      onChange={(event) => {
                        const next = Math.min(
                          999,
                          Math.max(0, Number(event.target.value) || 0),
                        )
                        setQuantities((current) => ({
                          ...current,
                          [product.id]: next,
                        }))
                      }}
                      className="w-20 rounded-md border border-[#D1D5DB] px-2 py-1.5 text-[13px]"
                    />
                  </div>
                </article>
              )
            })}
          </div>

          <section className="rounded-lg border border-[#E5E7EB] bg-white p-4">
            <h2 className="text-[15px] font-semibold text-[#111827]">
              Checkout
            </h2>
            <div className="mt-4 grid gap-3">
              <input
                name="data.customer_name"
                placeholder="Name"
                className="rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]"
              />
              <input
                name="data.customer_phone"
                placeholder="Phone"
                className="rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]"
              />
              <input
                name="data.customer_email"
                placeholder="Email"
                className="rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]"
              />
              <textarea
                name="data.customer_notes"
                placeholder="Notes"
                rows={3}
                className="rounded-md border border-[#D1D5DB] px-3 py-2 text-[14px]"
              />
            </div>
            <button
              type="submit"
              disabled={count === 0}
              className="mt-4 w-full rounded-md bg-[#059669] px-4 py-2 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#9CA3AF]"
            >
              Submit order{count ? ` (${count})` : ''}
            </button>
          </section>
        </form>
      )}
    </div>
  )
}
