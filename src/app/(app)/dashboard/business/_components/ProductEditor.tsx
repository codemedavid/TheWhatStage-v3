'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { useSearchParams } from 'next/navigation'
import type { ProductEditorRow } from '../_lib/queries'
import { deleteProduct, saveProduct, type ProductFormState } from '../products/actions'
import { ProductPreviewCard } from './ProductPreviewCard'
import { ProductImageUpload } from './ProductImageUpload'
import { PageHeader, SectionCard, StatusBadge, productStatusTone } from './ui'

const statusOptions = ['draft', 'published', 'archived'] as const
const pricingOptions = ['fixed', 'starts_at', 'quote', 'free'] as const
const inventoryOptions = ['in_stock', 'limited', 'out_of_stock', 'preorder', 'not_tracked'] as const

const fieldClass =
  'w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-[13.5px] text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#059669] focus:outline-none focus:ring-1 focus:ring-[#059669]'
const fieldErrorClass =
  'w-full rounded-md border border-[#FCA5A5] bg-white px-3 py-2 text-[13.5px] text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#DC2626] focus:outline-none focus:ring-1 focus:ring-[#DC2626]'
const labelClass = 'space-y-1 text-[12.5px] font-medium text-[#374151]'

const initialState: ProductFormState = {}

function fieldClassFor(error?: string) {
  return error ? fieldErrorClass : fieldClass
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <span className="mt-1 block text-[11.5px] text-[#DC2626]">{message}</span>
}

function SaveButton({ status }: { status: string }) {
  const { pending } = useFormStatus()
  const label =
    status === 'published' ? 'Publish & save' : status === 'archived' ? 'Archive' : 'Save draft'
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md bg-[#059669] px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[#047857] disabled:cursor-not-allowed disabled:bg-[#A7F3D0]"
    >
      {pending ? (
        <>
          <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          Saving…
        </>
      ) : (
        label
      )}
    </button>
  )
}

function DeleteButton() {
  const { pending } = useFormStatus()
  return (
    <button
      formAction={deleteProduct}
      formNoValidate
      disabled={pending}
      onClick={(e) => {
        if (!confirm('Delete this product? This cannot be undone.')) {
          e.preventDefault()
        }
      }}
      className="rounded-md border border-[#FECACA] bg-white px-3 py-2 text-[13px] font-semibold text-[#B91C1C] transition hover:bg-[#FEF2F2] disabled:opacity-60"
    >
      Delete product
    </button>
  )
}

function isSafeReturnPath(value: string | null): value is string {
  return !!value && value.startsWith('/') && !value.startsWith('//')
}

