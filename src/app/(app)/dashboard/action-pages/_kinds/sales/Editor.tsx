'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { KindEditorProps } from '../types'
import PaymentSettingsPanel, { type PaymentSettings } from '../../_components/PaymentSettingsPanel'
import type { PaymentMethod } from '@/lib/payment-methods/types'
import {
  defaultSalesConfig,
  parseSalesConfig,
  FALLBACK_FIELD_KEYS,
  type SalesConfig,
  type SalesGalleryItem,
  type SalesFeature,
  type SalesBenefit,
  type SalesTestimonial,
  type SalesFaq,
  type SalesSocialProof,
  type SalesFallbackField,
  type ProductType,
  type PricePeriod,
  type DeliveryType,
  type FallbackFieldKey,
} from '@/app/a/[slug]/_kinds/sales/schema'

interface LinkablePage {
  id: string
  title: string
  slug: string
  kind: string
  status: string
}

const PRODUCT_TYPE_TILES: Array<{
  value: ProductType
  label: string
  hint: string
  icon: string
}> = [
  { value: 'digital', label: 'Digital', hint: 'PDFs, files, downloads', icon: '💾' },
  { value: 'physical', label: 'Physical', hint: 'Items you ship', icon: '📦' },
  { value: 'service', label: 'Service', hint: 'Consulting or done-for-you', icon: '🛠️' },
  { value: 'course', label: 'Course', hint: 'Lessons or training', icon: '🎓' },
  { value: 'other', label: 'Other', hint: 'Anything else', icon: '✨' },
]

const DELIVERY_TILES: Array<{
  value: DeliveryType
  label: string
  hint: string
  icon: string
}> = [
  { value: 'instant_download', label: 'Instant download', hint: 'Link given right away', icon: '⚡' },
  { value: 'email', label: 'Sent by email', hint: 'You email after purchase', icon: '✉️' },
  { value: 'shipped', label: 'Shipped', hint: 'Mail or courier', icon: '📮' },
  { value: 'scheduled', label: 'Scheduled', hint: 'Booked time slot', icon: '🗓️' },
  { value: 'manual', label: 'Manual', hint: 'You handle each one', icon: '🤝' },
]

const KIND_PILL: Record<string, { bg: string; text: string; label: string }> = {
  form: { bg: '#F5F3FF', text: '#6D28D9', label: 'Form' },
  booking: { bg: '#EFF6FF', text: '#1D4ED8', label: 'Booking' },
  qualification: { bg: '#FFFBEB', text: '#B45309', label: 'Qualification' },
}

const ACCENT_SWATCHES = [
  '#059669',
  '#0EA5E9',
  '#6366F1',
  '#8B5CF6',
  '#EC4899',
  '#F59E0B',
  '#EF4444',
  '#111827',
]

const COMMON_CURRENCIES = ['PHP', 'USD', 'EUR', 'GBP', 'AUD', 'SGD']

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function formatPricePreview(
  amount: number | null,
  currency: string,
  period: PricePeriod | null,
  displayLabel: string,
): string {
  if (displayLabel.trim()) return displayLabel
  if (amount == null || !Number.isFinite(amount)) return '—'
  const num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount)
  const periodSuffix =
    period === 'monthly' ? ' / month' : period === 'yearly' ? ' / year' : ''
  return `${currency} ${num}${periodSuffix}`
}

