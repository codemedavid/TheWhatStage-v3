import type { ProductEditorRow } from '../_lib/queries'
import { deleteProduct, saveProduct } from '../products/actions'
import { ProductPreviewCard } from './ProductPreviewCard'
import { PageHeader, SectionCard, StatusBadge, productStatusTone } from './ui'

const statusOptions = ['draft', 'published', 'archived'] as const
const pricingOptions = ['fixed', 'starts_at', 'quote', 'free'] as const
const inventoryOptions = ['in_stock', 'limited', 'out_of_stock', 'preorder', 'not_tracked'] as const

const fieldClass =
  'w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-[13.5px] text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:outline-none focus:ring-1 focus:ring-[#059669]'

const labelClass = 'space-y-1 text-[12.5px] font-medium text-[#374151]'

export function ProductEditor({ product }: { product: ProductEditorRow }) {
  return (
    <form action={saveProduct} className="space-y-5 pb-24">
      <input type="hidden" name="id" value={product.id} />
      <input type="hidden" name="tags" value={JSON.stringify(product.tags ?? [])} />
      <input type="hidden" name="details" value={JSON.stringify(product.details ?? {})} />
      <input
        type="hidden"
        name="recommendation_hints"
        value={JSON.stringify(product.recommendation_hints ?? {})}
      />

      <PageHeader
        title={product.title || 'Untitled product'}
        back={{ href: '/dashboard/business/products', label: 'Products' }}
        description={`Last updated ${new Date(product.updated_at).toLocaleString()}`}
        actions={
          <>
            <StatusBadge tone={productStatusTone(product.status)}>{product.status}</StatusBadge>
            <button
              type="submit"
              className="rounded-md bg-[#059669] px-3 py-2 text-[13px] font-semibold text-white hover:bg-[#047857]"
            >
              Save
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <SectionCard title="Title and description">
            <div className="space-y-4">
              <label className={labelClass}>
                <span>Title</span>
                <input name="title" required defaultValue={product.title} className={fieldClass} />
              </label>
              <label className={labelClass}>
                <span>Slug</span>
                <input name="slug" required defaultValue={product.slug} className={fieldClass} />
              </label>
              <label className={labelClass}>
                <span>Summary</span>
                <textarea
                  name="summary"
                  rows={2}
                  placeholder="Short tagline for cards and listings."
                  defaultValue={product.summary ?? ''}
                  className={fieldClass}
                />
              </label>
              <label className={labelClass}>
                <span>Description</span>
                <textarea
                  name="description"
                  rows={8}
                  placeholder="Customer-facing description. Markdown supported."
                  defaultValue={product.description ?? ''}
                  className={fieldClass}
                />
              </label>
            </div>
          </SectionCard>

          <SectionCard
            title="Pricing"
            description="Choose how this product is priced. Quote and Free hide the amount."
          >
            <div className="grid gap-4 md:grid-cols-3">
              <label className={labelClass}>
                <span>Pricing model</span>
                <select name="pricing_model" defaultValue={product.pricing_model} className={fieldClass}>
                  {pricingOptions.map((value) => (
                    <option key={value} value={value}>
                      {value.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                <span>Price</span>
                <input
                  name="price_amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  defaultValue={product.price_amount ?? ''}
                  className={fieldClass}
                />
              </label>
              <label className={labelClass}>
                <span>Compare at</span>
                <input
                  name="compare_at_amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  defaultValue={product.compare_at_amount ?? ''}
                  className={fieldClass}
                />
              </label>
            </div>
            <div className="mt-4">
              <label className={`${labelClass} max-w-[160px]`}>
                <span>Currency</span>
                <input
                  name="currency"
                  defaultValue={product.currency}
                  maxLength={3}
                  className={`${fieldClass} uppercase`}
                />
              </label>
            </div>
          </SectionCard>

          <SectionCard title="Inventory">
            <div className="grid gap-4 md:grid-cols-2">
              <label className={labelClass}>
                <span>SKU</span>
                <input
                  name="sku"
                  placeholder="Stock keeping unit"
                  defaultValue={product.sku ?? ''}
                  className={fieldClass}
                />
              </label>
              <label className={labelClass}>
                <span>Inventory status</span>
                <select name="inventory_status" defaultValue={product.inventory_status} className={fieldClass}>
                  {inventoryOptions.map((value) => (
                    <option key={value} value={value}>
                      {value.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </SectionCard>

          <SectionCard
            title="Danger zone"
            description="Deleting a product is permanent. Customers won't see it on any catalog page."
          >
            <button
              formAction={deleteProduct}
              formNoValidate
              className="rounded-md border border-[#FECACA] bg-white px-3 py-2 text-[13px] font-semibold text-[#B91C1C] hover:bg-[#FEF2F2]"
            >
              Delete product
            </button>
          </SectionCard>
        </div>

        <aside className="space-y-5">
          <SectionCard title="Status">
            <label className={labelClass}>
              <span>Visibility</span>
              <select name="status" defaultValue={product.status} className={fieldClass}>
                {statusOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-2 text-[12px] text-[#6B7280]">
              Drafts are private. Published products appear in catalogs and recommendations.
            </p>
          </SectionCard>

          <SectionCard title="Knowledge base">
            <label className="flex items-start gap-2 text-[13px] text-[#374151]">
              <input
                type="checkbox"
                name="rag_enabled"
                defaultChecked={product.rag_enabled}
                className="mt-0.5 size-4 rounded border-[#D1D5DB] text-[#059669] focus:ring-[#059669]"
              />
              <span>
                <span className="block font-medium text-[#111827]">Include in chatbot RAG</span>
                <span className="mt-0.5 block text-[12px] text-[#6B7280]">
                  Lets your chatbot recommend this product from indexed knowledge.
                </span>
              </span>
            </label>
          </SectionCard>

          <ProductPreviewCard product={product} />
        </aside>
      </div>
    </form>
  )
}
