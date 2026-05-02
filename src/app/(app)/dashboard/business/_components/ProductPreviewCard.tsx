import { formatPrice } from '@/lib/business/pricing'
import type { ProductEditorRow } from '../_lib/queries'
import { SectionCard } from './ui'

export function ProductPreviewCard({ product }: { product: ProductEditorRow }) {
  return (
    <SectionCard title="Preview" description="How customers will see this product card.">
      <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
        <div className="flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-[#F9FAFB] to-[#F3F4F6] text-[18px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
          {product.title.slice(0, 2) || '—'}
        </div>
        <div className="space-y-2 p-3.5">
          <div className="text-[13.5px] font-semibold text-[#111827]">{product.title || 'Untitled product'}</div>
          <p className="text-[12.5px] leading-snug text-[#6B7280]">
            {product.summary || 'Add a short summary for the product card.'}
          </p>
          <div className="flex items-baseline gap-2 pt-1">
            <span className="text-[14px] font-semibold tabular-nums text-[#111827]">
              {formatPrice({
                amount: product.price_amount,
                currency: product.currency,
                pricingModel: product.pricing_model,
              })}
            </span>
            {product.compare_at_amount && product.price_amount &&
              product.compare_at_amount > product.price_amount && (
                <span className="text-[12px] tabular-nums text-[#9CA3AF] line-through">
                  {formatPrice({
                    amount: product.compare_at_amount,
                    currency: product.currency,
                    pricingModel: 'fixed',
                  })}
                </span>
              )}
          </div>
        </div>
      </div>
    </SectionCard>
  )
}