export default function SalesEditor({ page, paymentMethods = [] }: KindEditorProps & { paymentMethods?: PaymentMethod[] }) {
  const initial = useMemo<SalesConfig>(() => {
    const parsed = parseSalesConfig(page.config)
    return parsed ?? defaultSalesConfig()
  }, [page.config])

  const [config, setConfig] = useState<SalesConfig>(initial)

  return (
    <div className="space-y-4">
      <input type="hidden" name="config" value={JSON.stringify(config)} />

      <Card
        step={1}
        title="What are you selling?"
        subtitle="The basics — name, type, and the look of the page."
        defaultOpen
        summary={config.product.name || 'Untitled product'}
      >
        <ProductBasicsSection config={config} setConfig={setConfig} />
      </Card>

      <Card
        step={2}
        title="Pricing"
        subtitle="How much it costs and how often."
        defaultOpen
        summary={formatPricePreview(
          config.price.amount,
          config.price.currency,
          config.price.period,
          config.price.display_label,
        )}
      >
        <PricingSection config={config} setConfig={setConfig} />
      </Card>

      <Card
        step={3}
        title="Photos"
        subtitle="Images that show the product. The first one is the hero."
        summary={`${config.gallery.length} ${config.gallery.length === 1 ? 'image' : 'images'}`}
      >
        <GallerySection
          pageId={page.id}
          gallery={config.gallery}
          onChange={(g) => setConfig((c) => ({ ...c, gallery: g }))}
        />
      </Card>

      <Card
        step={4}
        title="Description"
        subtitle="The long pitch shown below the hero."
        summary={
          config.product.description.trim()
            ? `${config.product.description.length} chars`
            : 'Empty'
        }
      >
        <DescriptionSection
          value={config.product.description}
          onChange={(v) =>
            setConfig((c) => ({ ...c, product: { ...c.product, description: v } }))
          }
        />
      </Card>

      <Card
        step={5}
        title="What's included"
        subtitle="Highlight the main features or modules."
        summary={`${config.features.length} ${config.features.length === 1 ? 'feature' : 'features'}`}
      >
        <FeaturesSection
          features={config.features}
          onChange={(f) => setConfig((c) => ({ ...c, features: f }))}
        />
      </Card>

      <Card
        step={6}
        title="Benefits"
        subtitle="Outcomes a buyer gets — short bullets."
        summary={`${config.benefits.length} ${config.benefits.length === 1 ? 'benefit' : 'benefits'}`}
      >
        <BenefitsSection
          benefits={config.benefits}
          onChange={(b) => setConfig((c) => ({ ...c, benefits: b }))}
        />
      </Card>

      <Card
        step={7}
        title="Testimonials"
        subtitle="Quotes from happy customers."
        summary={`${config.testimonials.length} ${config.testimonials.length === 1 ? 'quote' : 'quotes'}`}
      >
        <TestimonialsSection
          pageId={page.id}
          testimonials={config.testimonials}
          onChange={(t) => setConfig((c) => ({ ...c, testimonials: t }))}
        />
      </Card>

      <Card
        step={8}
        title="FAQs"
        subtitle="Questions buyers usually ask."
        summary={`${config.faqs.length} ${config.faqs.length === 1 ? 'question' : 'questions'}`}
      >
        <FaqsSection
          faqs={config.faqs}
          onChange={(f) => setConfig((c) => ({ ...c, faqs: f }))}
        />
      </Card>

      <Card
        step={9}
        title="Guarantee"
        subtitle="Optional reassurance box (e.g. money-back)."
        summary={config.guarantee.enabled ? 'On' : 'Off'}
      >
        <GuaranteeSection config={config} setConfig={setConfig} />
      </Card>

      <Card
        step={10}
        title="Delivery"
        subtitle="How buyers get the product."
        summary={DELIVERY_TILES.find((d) => d.value === config.delivery.type)?.label ?? '—'}
      >
        <DeliverySection config={config} setConfig={setConfig} />
      </Card>

      <Card
        step={11}
        title="Social proof"
        subtitle="Big number cards (e.g. '1,200+ businesses')."
        summary={`${config.social_proof.length} ${config.social_proof.length === 1 ? 'stat' : 'stats'}`}
      >
        <SocialProofSection
          items={config.social_proof}
          onChange={(s) => setConfig((c) => ({ ...c, social_proof: s }))}
        />
      </Card>

      <Card
        step={12}
        title="Call to action"
        subtitle="The button shown next to the price."
        summary={config.cta.primary_label || 'Get it now'}
      >
        <CtaSection config={config} setConfig={setConfig} />
      </Card>

      <Card
        step={13}
        title="Linked action pages"
        subtitle="Embed forms, bookings, or qualifications below the offer."
        summary={`${config.linked_action_page_ids.length} attached`}
      >
        <LinkedPagesSection
          currentPageId={page.id}
          linkedIds={config.linked_action_page_ids}
          onChange={(ids) =>
            setConfig((c) => ({ ...c, linked_action_page_ids: ids }))
          }
        />
      </Card>

      <Card
        step={14}
        title="Default form"
        subtitle={
          config.linked_action_page_ids.length > 0
            ? 'Used only if no action pages are linked above.'
            : 'Shown on the public page. Buyers fill these to convert.'
        }
        summary={`${config.fallback_form.fields.filter((f) => f.enabled).length} fields`}
      >
        <FallbackFormSection
          config={config}
          setConfig={setConfig}
          hasLinkedPages={config.linked_action_page_ids.length > 0}
        />
      </Card>

      <Card
        step={15}
        title="Payment"
        subtitle="Show payment instructions to buyers on this page."
        summary={config.payment.enabled ? 'On' : 'Off'}
      >
        <PaymentSettingsPanel
          value={config.payment ?? { enabled: true, excluded_method_ids: [] }}
          onChange={(next: PaymentSettings) => setConfig((c) => ({ ...c, payment: next }))}
          paymentMethods={paymentMethods}
        />
      </Card>
    </div>
  )
}

/* ────────────────────────── Product basics ────────────────────────── */