export function ProductEditor({ product }: { product: ProductEditorRow }) {
  const [state, formAction] = useActionState(saveProduct, initialState)
  const [status, setStatus] = useState<string>(product.status)
  const [showSaved, setShowSaved] = useState(false)
  const [, startTransition] = useTransition()
  const searchParams = useSearchParams()
  const fromParam = searchParams?.get('from') ?? null
  const back = isSafeReturnPath(fromParam)
    ? { href: fromParam, label: 'Back to action page' }
    : { href: '/dashboard/business/products', label: 'Products' }

  useEffect(() => {
    if (state.ok) {
      startTransition(() => setShowSaved(true))
      const t = setTimeout(() => startTransition(() => setShowSaved(false)), 2400)
      return () => clearTimeout(t)
    }
  }, [state.ok, startTransition])

  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-5 pb-24">
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
        back={back}
        description={`Last updated ${new Date(product.updated_at).toLocaleString()}`}
        actions={
          <>
            <StatusBadge tone={productStatusTone(status)}>{status}</StatusBadge>
            <SaveButton status={status} />
          </>
        }
      />

      {state.formError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12.5px] text-[#B91C1C]"
        >
          <span aria-hidden>⚠</span>
          <span>{state.formError}</span>
        </div>
      )}

      {showSaved && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-2 text-[12.5px] text-[#047857]"
        >
          <span aria-hidden>✓</span>
          <span>Saved.</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <SectionCard title="Title and description">
            <div className="space-y-4">
              <label className={labelClass}>
                <span>Title</span>
                <input
                  name="title"
                  required
                  defaultValue={product.title}
                  className={fieldClassFor(errors.title)}
                  aria-invalid={errors.title ? 'true' : 'false'}
                />
                <FieldError message={errors.title} />
              </label>
              <label className={labelClass}>
                <span>Slug</span>
                <input
                  name="slug"
                  required
                  defaultValue={product.slug}
                  className={fieldClassFor(errors.slug)}
                  aria-invalid={errors.slug ? 'true' : 'false'}
                />
                <FieldError message={errors.slug} />
              </label>
              <label className={labelClass}>
                <span>Summary</span>
                <textarea
                  name="summary"
                  rows={2}
                  placeholder="Short tagline for cards and listings."
                  defaultValue={product.summary ?? ''}
                  className={fieldClassFor(errors.summary)}
                  aria-invalid={errors.summary ? 'true' : 'false'}
                />
                <FieldError message={errors.summary} />
              </label>
              <label className={labelClass}>
                <span>Description</span>
                <textarea
                  name="description"
                  rows={8}
                  placeholder="Customer-facing description. Markdown supported."
                  defaultValue={product.description ?? ''}
                  className={fieldClassFor(errors.description)}
                  aria-invalid={errors.description ? 'true' : 'false'}
                />
                <FieldError message={errors.description} />
              </label>
            </div>
          </SectionCard>

          <SectionCard
            title="Pricing"
            description="Quote and Free hide the amount. Fixed and Starts-at require a price to publish."
          >
            <div className="grid gap-4 md:grid-cols-3">
              <label className={labelClass}>
                <span>Pricing model</span>
                <select
                  name="pricing_model"
                  defaultValue={product.pricing_model}
                  className={fieldClass}
                >
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
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={9999999999.99}
                  step="0.01"
                  placeholder="0.00"
                  defaultValue={product.price_amount ?? ''}
                  className={fieldClassFor(errors.price_amount)}
                  aria-invalid={errors.price_amount ? 'true' : 'false'}
                />
                <FieldError message={errors.price_amount} />
              </label>
              <label className={labelClass}>
                <span>Compare at</span>
                <input
                  name="compare_at_amount"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={9999999999.99}
                  step="0.01"
                  placeholder="0.00"
                  defaultValue={product.compare_at_amount ?? ''}
                  className={fieldClassFor(errors.compare_at_amount)}
                  aria-invalid={errors.compare_at_amount ? 'true' : 'false'}
                />
                <FieldError message={errors.compare_at_amount} />
              </label>
            </div>
            <div className="mt-4">
              <label className={`${labelClass} max-w-[160px]`}>
                <span>Currency</span>
                <input
                  name="currency"
                  defaultValue={product.currency}
                  maxLength={3}
                  className={`${fieldClassFor(errors.currency)} uppercase`}
                />
                <FieldError message={errors.currency} />
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
                <select
                  name="inventory_status"
                  defaultValue={product.inventory_status}
                  className={fieldClass}
                >
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
            <DeleteButton />
          </SectionCard>
        </div>

        <aside className="space-y-5">
          <SectionCard title="Cover image">
            <ProductImageUpload productId={product.id} currentUrl={product.cover_image_url} />
          </SectionCard>

          <SectionCard title="Visibility">
            <div className="space-y-2">
              {statusOptions.map((value) => {
                const checked = status === value
                const tone =
                  value === 'published'
                    ? 'border-[#A7F3D0] bg-[#ECFDF5]'
                    : value === 'archived'
                      ? 'border-[#FDE68A] bg-[#FFFBEB]'
                      : 'border-[#E5E7EB] bg-[#F9FAFB]'
                return (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition ${
                      checked ? tone : 'border-[#E5E7EB] bg-white hover:bg-[#FAFAFA]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="status"
                      value={value}
                      defaultChecked={checked}
                      onChange={() => setStatus(value)}
                      className="mt-0.5 size-4 cursor-pointer accent-[#059669]"
                    />
                    <span className="flex-1">
                      <span className="block text-[13px] font-semibold capitalize text-[#111827]">
                        {value === 'published' ? 'Active' : value}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] text-[#6B7280]">
                        {value === 'published'
                          ? 'Live on catalogs and recommendations.'
                          : value === 'archived'
                            ? 'Hidden everywhere; kept for records.'
                            : 'Private. Only you can see it.'}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
            {status === 'published' && (
              <p className="mt-3 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-1.5 text-[11.5px] text-[#92400E]">
                Publishing requires a summary or description, and a positive price for fixed /
                starts-at products.
              </p>
            )}
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