function ProductBasicsSection({
  config,
  setConfig,
}: {
  config: SalesConfig
  setConfig: React.Dispatch<React.SetStateAction<SalesConfig>>
}) {
  const updateProduct = (patch: Partial<SalesConfig['product']>) =>
    setConfig((c) => ({ ...c, product: { ...c.product, ...patch } }))

  return (
    <div className="space-y-5">
      <Field label="Product name" hint="The name buyers see in the hero.">
        <input
          type="text"
          value={config.product.name}
          onChange={(e) => updateProduct({ name: e.target.value.slice(0, 160) })}
          placeholder="e.g. Messenger Growth Playbook"
          maxLength={160}
          className={inputCls}
        />
      </Field>

      <Field label="Type" hint="Pick what best describes it. Just for organization.">
        <TileGrid<ProductType>
          value={config.product.type}
          tiles={PRODUCT_TYPE_TILES}
          onChange={(v) => updateProduct({ type: v })}
        />
      </Field>

      <Field label="Headline" hint="One line that hooks the buyer.">
        <input
          type="text"
          value={config.product.headline}
          onChange={(e) => updateProduct({ headline: e.target.value.slice(0, 200) })}
          placeholder="The big offer in one line"
          maxLength={200}
          className={inputCls}
        />
      </Field>

      <Field label="Tagline" hint="A supporting line shown under the headline.">
        <input
          type="text"
          value={config.product.tagline}
          onChange={(e) => updateProduct({ tagline: e.target.value.slice(0, 300) })}
          placeholder="Optional context that makes the headline land"
          maxLength={300}
          className={inputCls}
        />
      </Field>

      <Field label="Brand color" hint="Used for buttons, highlights, and accents.">
        <SwatchPicker
          value={config.theme.accent_color}
          onChange={(v) =>
            setConfig((c) => ({ ...c, theme: { ...c.theme, accent_color: v } }))
          }
        />
      </Field>

      <details className="group rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] open:bg-white">
        <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-[12px] font-semibold text-[#374151]">
          Advanced colors
          <span className="text-[11px] text-[#6B7280] group-open:hidden">Show</span>
          <span className="hidden text-[11px] text-[#6B7280] group-open:inline">Hide</span>
        </summary>
        <div className="grid grid-cols-1 gap-3 border-t border-[#E5E7EB] p-3 sm:grid-cols-2">
          <ColorField
            label="Background"
            value={config.theme.background_color}
            onChange={(v) =>
              setConfig((c) => ({
                ...c,
                theme: { ...c.theme, background_color: v },
              }))
            }
          />
          <ColorField
            label="Button text"
            value={config.theme.button_text_color}
            onChange={(v) =>
              setConfig((c) => ({
                ...c,
                theme: { ...c.theme, button_text_color: v },
              }))
            }
          />
        </div>
      </details>
    </div>
  )
}

/* ────────────────────────── Pricing ────────────────────────── */

function PricingSection({
  config,
  setConfig,
}: {
  config: SalesConfig
  setConfig: React.Dispatch<React.SetStateAction<SalesConfig>>
}) {
  const updatePrice = (patch: Partial<SalesConfig['price']>) =>
    setConfig((c) => ({ ...c, price: { ...c.price, ...patch } }))

  const preview = formatPricePreview(
    config.price.amount,
    config.price.currency,
    config.price.period,
    config.price.display_label,
  )

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-[#E5E7EB] bg-gradient-to-br from-emerald-50 to-white p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
          Buyers will see
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <span className="text-[24px] font-bold text-[#111827]">{preview}</span>
          {config.price.compare_at_amount != null &&
            config.price.amount != null &&
            config.price.compare_at_amount > config.price.amount && (
              <span className="text-[14px] text-[#9CA3AF] line-through">
                {config.price.currency}{' '}
                {new Intl.NumberFormat('en-US').format(config.price.compare_at_amount)}
              </span>
            )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Currency">
          <CurrencyPicker
            value={config.price.currency}
            onChange={(v) => updatePrice({ currency: v.toUpperCase().slice(0, 8) })}
          />
        </Field>
        <Field label="Price">
          <NumberInput
            value={config.price.amount}
            allowNull
            placeholder="0.00"
            onChange={(v) => updatePrice({ amount: v })}
          />
        </Field>
        <Field label="Was (optional)" hint="Strikethrough price">
          <NumberInput
            value={config.price.compare_at_amount}
            allowNull
            placeholder="0.00"
            onChange={(v) => updatePrice({ compare_at_amount: v })}
          />
        </Field>
      </div>

      <Field label="Billing">
        <Segmented<PricePeriod | ''>
          value={(config.price.period ?? '') as PricePeriod | ''}
          options={[
            { value: '', label: 'One-time' },
            { value: 'monthly', label: 'Per month' },
            { value: 'yearly', label: 'Per year' },
          ]}
          onChange={(v) => updatePrice({ period: v === '' ? null : (v as PricePeriod) })}
        />
      </Field>

      <details className="group rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] open:bg-white">
        <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-[12px] font-semibold text-[#374151]">
          Custom price label (override)
          <span className="text-[11px] text-[#6B7280] group-open:hidden">Show</span>
          <span className="hidden text-[11px] text-[#6B7280] group-open:inline">Hide</span>
        </summary>
        <div className="border-t border-[#E5E7EB] p-3">
          <input
            type="text"
            value={config.price.display_label}
            onChange={(e) => updatePrice({ display_label: e.target.value.slice(0, 80) })}
            placeholder="e.g. Starts at ₱4,999"
            maxLength={80}
            className={inputCls}
          />
          <p className="mt-1 text-[11px] text-[#6B7280]">
            When set, this overrides the auto-formatted price entirely.
          </p>
        </div>
      </details>
    </div>
  )
}

/* ────────────────────────── Gallery ────────────────────────── */

function GallerySection({
  pageId,
  gallery,
  onChange,
}: {
  pageId: string
  gallery: SalesGalleryItem[]
  onChange: (g: SalesGalleryItem[]) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      const next: SalesGalleryItem[] = [...gallery]
      let pos = next.length === 0 ? 0 : Math.max(...next.map((g) => g.position)) + 1
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(`/api/action-pages/${pageId}/images`, {
          method: 'POST',
          body: fd,
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? `upload_failed_${res.status}`)
        }
        const { url, fileId } = (await res.json()) as { url: string; fileId: string }
        next.push({
          id: genId(),
          fileId,
          url,
          alt: '',
          position: pos++,
          primary: next.length === 0,
        })
      }
      if (!next.some((g) => g.primary) && next.length > 0) next[0]!.primary = true
      onChange(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function setPrimary(id: string) {
    onChange(gallery.map((g) => ({ ...g, primary: g.id === id })))
  }
  function remove(id: string) {
    onChange(gallery.filter((g) => g.id !== id))
  }
  function move(id: string, dir: -1 | 1) {
    const sorted = [...gallery].sort((a, b) => a.position - b.position)
    const idx = sorted.findIndex((g) => g.id === id)
    if (idx < 0) return
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= sorted.length) return
    const a = sorted[idx]!
    const b = sorted[swapIdx]!
    const aPos = a.position
    a.position = b.position
    b.position = aPos
    onChange([...sorted])
  }
  function setAlt(id: string, alt: string) {
    onChange(gallery.map((g) => (g.id === id ? { ...g, alt } : g)))
  }

  const sorted = [...gallery].sort((a, b) => a.position - b.position)

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          handleFiles(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragOver
            ? 'border-emerald-400 bg-emerald-50'
            : 'border-[#D1D5DB] bg-[#F9FAFB] hover:border-[#9CA3AF] hover:bg-white'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <div className="text-[28px]">🖼️</div>
        <div className="text-[13px] font-semibold text-[#111827]">
          {uploading ? 'Uploading…' : 'Drop images here or click to upload'}
        </div>
        <div className="text-[11px] text-[#6B7280]">JPEG, PNG, or WebP · up to 5 MB each</div>
      </div>
      {error && <p className="text-[12px] text-red-600">{error}</p>}

      {sorted.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {sorted.map((g, idx) => (
            <div
              key={g.id}
              className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white"
            >
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={g.url}
                  alt={g.alt || 'Product image'}
                  className="aspect-[4/3] w-full object-cover"
                />
                {g.primary && (
                  <span className="absolute left-2 top-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
                    Hero
                  </span>
                )}
              </div>
              <div className="space-y-2 p-2">
                <input
                  type="text"
                  placeholder="Alt text (for accessibility)"
                  value={g.alt ?? ''}
                  onChange={(e) => setAlt(g.id, e.target.value.slice(0, 200))}
                  className="w-full rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[12px]"
                />
                <div className="flex flex-wrap items-center gap-1">
                  {!g.primary && (
                    <button
                      type="button"
                      onClick={() => setPrimary(g.id)}
                      className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
                    >
                      Make hero
                    </button>
                  )}
                  <span className="ml-auto inline-flex">
                    <button
                      type="button"
                      onClick={() => move(g.id, -1)}
                      disabled={idx === 0}
                      className="rounded-l-md border border-[#D1D5DB] bg-white px-2 py-1 text-[11px] disabled:opacity-40"
                      aria-label="Move left"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => move(g.id, 1)}
                      disabled={idx === sorted.length - 1}
                      className="-ml-px rounded-r-md border border-[#D1D5DB] bg-white px-2 py-1 text-[11px] disabled:opacity-40"
                      aria-label="Move right"
                    >
                      →
                    </button>
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(g.id)}
                    className="rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50"
                    aria-label="Remove image"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ────────────────────────── Description ────────────────────────── */

function DescriptionSection({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 8000))}
        rows={6}
        maxLength={8000}
        placeholder="Tell buyers exactly what they get, who it's for, and why it works. Line breaks are preserved."
        className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      />
      <div className="mt-1 flex items-center justify-between text-[11px] text-[#9CA3AF]">
        <span>Tip: short paragraphs work best.</span>
        <span>{value.length}/8000</span>
      </div>
    </div>
  )
}

/* ────────────────────────── Features ────────────────────────── */

function FeaturesSection({
  features,
  onChange,
}: {
  features: SalesFeature[]
  onChange: (f: SalesFeature[]) => void
}) {
  function add() {
    onChange([
      ...features,
      { id: genId(), icon: '✨', title: '', body: '' },
    ])
  }
  function update(id: string, patch: Partial<SalesFeature>) {
    onChange(features.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }
  function remove(id: string) {
    onChange(features.filter((f) => f.id !== id))
  }

  return (
    <div className="space-y-2">
      {features.length === 0 && (
        <EmptyState
          icon="✨"
          title="No features yet"
          body="Add a few cards highlighting what makes the product great."
        />
      )}
      {features.map((f) => (
        <div
          key={f.id}
          className="rounded-lg border border-[#E5E7EB] bg-white p-3 transition-shadow hover:shadow-sm"
        >
          <div className="flex items-start gap-2">
            <input
              type="text"
              value={f.icon ?? ''}
              onChange={(e) => update(f.id, { icon: e.target.value.slice(0, 8) })}
              placeholder="✨"
              className="w-12 rounded-md border border-[#D1D5DB] bg-white px-2 py-2 text-center text-[18px]"
              aria-label="Emoji icon"
            />
            <div className="flex-1 space-y-2">
              <input
                type="text"
                value={f.title}
                onChange={(e) => update(f.id, { title: e.target.value.slice(0, 120) })}
                placeholder="Feature title"
                className={inputCls}
              />
              <input
                type="text"
                value={f.body}
                onChange={(e) => update(f.id, { body: e.target.value.slice(0, 500) })}
                placeholder="One-line description"
                className={inputCls}
              />
            </div>
            <button
              type="button"
              onClick={() => remove(f.id)}
              className="rounded-md border border-transparent bg-transparent px-2 py-2 text-[14px] text-[#9CA3AF] hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              aria-label="Remove feature"
            >
              ×
            </button>
          </div>
        </div>
      ))}
      <AddButton onClick={add} label="Add feature" />
    </div>
  )
}

/* ────────────────────────── Benefits ────────────────────────── */

function BenefitsSection({
  benefits,
  onChange,
}: {
  benefits: SalesBenefit[]
  onChange: (b: SalesBenefit[]) => void
}) {
  const [draft, setDraft] = useState('')

  function add() {
    const v = draft.trim()
    if (!v) return
    onChange([...benefits, { id: genId(), text: v.slice(0, 200) }])
    setDraft('')
  }

  return (
    <div className="space-y-3">
      {benefits.length > 0 && (
        <div className="space-y-1.5">
          {benefits.map((b) => (
            <div
              key={b.id}
              className="flex items-center gap-2 rounded-md border border-[#E5E7EB] bg-white px-3 py-2"
            >
              <span className="text-emerald-600">✓</span>
              <input
                type="text"
                value={b.text}
                onChange={(e) =>
                  onChange(
                    benefits.map((x) =>
                      x.id === b.id ? { ...x, text: e.target.value.slice(0, 200) } : x,
                    ),
                  )
                }
                className="flex-1 rounded-md border border-transparent bg-transparent px-1 py-1 text-[13px] focus:border-[#D1D5DB] focus:bg-white focus:outline-none"
              />
              <button
                type="button"
                onClick={() => onChange(benefits.filter((x) => x.id !== b.id))}
                className="rounded-md px-2 py-1 text-[14px] text-[#9CA3AF] hover:bg-red-50 hover:text-red-600"
                aria-label="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder="e.g. Save 5 hours a week"
          maxLength={200}
          className={inputCls}
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className="rounded-md bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  )
}

/* ────────────────────────── Testimonials ────────────────────────── */

function TestimonialsSection({
  pageId,
  testimonials,
  onChange,
}: {
  pageId: string
  testimonials: SalesTestimonial[]
  onChange: (t: SalesTestimonial[]) => void
}) {
  const [uploadingId, setUploadingId] = useState<string | null>(null)

  function add() {
    onChange([
      ...testimonials,
      { id: genId(), author: '', role: '', avatar_url: null, quote: '' },
    ])
  }
  function update(id: string, patch: Partial<SalesTestimonial>) {
    onChange(testimonials.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }
  function remove(id: string) {
    onChange(testimonials.filter((t) => t.id !== id))
  }

  async function uploadAvatar(id: string, file: File) {
    setUploadingId(id)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/action-pages/${pageId}/images`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) throw new Error(`upload_failed_${res.status}`)
      const { url } = (await res.json()) as { url: string }
      update(id, { avatar_url: url })
    } catch {
      // optional avatar — swallow
    } finally {
      setUploadingId(null)
    }
  }

  return (
    <div className="space-y-2">
      {testimonials.length === 0 && (
        <EmptyState
          icon="💬"
          title="No testimonials yet"
          body="Real quotes from happy buyers build trust fast."
        />
      )}
      {testimonials.map((t) => (
        <div
          key={t.id}
          className="rounded-lg border border-[#E5E7EB] bg-white p-3"
        >
          <div className="flex items-start gap-3">
            <div className="flex flex-col items-center gap-1">
              {t.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={t.avatar_url}
                  alt=""
                  className="h-12 w-12 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F3F4F6] text-[18px]">
                  👤
                </div>
              )}
              <label className="cursor-pointer text-[10px] font-semibold text-emerald-700 hover:underline">
                {uploadingId === t.id ? '…' : t.avatar_url ? 'Change' : 'Upload'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) uploadAvatar(t.id, file)
                    e.target.value = ''
                  }}
                />
              </label>
              {t.avatar_url && (
                <button
                  type="button"
                  onClick={() => update(t.id, { avatar_url: null })}
                  className="text-[10px] text-red-600 hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  value={t.author}
                  onChange={(e) => update(t.id, { author: e.target.value.slice(0, 120) })}
                  placeholder="Author name"
                  className={inputCls}
                />
                <input
                  type="text"
                  value={t.role ?? ''}
                  onChange={(e) => update(t.id, { role: e.target.value.slice(0, 120) })}
                  placeholder="Role / company (optional)"
                  className={inputCls}
                />
              </div>
              <textarea
                value={t.quote}
                onChange={(e) => update(t.id, { quote: e.target.value.slice(0, 800) })}
                rows={3}
                placeholder="“This product changed how I…”"
                className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[13px]"
              />
            </div>
            <button
              type="button"
              onClick={() => remove(t.id)}
              className="rounded-md px-2 py-2 text-[14px] text-[#9CA3AF] hover:bg-red-50 hover:text-red-600"
              aria-label="Remove testimonial"
            >
              ×
            </button>
          </div>
        </div>
      ))}
      <AddButton onClick={add} label="Add testimonial" />
    </div>
  )
}

/* ────────────────────────── FAQs ────────────────────────── */

function FaqsSection({
  faqs,
  onChange,
}: {
  faqs: SalesFaq[]
  onChange: (f: SalesFaq[]) => void
}) {
  function add() {
    onChange([...faqs, { id: genId(), question: '', answer: '' }])
  }
  function update(id: string, patch: Partial<SalesFaq>) {
    onChange(faqs.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }
  function remove(id: string) {
    onChange(faqs.filter((f) => f.id !== id))
  }

  return (
    <div className="space-y-2">
      {faqs.length === 0 && (
        <EmptyState
          icon="❓"
          title="No FAQs yet"
          body="Pre-empt the questions buyers always ask."
        />
      )}
      {faqs.map((f, idx) => (
        <div key={f.id} className="rounded-lg border border-[#E5E7EB] bg-white p-3">
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-[#6B7280]">
            <span>FAQ #{idx + 1}</span>
            <button
              type="button"
              onClick={() => remove(f.id)}
              className="rounded-md px-2 py-1 text-[14px] text-[#9CA3AF] hover:bg-red-50 hover:text-red-600"
              aria-label="Remove FAQ"
            >
              ×
            </button>
          </div>
          <input
            type="text"
            value={f.question}
            onChange={(e) => update(f.id, { question: e.target.value.slice(0, 200) })}
            placeholder="Question — e.g. Do you offer refunds?"
            className={inputCls}
          />
          <textarea
            value={f.answer}
            onChange={(e) => update(f.id, { answer: e.target.value.slice(0, 2000) })}
            rows={2}
            placeholder="Your answer"
            className="mt-2 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[13px]"
          />
        </div>
      ))}
      <AddButton onClick={add} label="Add question" />
    </div>
  )
}

/* ────────────────────────── Guarantee ────────────────────────── */

function GuaranteeSection({
  config,
  setConfig,
}: {
  config: SalesConfig
  setConfig: React.Dispatch<React.SetStateAction<SalesConfig>>
}) {
  const update = (patch: Partial<SalesConfig['guarantee']>) =>
    setConfig((c) => ({ ...c, guarantee: { ...c.guarantee, ...patch } }))

  return (
    <div className="space-y-3">
      <Toggle
        checked={config.guarantee.enabled}
        onChange={(v) => update({ enabled: v })}
        label="Show guarantee box"
        hint="A small reassurance card near the CTA."
      />
      {config.guarantee.enabled && (
        <div className="space-y-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
          <input
            type="text"
            value={config.guarantee.title}
            onChange={(e) => update({ title: e.target.value.slice(0, 120) })}
            placeholder="Title — e.g. 14-day money-back guarantee"
            className={inputCls}
          />
          <textarea
            value={config.guarantee.body}
            onChange={(e) => update({ body: e.target.value.slice(0, 800) })}
            rows={2}
            placeholder="Short body text explaining the guarantee."
            className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[13px]"
          />
        </div>
      )}
    </div>
  )
}

/* ────────────────────────── Delivery ────────────────────────── */

function DeliverySection({
  config,
  setConfig,
}: {
  config: SalesConfig
  setConfig: React.Dispatch<React.SetStateAction<SalesConfig>>
}) {
  const update = (patch: Partial<SalesConfig['delivery']>) =>
    setConfig((c) => ({ ...c, delivery: { ...c.delivery, ...patch } }))

  return (
    <div className="space-y-4">
      <Field label="Delivery method">
        <TileGrid<DeliveryType>
          value={config.delivery.type}
          tiles={DELIVERY_TILES}
          onChange={(v) => update({ type: v })}
        />
      </Field>
      <Field label="Notes" hint="Optional details shown near the CTA.">
        <textarea
          value={config.delivery.notes}
          onChange={(e) => update({ notes: e.target.value.slice(0, 1000) })}
          rows={2}
          placeholder="e.g. Access link sent within 5 minutes."
          className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[13px]"
        />
      </Field>
    </div>
  )
}

/* ────────────────────────── Social proof ────────────────────────── */

function SocialProofSection({
  items,
  onChange,
}: {
  items: SalesSocialProof[]
  onChange: (s: SalesSocialProof[]) => void
}) {
  function add() {
    onChange([...items, { id: genId(), stat_label: '', stat_value: '' }])
  }
  function update(id: string, patch: Partial<SalesSocialProof>) {
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }
  function remove(id: string) {
    onChange(items.filter((i) => i.id !== id))
  }

  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <EmptyState icon="📈" title="No stats yet" body="Big numbers grab attention." />
      )}
      {items.map((i) => (
        <div
          key={i.id}
          className="grid grid-cols-1 gap-2 rounded-lg border border-[#E5E7EB] bg-white p-3 sm:grid-cols-12"
        >
          <div className="sm:col-span-3">
            <span className="mb-1 block text-[11px] font-semibold text-[#6B7280]">
              Big number
            </span>
            <input
              type="text"
              value={i.stat_value}
              onChange={(e) => update(i.id, { stat_value: e.target.value.slice(0, 40) })}
              placeholder="1,200+"
              className={inputCls}
            />
          </div>
          <div className="sm:col-span-8">
            <span className="mb-1 block text-[11px] font-semibold text-[#6B7280]">
              Label
            </span>
            <input
              type="text"
              value={i.stat_label}
              onChange={(e) => update(i.id, { stat_label: e.target.value.slice(0, 80) })}
              placeholder="businesses served"
              className={inputCls}
            />
          </div>
          <div className="flex items-end justify-end sm:col-span-1">
            <button
              type="button"
              onClick={() => remove(i.id)}
              className="rounded-md px-2 py-2 text-[14px] text-[#9CA3AF] hover:bg-red-50 hover:text-red-600"
              aria-label="Remove stat"
            >
              ×
            </button>
          </div>
        </div>
      ))}
      <AddButton onClick={add} label="Add stat" />
    </div>
  )
}

/* ────────────────────────── CTA ────────────────────────── */

function CtaSection({
  config,
  setConfig,
}: {
  config: SalesConfig
  setConfig: React.Dispatch<React.SetStateAction<SalesConfig>>
}) {
  const update = (patch: Partial<SalesConfig['cta']>) =>
    setConfig((c) => ({ ...c, cta: { ...c.cta, ...patch } }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Primary button">
          <input
            type="text"
            value={config.cta.primary_label}
            onChange={(e) => update({ primary_label: e.target.value.slice(0, 60) })}
            placeholder="Get it now"
            className={inputCls}
          />
        </Field>
        <Field label="Secondary button" hint="Optional — leave empty to hide.">
          <input
            type="text"
            value={config.cta.secondary_label ?? ''}
            onChange={(e) => update({ secondary_label: e.target.value.slice(0, 60) })}
            placeholder="Learn more"
            className={inputCls}
          />
        </Field>
      </div>
      <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
          Preview
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <span
            className="inline-flex items-center rounded-md px-4 py-2 text-[13px] font-semibold text-white"
            style={{ background: config.theme.accent_color }}
          >
            {config.cta.primary_label || 'Get it now'}
          </span>
          {config.cta.secondary_label && (
            <span className="inline-flex items-center rounded-md border border-[#D1D5DB] bg-white px-4 py-2 text-[13px] font-semibold text-[#374151]">
              {config.cta.secondary_label}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────── Linked action pages ────────────────────────── */

function LinkedPagesSection({
  currentPageId,
  linkedIds,
  onChange,
}: {
  currentPageId: string
  linkedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const [pages, setPages] = useState<LinkablePage[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(
      `/api/action-pages/list?kinds=form,booking,qualification&exclude=${currentPageId}`,
      { cache: 'no-store' },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((body) => {
        if (cancelled) return
        setPages(body.pages as LinkablePage[])
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'failed_to_load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentPageId])

  const linkedSet = new Set(linkedIds)
  const linked: LinkablePage[] = []
  const available: LinkablePage[] = []
  for (const p of pages ?? []) {
    if (linkedSet.has(p.id)) linked.push(p)
    else available.push(p)
  }
  linked.sort((a, b) => linkedIds.indexOf(a.id) - linkedIds.indexOf(b.id))

  function attach(id: string) {
    if (linkedSet.has(id)) return
    onChange([...linkedIds, id])
  }
  function detach(id: string) {
    onChange(linkedIds.filter((x) => x !== id))
  }
  function move(id: string, dir: -1 | 1) {
    const idx = linkedIds.indexOf(id)
    if (idx < 0) return
    const next = [...linkedIds]
    const swap = idx + dir
    if (swap < 0 || swap >= next.length) return
    ;[next[idx], next[swap]] = [next[swap]!, next[idx]!]
    onChange(next)
  }

  return (
    <div className="space-y-3">
      {loading && <p className="text-[12px] text-[#6B7280]">Loading…</p>}
      {error && <p className="text-[12px] text-red-600">{error}</p>}

      {linked.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
            Attached
          </h4>
          {linked.map((p, idx) => (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/50 px-3 py-2"
            >
              <KindPill kind={p.kind} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-[#111827]">
                  {p.title}
                </div>
                <div className="truncate text-[11px] text-[#6B7280]">/a/{p.slug}</div>
              </div>
              <span className="inline-flex">
                <button
                  type="button"
                  onClick={() => move(p.id, -1)}
                  disabled={idx === 0}
                  className="rounded-l-md border border-[#D1D5DB] bg-white px-2 py-1 text-[11px] disabled:opacity-40"
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(p.id, 1)}
                  disabled={idx === linked.length - 1}
                  className="-ml-px rounded-r-md border border-[#D1D5DB] bg-white px-2 py-1 text-[11px] disabled:opacity-40"
                  aria-label="Move down"
                >
                  ↓
                </button>
              </span>
              <button
                type="button"
                onClick={() => detach(p.id)}
                className="rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50"
              >
                Detach
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
          Available
        </h4>
        {available.length === 0 ? (
          <p className="rounded-md border border-dashed border-[#D1D5DB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
            {pages === null
              ? '—'
              : 'No more pages to attach. Create a form, booking, or qualification page first.'}
          </p>
        ) : (
          available.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 rounded-md border border-[#E5E7EB] bg-white px-3 py-2"
            >
              <KindPill kind={p.kind} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-[#111827]">
                  {p.title}
                </div>
                <div className="truncate text-[11px] text-[#6B7280]">/a/{p.slug}</div>
              </div>
              <span
                className={`text-[11px] ${
                  p.status === 'published' ? 'text-emerald-600' : 'text-[#9CA3AF]'
                }`}
              >
                {p.status}
              </span>
              <button
                type="button"
                onClick={() => attach(p.id)}
                className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
              >
                Attach
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/* ────────────────────────── Fallback form ────────────────────────── */

function FallbackFormSection({
  config,
  setConfig,
  hasLinkedPages,
}: {
  config: SalesConfig
  setConfig: React.Dispatch<React.SetStateAction<SalesConfig>>
  hasLinkedPages: boolean
}) {
  const updateForm = (patch: Partial<SalesConfig['fallback_form']>) =>
    setConfig((c) => ({ ...c, fallback_form: { ...c.fallback_form, ...patch } }))

  function updateField(key: FallbackFieldKey, patch: Partial<SalesFallbackField>) {
    updateForm({
      fields: config.fallback_form.fields.map((f) =>
        f.key === key ? { ...f, ...patch } : f,
      ),
    })
  }

  return (
    <div className="space-y-4">
      {hasLinkedPages && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          You have action pages linked above, so this form only shows as a fallback.
        </div>
      )}
      <div>
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
          Fields
        </h4>
        <div className="space-y-2">
          {FALLBACK_FIELD_KEYS.map((key) => {
            const field = config.fallback_form.fields.find((f) => f.key === key)
            if (!field) return null
            return (
              <div
                key={key}
                className={`rounded-lg border bg-white p-3 ${
                  field.enabled ? 'border-[#E5E7EB]' : 'border-[#F3F4F6] bg-[#F9FAFB]'
                }`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Toggle
                    checked={field.enabled}
                    onChange={(v) => updateField(key, { enabled: v })}
                    label={fieldKeyLabel(key)}
                  />
                  <div className="ml-auto flex flex-wrap items-center gap-3">
                    <input
                      type="text"
                      value={field.label}
                      disabled={!field.enabled}
                      onChange={(e) =>
                        updateField(key, { label: e.target.value.slice(0, 80) })
                      }
                      placeholder="Field label shown to buyer"
                      className="w-56 rounded-md border border-[#D1D5DB] bg-white px-3 py-1.5 text-[13px] disabled:opacity-50"
                    />
                    <label className="flex items-center gap-1 text-[12px] text-[#374151]">
                      <input
                        type="checkbox"
                        checked={field.required}
                        disabled={!field.enabled}
                        onChange={(e) =>
                          updateField(key, { required: e.target.checked })
                        }
                      />
                      Required
                    </label>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Submit button">
          <input
            type="text"
            value={config.fallback_form.submit_button_label}
            onChange={(e) => updateForm({ submit_button_label: e.target.value.slice(0, 40) })}
            className={inputCls}
          />
        </Field>
        <Field label="Success message">
          <input
            type="text"
            value={config.fallback_form.success_message}
            onChange={(e) => updateForm({ success_message: e.target.value.slice(0, 400) })}
            className={inputCls}
          />
        </Field>
      </div>
    </div>
  )
}

function fieldKeyLabel(key: FallbackFieldKey): string {
  switch (key) {
    case 'full_name':
      return 'Name'
    case 'email':
      return 'Email'
    case 'phone':
      return 'Phone'
    case 'message':
      return 'Message'
  }
}

function KindPill({ kind }: { kind: string }) {
  const meta = KIND_PILL[kind] ?? { bg: '#F3F4F6', text: '#6B7280', label: kind }
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: meta.bg, color: meta.text }}
    >
      {meta.label}
    </span>
  )
}

/* ────────────────────────── Shared primitives ────────────────────────── */

const inputCls =
  'w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px] text-[#111827] placeholder:text-[#9CA3AF] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500'

function Card({
  step,
  title,
  subtitle,
  summary,
  defaultOpen = false,
  children,
}: {
  step: number
  title: string
  subtitle?: string
  summary?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-[#F9FAFB]"
        aria-expanded={open}
      >
        <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[12px] font-bold text-emerald-700">
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-[#111827]">{title}</div>
          {subtitle && (
            <div className="truncate text-[12px] text-[#6B7280]">{subtitle}</div>
          )}
        </div>
        {summary && !open && (
          <span className="hidden max-w-[40%] truncate rounded-full bg-[#F3F4F6] px-2.5 py-1 text-[11px] font-medium text-[#374151] sm:inline-block">
            {summary}
          </span>
        )}
        <span className="ml-1 text-[#9CA3AF] transition-transform" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && <div className="border-t border-[#F3F4F6] p-4">{children}</div>}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold text-[#374151]">{label}</span>
        {hint && <span className="text-[11px] text-[#9CA3AF]">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function TileGrid<T extends string>({
  value,
  tiles,
  onChange,
}: {
  value: T
  tiles: Array<{ value: T; label: string; hint: string; icon: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => {
        const active = value === t.value
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            aria-pressed={active}
            className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all ${
              active
                ? 'border-emerald-500 bg-emerald-50/60 shadow-sm ring-1 ring-emerald-500'
                : 'border-[#E5E7EB] bg-white hover:border-[#9CA3AF] hover:bg-[#F9FAFB]'
            }`}
          >
            <span className="text-[20px] leading-none">{t.icon}</span>
            <span
              className={`text-[13px] font-semibold ${
                active ? 'text-emerald-800' : 'text-[#111827]'
              }`}
            >
              {t.label}
            </span>
            <span className="text-[11px] text-[#6B7280]">{t.hint}</span>
          </button>
        )
      })}
    </div>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-[#E5E7EB] bg-[#F3F4F6] p-1">
      {options.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`rounded-md px-3 py-1.5 text-[13px] font-semibold transition-all ${
              active
                ? 'bg-white text-[#111827] shadow-sm'
                : 'text-[#6B7280] hover:text-[#111827]'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function SwatchPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ACCENT_SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Use ${c}`}
          aria-pressed={value.toLowerCase() === c.toLowerCase()}
          className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${
            value.toLowerCase() === c.toLowerCase()
              ? 'border-[#111827] ring-2 ring-[#111827]/20'
              : 'border-white shadow-sm'
          }`}
          style={{ background: c }}
        />
      ))}
      <div className="ml-2 flex items-center gap-1 rounded-md border border-[#D1D5DB] bg-white px-1.5 py-1">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
          aria-label="Custom color"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-20 border-0 bg-transparent font-mono text-[11px] focus:outline-none"
          aria-label="Hex color"
        />
      </div>
    </div>
  )
}

function CurrencyPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [custom, setCustom] = useState(!COMMON_CURRENCIES.includes(value))
  return custom ? (
    <div className="flex gap-1">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={8}
        className={inputCls}
        autoFocus
      />
      <button
        type="button"
        onClick={() => {
          setCustom(false)
          onChange('PHP')
        }}
        className="rounded-md border border-[#D1D5DB] bg-white px-2 text-[12px] text-[#6B7280] hover:bg-[#F9FAFB]"
        aria-label="Use common currency"
      >
        ↺
      </button>
    </div>
  ) : (
    <div className="flex flex-wrap gap-1">
      {COMMON_CURRENCIES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`rounded-md border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
            value === c
              ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
              : 'border-[#D1D5DB] bg-white text-[#374151] hover:bg-[#F9FAFB]'
          }`}
        >
          {c}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setCustom(true)}
        className="rounded-md border border-dashed border-[#D1D5DB] bg-white px-2.5 py-1.5 text-[12px] text-[#6B7280] hover:bg-[#F9FAFB]"
      >
        Other…
      </button>
    </div>
  )
}

function NumberInput({
  value,
  onChange,
  allowNull,
  placeholder,
}: {
  value: number | null
  onChange: (v: number | null) => void
  allowNull?: boolean
  placeholder?: string
}) {
  const handle = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    if (raw === '') {
      onChange(allowNull ? null : 0)
      return
    }
    const n = Number(raw)
    if (Number.isFinite(n)) onChange(n)
  }
  return (
    <input
      type="number"
      value={value ?? ''}
      onChange={handle}
      step="any"
      placeholder={placeholder}
      className={inputCls}
    />
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 rounded-md border border-[#D1D5DB] bg-white"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-[#D1D5DB] bg-white px-2 py-1 font-mono text-[12px]"
        />
      </div>
    </Field>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <span
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-emerald-600' : 'bg-[#D1D5DB]'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
      </span>
      <span>
        <span className="block text-[13px] font-semibold text-[#374151]">{label}</span>
        {hint && <span className="block text-[11px] text-[#6B7280]">{hint}</span>}
      </span>
    </label>
  )
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-[#D1D5DB] bg-white px-3 py-2.5 text-[13px] font-semibold text-[#6B7280] hover:border-emerald-500 hover:bg-emerald-50/50 hover:text-emerald-700"
    >
      <span className="text-[16px] leading-none">+</span> {label}
    </button>
  )
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: string
  title: string
  body: string
}) {
  return (
    <div className="rounded-lg border border-dashed border-[#D1D5DB] bg-[#F9FAFB] p-5 text-center">
      <div className="text-[24px]">{icon}</div>
      <div className="mt-1 text-[13px] font-semibold text-[#111827]">{title}</div>
      <div className="text-[12px] text-[#6B7280]">{body}</div>
    </div>
  )
}
