'use client'

import Link from 'next/link'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ChangeEvent,
} from 'react'
import { useFormStatus } from 'react-dom'
import { KIND_REGISTRY } from '@/lib/action-pages/kinds'
import type {
  ActionPageOption,
  ActionPageRow,
  PipelineStageOption,
} from '../_lib/queries'
import type { PaymentMethod } from '@/lib/payment-methods/types'
import { updateActionPage, deleteActionPage } from '../actions/crud'
import { SalesStudioPreview } from './SalesStudioPreview'
import { CopyField } from './CopyField'
import { PipelineRulesEditor } from './PipelineRulesEditor'
import { TriggerGuard } from './TriggerGuard'
import { TriggerField } from './TriggerField'
import { DraftSaveModal } from './DraftSaveModal'
import { useDraftGate } from './useDraftGate'
import { EchoTemplateField } from './EchoTemplateField'
import PaymentSettingsPanel, { type PaymentSettings } from './PaymentSettingsPanel'
import { extractCustomKeysFromConfig } from '../_lib/custom-keys'
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

// ─── constants ───────────────────────────────────────────────────────

const CAPI_EVENT_OPTIONS = [
  'LeadSubmitted',
  'QualifiedLead',
  'Purchase',
  'InitiateCheckout',
  'AddToCart',
  'ViewContent',
  'CartAbandoned',
  'OrderCreated',
  'OrderShipped',
  'OrderDelivered',
  'OrderCanceled',
  'OrderReturned',
  'RatingProvided',
  'ReviewProvided',
  'SKIP',
] as const

const PRODUCT_TYPE_TILES: Array<{
  value: ProductType
  label: string
  hint: string
  icon: string
}> = [
  { value: 'digital', label: 'Digital', hint: 'Files, downloads', icon: '💾' },
  { value: 'physical', label: 'Physical', hint: 'Items you ship', icon: '📦' },
  { value: 'service', label: 'Service', hint: 'Done for the buyer', icon: '🛠️' },
  { value: 'course', label: 'Course', hint: 'Lessons or workshops', icon: '🎓' },
  { value: 'other', label: 'Other', hint: 'Something else', icon: '✨' },
]

const DELIVERY_TILES: Array<{
  value: DeliveryType
  label: string
  hint: string
  icon: string
}> = [
  { value: 'instant_download', label: 'Instant download', hint: 'Auto file delivery', icon: '⚡' },
  { value: 'email', label: 'Sent by email', hint: 'You email it', icon: '✉️' },
  { value: 'shipped', label: 'Shipped', hint: 'Mail or courier', icon: '📮' },
  { value: 'scheduled', label: 'Scheduled', hint: 'Booked time slot', icon: '🗓️' },
  { value: 'manual', label: 'Manual', hint: 'You handle each one', icon: '🤝' },
]

const ACCENT_SWATCHES = [
  '#a04e3e',
  '#c96442',
  '#3d5a4c',
  '#1a1a1a',
  '#d97757',
  '#3a5a8c',
  '#7a5b07',
  '#5a8c5e',
]

const COMMON_CURRENCIES = ['PHP', 'USD', 'EUR', 'GBP', 'AUD', 'SGD']

const CURRENCY_SYMBOL: Record<string, string> = {
  PHP: '₱',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  SGD: 'S$',
}

const FUNNEL_STAGES: Array<{
  name: string
  goal: string
  blocks: SelectedId[]
}> = [
  { name: 'Hook', goal: 'grab attention', blocks: ['hero', 'headline', 'description', 'pricing'] },
  { name: 'Build desire', goal: 'show the value', blocks: ['socialProof', 'features', 'benefits'] },
  { name: 'Earn trust', goal: 'remove doubt', blocks: ['testimonials', 'faqs', 'guarantee'] },
  { name: 'Close', goal: 'ask for the sale', blocks: ['cta', 'delivery'] },
]

type FunnelId =
  | 'hero'
  | 'headline'
  | 'description'
  | 'pricing'
  | 'socialProof'
  | 'features'
  | 'benefits'
  | 'testimonials'
  | 'faqs'
  | 'guarantee'
  | 'cta'
  | 'delivery'
type SetupId = 'basics' | 'product' | 'brand' | 'payment' | 'linked' | 'fallback'
type AfterId = 'pipeline' | 'conversion' | 'echo' | 'share'
type SelectedId = FunnelId | SetupId | AfterId

const BLOCK_LABEL: Record<FunnelId, { label: string; icon: IconName }> = {
  hero: { label: 'Hero photos', icon: 'image' },
  headline: { label: 'Headline', icon: 'text' },
  description: { label: 'Description', icon: 'text' },
  pricing: { label: 'Pricing & buy', icon: 'bolt' },
  socialProof: { label: 'Social proof', icon: 'sparkle' },
  features: { label: "What's included", icon: 'check' },
  benefits: { label: 'Benefits', icon: 'list' },
  testimonials: { label: 'Testimonials', icon: 'message' },
  faqs: { label: 'FAQs', icon: 'info' },
  guarantee: { label: 'Guarantee', icon: 'check' },
  cta: { label: 'Final CTA', icon: 'arrowRight' },
  delivery: { label: 'Delivery', icon: 'folder' },
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function fmtPricePreview(
  amount: number | null,
  currency: string,
  period: PricePeriod | null,
  displayLabel: string,
): string {
  if (displayLabel.trim()) return displayLabel
  if (amount == null || !Number.isFinite(amount)) return '—'
  const sym = CURRENCY_SYMBOL[currency.toUpperCase()] ?? `${currency} `
  const num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount)
  const suffix = period === 'monthly' ? '/mo' : period === 'yearly' ? '/yr' : ''
  return `${sym}${num}${suffix}`
}

// ─── linkable pages api ──────────────────────────────────────────────

interface LinkablePage {
  id: string
  title: string
  slug: string
  kind: string
  status: string
}

// ═════════════════════════════════════════════════════════════════════
// SHELL
// ═════════════════════════════════════════════════════════════════════

export function SalesStudioShell({
  page,
  stages,
  publicUrl,
  embedUrl,
  embedSnippet,
  saved,
  errorBanner,
  paymentMethods = [],
}: {
  page: ActionPageRow
  stages: PipelineStageOption[]
  actionPages?: ActionPageOption[]
  publicUrl: string
  embedUrl: string
  embedSnippet: string
  saved: boolean
  errorBanner: string | null
  paymentMethods?: PaymentMethod[]
}) {
  const meta = KIND_REGISTRY[page.kind]
  const initialConfig = useMemo<SalesConfig>(
    () => parseSalesConfig(page.config) ?? defaultSalesConfig(),
    [page.config],
  )

  const [title, setTitle] = useState(page.title)
  const [description, setDescription] = useState(page.description ?? '')
  const [slug, setSlug] = useState(page.slug)
  const [status, setStatus] = useState<ActionPageRow['status']>(page.status)
  const [config, setConfig] = useState<SalesConfig>(initialConfig)
  const [selected, setSelected] = useState<SelectedId>('pricing')
  const [mobilePane, setMobilePane] = useState<'tree' | 'preview' | 'inspector'>('tree')

  const formRef = useRef<HTMLFormElement | null>(null)
  const draftGate = useDraftGate({ status, setStatus })

  // Hide app chrome — reuse booking-studio body attr (existing CSS targets it)
  // plus the sales-studio attr for our own theme overrides.
  useEffect(() => {
    document.body.dataset.bookingStudio = '1'
    document.body.dataset.salesStudio = '1'
    return () => {
      delete document.body.dataset.bookingStudio
      delete document.body.dataset.salesStudio
    }
  }, [])

  // ── patchers ────────────────────────────────────────────────────
  const patchProduct = (p: Partial<SalesConfig['product']>) =>
    setConfig((c) => ({ ...c, product: { ...c.product, ...p } }))
  const patchPrice = (p: Partial<SalesConfig['price']>) =>
    setConfig((c) => ({ ...c, price: { ...c.price, ...p } }))
  const patchTheme = (p: Partial<SalesConfig['theme']>) =>
    setConfig((c) => ({ ...c, theme: { ...c.theme, ...p } }))
  const patchGuarantee = (p: Partial<SalesConfig['guarantee']>) =>
    setConfig((c) => ({ ...c, guarantee: { ...c.guarantee, ...p } }))
  const patchDelivery = (p: Partial<SalesConfig['delivery']>) =>
    setConfig((c) => ({ ...c, delivery: { ...c.delivery, ...p } }))
  const patchCta = (p: Partial<SalesConfig['cta']>) =>
    setConfig((c) => ({ ...c, cta: { ...c.cta, ...p } }))
  const patchFallback = (p: Partial<SalesConfig['fallback_form']>) =>
    setConfig((c) => ({ ...c, fallback_form: { ...c.fallback_form, ...p } }))
  const setGallery = (g: SalesGalleryItem[]) => setConfig((c) => ({ ...c, gallery: g }))
  const setFeatures = (f: SalesFeature[]) => setConfig((c) => ({ ...c, features: f }))
  const setBenefits = (b: SalesBenefit[]) => setConfig((c) => ({ ...c, benefits: b }))
  const setTestimonials = (t: SalesTestimonial[]) => setConfig((c) => ({ ...c, testimonials: t }))
  const setFaqs = (f: SalesFaq[]) => setConfig((c) => ({ ...c, faqs: f }))
  const setSocialProof = (s: SalesSocialProof[]) => setConfig((c) => ({ ...c, social_proof: s }))
  const setLinked = (ids: string[]) =>
    setConfig((c) => ({ ...c, linked_action_page_ids: ids }))
  const setPayment = (p: PaymentSettings) =>
    setConfig((c) => ({ ...c, payment: p }))

  // ── derived counts ──────────────────────────────────────────────
  const heroSub = `${config.gallery.length} ${config.gallery.length === 1 ? 'photo' : 'photos'}`
  const pricingSub = fmtPricePreview(
    config.price.amount,
    config.price.currency,
    config.price.period,
    config.price.display_label,
  )
  const featuresSub = `${config.features.length} ${config.features.length === 1 ? 'feature' : 'features'}`

  const onSelect = (id: SelectedId) => {
    setSelected(id)
    setMobilePane('inspector')
  }

  // Conversion checklist data
  const checklist: Array<{ label: string; done: boolean; jumpTo?: SelectedId }> = [
    { label: 'Clear price + anchor', done: config.price.amount != null, jumpTo: 'pricing' },
    { label: 'Social proof / stats', done: config.social_proof.length > 0, jumpTo: 'socialProof' },
    { label: 'Customer testimonials', done: config.testimonials.length > 0, jumpTo: 'testimonials' },
    { label: 'Risk-reversal guarantee', done: config.guarantee.enabled, jumpTo: 'guarantee' },
    { label: 'Objection-handling FAQ', done: config.faqs.length > 0, jumpTo: 'faqs' },
    { label: 'Urgency / scarcity', done: false },
  ]

  return (
    <div data-booking-studio data-sales-studio>
      <SalesStudioStyles />
      <form ref={formRef} action={updateActionPage} className="bs-form">
        {/* hidden inputs */}
        <input type="hidden" name="id" value={page.id} />
        <input type="hidden" name="title" value={title} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="description" value={description} />
        <input type="hidden" name="status" value={status} />
        <input type="hidden" name="config" value={JSON.stringify(config)} />

        {/* ─── TOP BAR ───────────────────────────────────────── */}
        <header className="bs-topbar">
          <TriggerGuard
            pageId={page.id}
            initialTrigger={page.bot_send_instructions}
            backHref="/dashboard/action-pages"
            className="bs-back"
            onJumpToTrigger={() => setSelected('cta')}
          >
            <Icon name="chevLeft" size={14} /> Back
          </TriggerGuard>
          <span className="bs-sep">/</span>
          <div className="bs-crumbs">
            <span className="bs-crumb-muted">Action pages</span>
            <Icon name="chevRight" size={11} />
            <span className="bs-crumb-cur">{title || page.title || 'Untitled'}</span>
            <span className="bs-pill accent">
              <Icon name="bolt" size={10} /> Sales
            </span>
            <span
              className={`bs-pill ${status === 'published' ? 'live' : status === 'draft' ? 'draft' : ''}`}
            >
              <span className="bs-pill-dot" />
              {status === 'published' ? 'Live' : status === 'draft' ? 'Draft' : 'Archived'}
            </span>
          </div>
          <div className="bs-spacer" />
          <Link
            href={`/dashboard/action-pages/${page.id}/submissions`}
            className="bs-btn bs-btn-ghost"
          >
            <Icon name="eye" size={13} /> Submissions
          </Link>
          <SaveButton onClick={(e) => draftGate.requestSave(e.currentTarget.form)} />
        </header>

        {saved && <div className="bs-banner success">Saved.</div>}
        {errorBanner && <div className="bs-banner error">{errorBanner}</div>}

        {/* ─── OFFER BAR ─────────────────────────────────────── */}
        <div className="ss-offerbar">
          <div className="ss-offerbar-id">
            <div className="ss-offerbar-icon">
              <Icon name="image" size={16} />
            </div>
            <div className="ss-offerbar-id-meta">
              <div className="ss-offerbar-name">
                <span>{config.product.name || title || 'Untitled product'}</span>
                <span className="bs-pill">{config.product.type}</span>
              </div>
              <div className="ss-offerbar-sub">{description || meta.label}</div>
            </div>
          </div>
          <div className="ss-offerbar-price">
            <span className="ss-offerbar-price-main">
              {fmtPricePreview(
                config.price.amount,
                config.price.currency,
                config.price.period,
                config.price.display_label,
              )}
            </span>
            {config.price.compare_at_amount != null &&
              config.price.amount != null &&
              config.price.compare_at_amount > config.price.amount && (
                <span className="ss-offerbar-price-was">
                  {CURRENCY_SYMBOL[config.price.currency.toUpperCase()] ?? config.price.currency}
                  {new Intl.NumberFormat('en-US').format(config.price.compare_at_amount)}
                </span>
              )}
            <span className="ss-offerbar-price-period">
              ·{' '}
              {config.price.period === 'monthly'
                ? 'monthly'
                : config.price.period === 'yearly'
                  ? 'yearly'
                  : 'one-time'}
            </span>
          </div>
          <div className="bs-spacer" />
        </div>

        {/* ─── MOBILE PANE TABS ──────────────────────────────── */}
        <div className="bs-mobile-tabs">
          {(['tree', 'preview', 'inspector'] as const).map((p) => (
            <button
              type="button"
              key={p}
              className={`bs-mobile-tab ${mobilePane === p ? 'active' : ''}`}
              onClick={() => setMobilePane(p)}
            >
              {p === 'tree' ? 'Blocks' : p === 'preview' ? 'Preview' : 'Inspector'}
            </button>
          ))}
        </div>

        {/* ─── 3 PANES ───────────────────────────────────────── */}
        <div className="bs-shell">
          {/* LEFT */}
          <aside className={`bs-pane bs-left ${mobilePane === 'tree' ? 'mobile-active' : ''}`}>
            {/* Bot trigger */}
            <div className="bs-section bs-trigger">
              <div className="bs-seclabel">
                <span>
                  <Icon name="bot" size={11} /> Bot trigger
                </span>
                <span className="bs-pill accent">
                  <Icon name="sparkle" size={9} /> AI
                </span>
              </div>
              <div className="bs-trigger-box">
                <div className="bs-trigger-help">Send this page when…</div>
                <TriggerField
                  initial={page.bot_send_instructions ?? ''}
                  defaultText={meta.defaultBotSendInstructions}
                  rows={3}
                  placeholder="Send when the lead asks about pricing, wants to buy, or asks for the offer."
                  className="bs-trigger-textarea"
                />
              </div>
            </div>

            {/* Funnel stages */}
            <div className="bs-section bs-blocks">
              <div className="bs-seclabel">
                <span>
                  <Icon name="layers" size={11} /> Page flow
                </span>
              </div>

              {FUNNEL_STAGES.map((stage, si) => (
                <div key={stage.name} className="ss-funnel-stage">
                  <div className="ss-funnel-head">
                    <span className="ss-funnel-num">{si + 1}</span>
                    <span className="ss-funnel-name">{stage.name}</span>
                    <span className="ss-funnel-goal">{stage.goal}</span>
                  </div>
                  <div className="ss-funnel-rows">
                    {stage.blocks.map((id) => {
                      const meta = BLOCK_LABEL[id as FunnelId]
                      let sub = ''
                      if (id === 'hero') sub = heroSub
                      else if (id === 'headline') sub = config.product.headline || '—'
                      else if (id === 'description')
                        sub = config.product.description.trim()
                          ? `${config.product.description.length} chars`
                          : 'Empty'
                      else if (id === 'pricing') sub = pricingSub
                      else if (id === 'socialProof') sub = `${config.social_proof.length} stats`
                      else if (id === 'features') sub = featuresSub
                      else if (id === 'benefits') sub = `${config.benefits.length} bullets`
                      else if (id === 'testimonials') sub = `${config.testimonials.length} quotes`
                      else if (id === 'faqs') sub = `${config.faqs.length} questions`
                      else if (id === 'guarantee') sub = config.guarantee.enabled ? 'On' : 'Off'
                      else if (id === 'cta') sub = config.cta.primary_label || 'Get it now'
                      else if (id === 'delivery')
                        sub = DELIVERY_TILES.find((d) => d.value === config.delivery.type)?.label ?? '—'
                      return (
                        <BlockRow
                          key={id}
                          block={{ id, label: meta.label, sub, icon: meta.icon }}
                          selected={selected === id}
                          onClick={() => onSelect(id)}
                        />
                      )
                    })}
                  </div>
                </div>
              ))}

              <div className="bs-seclabel mt">
                <span>
                  <Icon name="settings" size={11} /> Page setup
                </span>
              </div>
              <div className="bs-rows">
                {(
                  [
                    { id: 'basics', label: 'Basics', sub: `/${slug}`, icon: 'info' as const },
                    {
                      id: 'product',
                      label: 'Product',
                      sub: `${PRODUCT_TYPE_TILES.find((p) => p.value === config.product.type)?.label ?? 'Digital'}`,
                      icon: 'folder' as const,
                    },
                    {
                      id: 'brand',
                      label: 'Brand & colors',
                      sub: config.theme.accent_color,
                      icon: 'sparkle' as const,
                    },
                    {
                      id: 'payment',
                      label: 'Payment',
                      sub: config.payment.enabled ? `${paymentMethods.length} methods` : 'Off',
                      icon: 'bolt' as const,
                    },
                    {
                      id: 'linked',
                      label: 'Linked pages',
                      sub: `${config.linked_action_page_ids.length} attached`,
                      icon: 'link' as const,
                    },
                    {
                      id: 'fallback',
                      label: 'Default form',
                      sub: `${config.fallback_form.fields.filter((f) => f.enabled).length} fields`,
                      icon: 'form' as const,
                    },
                  ] satisfies Array<{ id: SetupId; label: string; sub: string; icon: IconName }>
                ).map((b) => (
                  <BlockRow
                    key={b.id}
                    block={b}
                    selected={selected === b.id}
                    onClick={() => onSelect(b.id)}
                  />
                ))}
              </div>

              <div className="bs-seclabel mt">
                <span>
                  <Icon name="sliders" size={11} /> After purchase
                </span>
              </div>
              <div className="bs-rows">
                {(
                  [
                    {
                      id: 'pipeline',
                      label: 'Pipeline',
                      sub: `${page.pipeline_rules.length} rule${page.pipeline_rules.length === 1 ? '' : 's'}`,
                      icon: 'pipeline' as const,
                    },
                    {
                      id: 'conversion',
                      label: 'Conversion event',
                      sub: page.capi_event_name_override ?? 'InitiateCheckout',
                      icon: 'target' as const,
                    },
                    {
                      id: 'echo',
                      label: 'Messenger echo',
                      sub: page.notification_template?.text ? 'Set' : 'Empty',
                      icon: 'message' as const,
                    },
                    {
                      id: 'share',
                      label: 'Share & embed',
                      sub: `/a/${slug}`,
                      icon: 'share' as const,
                    },
                  ] satisfies Array<{ id: AfterId; label: string; sub: string; icon: IconName }>
                ).map((b) => (
                  <BlockRow
                    key={b.id}
                    block={b}
                    selected={selected === b.id}
                    onClick={() => onSelect(b.id)}
                  />
                ))}
              </div>
            </div>

            {/* Conversion checklist */}
            <div className="ss-checklist">
              <div className="ss-checklist-head">
                <span>
                  <Icon name="target" size={11} /> Conversion checklist
                </span>
                <span className="ss-checklist-count">
                  {checklist.filter((c) => c.done).length}/{checklist.length}
                </span>
              </div>
              {checklist.map((it) => (
                <div key={it.label} className="ss-checklist-item">
                  <span className={`ss-checklist-dot ${it.done ? 'done' : ''}`}>
                    {it.done && <Icon name="check" size={8} color="#fff" />}
                  </span>
                  <span className={`ss-checklist-label ${it.done ? 'done' : ''}`}>{it.label}</span>
                  {!it.done && it.jumpTo && (
                    <button
                      type="button"
                      className="ss-checklist-add"
                      onClick={() => onSelect(it.jumpTo!)}
                    >
                      Add
                    </button>
                  )}
                </div>
              ))}
            </div>
          </aside>

          {/* CENTER */}
          <main className={`bs-pane bs-center ss-center ${mobilePane === 'preview' ? 'mobile-active' : ''}`}>
            <div className="bs-canvas-toolbar">
              <Icon name="eye" size={12} />
              <span>Live preview · what a buyer sees at /a/{slug}</span>
              <div className="bs-spacer" />
              <span className="bs-mute">Click a block on the left to edit</span>
            </div>
            <div className="ss-canvas">
              <SalesStudioPreview
                title={title}
                config={config}
                selectedBlock={selected}
              />
            </div>
          </main>

          {/* RIGHT */}
          <aside className={`bs-pane bs-right ${mobilePane === 'inspector' ? 'mobile-active' : ''}`}>
            <InspectorSlot active={selected === 'basics'}>
              <InspectorBasics
                title={title}
                description={description}
                slug={slug}
                status={status}
                onTitle={setTitle}
                onDescription={setDescription}
                onSlug={setSlug}
                onStatus={setStatus}
              />
            </InspectorSlot>
            <InspectorSlot active={selected === 'product'}>
              <InspectorProduct config={config} patchProduct={patchProduct} />
            </InspectorSlot>
            <InspectorSlot active={selected === 'brand'}>
              <InspectorBrand theme={config.theme} patchTheme={patchTheme} />
            </InspectorSlot>
            <InspectorSlot active={selected === 'hero'}>
              <InspectorGallery
                pageId={page.id}
                gallery={config.gallery}
                onChange={setGallery}
              />
            </InspectorSlot>
            <InspectorSlot active={selected === 'headline'}>
              <InspectorHeadline product={config.product} patchProduct={patchProduct} />
            </InspectorSlot>
            <InspectorSlot active={selected === 'description'}>
              <InspectorDescription product={config.product} patchProduct={patchProduct} />
            </InspectorSlot>
            <InspectorSlot active={selected === 'pricing'}>
              <InspectorPricing price={config.price} patchPrice={patchPrice} />
            </InspectorSlot>
            <InspectorSlot active={selected === 'socialProof'}>
              <InspectorSocialProof items={config.social_proof} onChange={setSocialProof} />
            </InspectorSlot>
            <InspectorSlot active={selected === 'features'}>
              <InspectorFeatures features={config.features} onChange={setFeatures} />
            </InspectorSlot>
            <InspectorSlot active={selected === 'benefits'}>
              <InspectorBenefits benefits={config.benefits} onChange={setBenefits} />
            </InspectorSlot>
            <InspectorSlot active={selected === 'testimonials'}>
              <InspectorTestimonials
                pageId={page.id}
                testimonials={config.testimonials}
                onChange={setTestimonials}
              />
            </InspectorSlot>
            <InspectorSlot active={selected === 'faqs'}>
              <InspectorFaqs faqs={config.faqs} onChange={setFaqs} />
            </InspectorSlot>
            <InspectorSlot active={selected === 'guarantee'}>
              <InspectorGuarantee
                guarantee={config.guarantee}
                patchGuarantee={patchGuarantee}
              />
            </InspectorSlot>
            <InspectorSlot active={selected === 'delivery'}>
              <InspectorDelivery
                delivery={config.delivery}
                patchDelivery={patchDelivery}
              />
            </InspectorSlot>
            <InspectorSlot active={selected === 'cta'}>
              <InspectorCta
                cta={config.cta}
                accent={config.theme.accent_color}
                patchCta={patchCta}
                ctaLabelInitial={page.cta_label ?? ''}
              />
            </InspectorSlot>
            <InspectorSlot active={selected === 'payment'}>
              <InspectorPaymentWrap
                payment={config.payment}
                setPayment={setPayment}
                paymentMethods={paymentMethods}
              />
            </InspectorSlot>
            <InspectorSlot active={selected === 'linked'}>
              <InspectorLinkedPages
                currentPageId={page.id}
                linkedIds={config.linked_action_page_ids}
                onChange={setLinked}
              />
            </InspectorSlot>
            <InspectorSlot active={selected === 'fallback'}>
              <InspectorFallback
                fallback={config.fallback_form}
                patchFallback={patchFallback}
                hasLinked={config.linked_action_page_ids.length > 0}
              />
            </InspectorSlot>
            <InspectorSlot active={selected === 'pipeline'}>
              <InspectorPipeline page={page} stages={stages} />
            </InspectorSlot>
            <InspectorSlot active={selected === 'conversion'}>
              <InspectorConversion defaultValue={page.capi_event_name_override ?? ''} />
            </InspectorSlot>
            <InspectorSlot active={selected === 'echo'}>
              <InspectorEcho page={page} />
            </InspectorSlot>
            <InspectorSlot active={selected === 'share'}>
              <InspectorShare
                publicUrl={publicUrl}
                embedUrl={embedUrl}
                embedSnippet={embedSnippet}
                supportsEmbed={meta.supportsEmbed}
              />
            </InspectorSlot>
          </aside>
        </div>
      </form>

      <DangerZone id={page.id} />
      <DraftSaveModal {...draftGate.modalProps} />
    </div>
  )
}

// ─── Save button / chrome ────────────────────────────────────────────

function SaveButton({
  onClick,
}: {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      className="bs-btn bs-btn-primary"
    >
      {pending ? 'Saving…' : 'Save changes'}
      {!pending && <Icon name="arrowRight" size={12} />}
    </button>
  )
}

function DangerZone({ id }: { id: string }) {
  return (
    <form action={deleteActionPage} className="bs-danger">
      <input type="hidden" name="id" value={id} />
      <div>
        <h3>Danger zone</h3>
        <p>Deleting an action page is permanent. Past submissions are kept on the lead records.</p>
      </div>
      <button
        type="submit"
        className="bs-btn bs-btn-danger"
        onClick={(e) => {
          if (!confirm('Delete this action page? This cannot be undone.')) e.preventDefault()
        }}
      >
        Delete page
      </button>
    </form>
  )
}

function InspectorSlot({ active, children }: { active: boolean; children: ReactNode }) {
  return <div style={{ display: active ? 'block' : 'none' }}>{children}</div>
}

function BlockRow({
  block,
  selected,
  onClick,
}: {
  block: { id: string; label: string; sub: string; icon: IconName }
  selected: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className={`bs-row ${selected ? 'sel' : ''}`} onClick={onClick}>
      <span className="bs-row-rail" aria-hidden />
      <Icon name={block.icon} size={13} color={selected ? 'var(--bs-accent-2)' : 'var(--bs-ink-3)'} />
      <span className="bs-row-meta">
        <span className="bs-row-label">{block.label}</span>
        <span className="bs-row-sub">{block.sub}</span>
      </span>
    </button>
  )
}

function InspectorHead({
  icon,
  title,
  sub,
}: {
  icon: IconName
  title: string
  sub: string
}) {
  return (
    <div className="bs-insphead">
      <div className="bs-insphead-icon">
        <Icon name={icon} size={15} />
      </div>
      <div>
        <div className="bs-insphead-title">{title}</div>
        <div className="bs-insphead-sub">{sub}</div>
      </div>
    </div>
  )
}

function InspGroup({
  label,
  children,
  action,
}: {
  label?: ReactNode
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="bs-group">
      {label && (
        <div className="bs-seclabel">
          <span>{label}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="bs-field">
      <span className="bs-field-label">{label}</span>
      {children}
      {hint && <span className="bs-field-hint">{hint}</span>}
    </label>
  )
}

// ═════════════════════════════════════════════════════════════════════
// INSPECTORS
// ═════════════════════════════════════════════════════════════════════

function InspectorBasics({
  title,
  description,
  slug,
  status,
  onTitle,
  onDescription,
  onSlug,
  onStatus,
}: {
  title: string
  description: string
  slug: string
  status: ActionPageRow['status']
  onTitle: (v: string) => void
  onDescription: (v: string) => void
  onSlug: (v: string) => void
  onStatus: (v: ActionPageRow['status']) => void
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="info" title="Basics" sub="Title, slug, status" />
      <InspGroup label="Title">
        <input
          className="bs-input"
          value={title}
          onChange={(e) => onTitle(e.target.value.slice(0, 120))}
          maxLength={120}
          placeholder="e.g. Beginner workshop"
        />
      </InspGroup>
      <InspGroup label="Description">
        <textarea
          className="bs-textarea"
          value={description}
          onChange={(e) => onDescription(e.target.value.slice(0, 2000))}
          rows={3}
          placeholder="One or two sentences buyers see first."
        />
      </InspGroup>
      <InspGroup label="Slug">
        <div className="bs-input-affix">
          <span className="bs-prefix">/a/</span>
          <input
            value={slug}
            onChange={(e) =>
              onSlug(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9-]/g, '-')
                  .replace(/^-+/, ''),
              )
            }
            pattern="[a-z0-9][-a-z0-9]*"
          />
        </div>
      </InspGroup>
      <InspGroup label="Status">
        <div className="bs-segment">
          {(
            [
              { v: 'draft', l: 'Draft' },
              { v: 'published', l: 'Live' },
              { v: 'archived', l: 'Archived' },
            ] as { v: ActionPageRow['status']; l: string }[]
          ).map((o) => (
            <button
              type="button"
              key={o.v}
              onClick={() => onStatus(o.v)}
              className={`bs-segbtn ${status === o.v ? 'on' : ''}`}
            >
              <span className={`bs-dot ${o.v}`} />
              {o.l}
            </button>
          ))}
        </div>
      </InspGroup>
    </div>
  )
}

function InspectorProduct({
  config,
  patchProduct,
}: {
  config: SalesConfig
  patchProduct: (p: Partial<SalesConfig['product']>) => void
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="folder" title="Product" sub="What you're selling" />
      <InspGroup label="Product name">
        <input
          className="bs-input"
          value={config.product.name}
          onChange={(e) => patchProduct({ name: e.target.value.slice(0, 160) })}
          maxLength={160}
          placeholder="e.g. Messenger Growth Playbook"
        />
      </InspGroup>
      <InspGroup label="Product type">
        <div className="ss-tilegrid">
          {PRODUCT_TYPE_TILES.map((t) => {
            const active = config.product.type === t.value
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => patchProduct({ type: t.value })}
                className={`ss-tile ${active ? 'on' : ''}`}
              >
                <span className="ss-tile-icon">{t.icon}</span>
                <span className="ss-tile-label">{t.label}</span>
                <span className="ss-tile-hint">{t.hint}</span>
              </button>
            )
          })}
        </div>
      </InspGroup>
      <InspGroup label="Long description">
        <textarea
          className="bs-textarea"
          value={config.product.description}
          onChange={(e) => patchProduct({ description: e.target.value.slice(0, 8000) })}
          rows={4}
          placeholder="The longer pitch shown below the hero."
        />
      </InspGroup>
    </div>
  )
}

function InspectorBrand({
  theme,
  patchTheme,
}: {
  theme: SalesConfig['theme']
  patchTheme: (p: Partial<SalesConfig['theme']>) => void
}) {
  const [advanced, setAdvanced] = useState(false)
  return (
    <div className="bs-insp">
      <InspectorHead icon="sparkle" title="Brand & colors" sub="Visual identity" />
      <InspGroup label="Brand color">
        <div className="bs-swatches">
          {ACCENT_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className={`bs-swatch ${theme.accent_color.toLowerCase() === c.toLowerCase() ? 'on' : ''}`}
              style={{ background: c }}
              onClick={() => patchTheme({ accent_color: c })}
              aria-label={c}
            />
          ))}
          <input
            type="color"
            className="bs-color"
            value={theme.accent_color}
            onChange={(e) => patchTheme({ accent_color: e.target.value })}
          />
        </div>
      </InspGroup>
      <InspGroup>
        <button
          type="button"
          onClick={() => setAdvanced((o) => !o)}
          className="ss-advanced-toggle"
        >
          <Icon name={advanced ? 'chevDown' : 'chevRight'} size={11} />
          Advanced colors
        </button>
        {advanced && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Field label="Background">
              <div className="bs-color-row">
                <input
                  type="color"
                  value={theme.background_color}
                  onChange={(e) => patchTheme({ background_color: e.target.value })}
                />
                <input
                  className="bs-input mono sm"
                  value={theme.background_color}
                  onChange={(e) => patchTheme({ background_color: e.target.value })}
                />
              </div>
            </Field>
            <Field label="Button text">
              <div className="bs-color-row">
                <input
                  type="color"
                  value={theme.button_text_color}
                  onChange={(e) => patchTheme({ button_text_color: e.target.value })}
                />
                <input
                  className="bs-input mono sm"
                  value={theme.button_text_color}
                  onChange={(e) => patchTheme({ button_text_color: e.target.value })}
                />
              </div>
            </Field>
          </div>
        )}
      </InspGroup>
    </div>
  )
}

function InspectorGallery({
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

  const sorted = [...gallery].sort((a, b) => a.position - b.position)

  return (
    <div className="bs-insp">
      <InspectorHead icon="image" title="Photos" sub="Up to 8, 5 MB each" />
      <InspGroup>
        <div
          className={`ss-drop ${dragOver ? 'on' : ''}`}
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
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleFiles(e.target.files)}
          />
          <Icon name="image" size={18} />
          <div className="ss-drop-title">
            {uploading ? 'Uploading…' : 'Drop images or click to upload'}
          </div>
          <div className="ss-drop-sub">JPEG, PNG, WebP · max 5 MB each</div>
        </div>
        {error && <div className="ss-error">{error}</div>}
      </InspGroup>
      {sorted.length > 0 && (
        <InspGroup label={<>Gallery <span style={{ color: 'var(--bs-ink-4)' }}>· {sorted.length}</span></>}>
          <div className="ss-gallery-list">
            {sorted.map((g) => (
              <div key={g.id} className="ss-gallery-item">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g.url} alt={g.alt} className="ss-gallery-thumb" />
                {g.primary && <span className="ss-gallery-hero">Hero</span>}
                <input
                  className="bs-input sm"
                  placeholder="Alt text"
                  value={g.alt}
                  onChange={(e) =>
                    onChange(
                      gallery.map((x) =>
                        x.id === g.id ? { ...x, alt: e.target.value.slice(0, 200) } : x,
                      ),
                    )
                  }
                />
                <div className="ss-gallery-actions">
                  {!g.primary && (
                    <button
                      type="button"
                      className="bs-link"
                      onClick={() =>
                        onChange(gallery.map((x) => ({ ...x, primary: x.id === g.id })))
                      }
                    >
                      Set hero
                    </button>
                  )}
                  <button
                    type="button"
                    className="bs-iconbtn danger"
                    onClick={() => onChange(gallery.filter((x) => x.id !== g.id))}
                    aria-label="Remove"
                  >
                    <Icon name="x" size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </InspGroup>
      )}
    </div>
  )
}

function InspectorHeadline({
  product,
  patchProduct,
}: {
  product: SalesConfig['product']
  patchProduct: (p: Partial<SalesConfig['product']>) => void
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="text" title="Headline" sub="The big hook above the fold" />
      <InspGroup label="Headline">
        <textarea
          className="bs-textarea"
          rows={2}
          value={product.headline}
          onChange={(e) => patchProduct({ headline: e.target.value.slice(0, 200) })}
          placeholder="The big offer in one line"
        />
        <div className="ss-counter">{product.headline.length}/200</div>
      </InspGroup>
      <InspGroup label="Tagline">
        <textarea
          className="bs-textarea"
          rows={2}
          value={product.tagline}
          onChange={(e) => patchProduct({ tagline: e.target.value.slice(0, 300) })}
          placeholder="Supporting line under the headline"
        />
        <div className="ss-counter">{product.tagline.length}/300</div>
      </InspGroup>
    </div>
  )
}

function InspectorDescription({
  product,
  patchProduct,
}: {
  product: SalesConfig['product']
  patchProduct: (p: Partial<SalesConfig['product']>) => void
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="text" title="Description" sub="The long pitch shown below the hero" />
      <InspGroup label="Body">
        <textarea
          className="bs-textarea"
          rows={10}
          value={product.description}
          onChange={(e) => patchProduct({ description: e.target.value.slice(0, 8000) })}
          placeholder="Tell buyers exactly what they get, who it's for, and why it works. Line breaks are preserved."
        />
        <div className="ss-counter">{product.description.length}/8000</div>
      </InspGroup>
    </div>
  )
}

function InspectorPricing({
  price,
  patchPrice,
}: {
  price: SalesConfig['price']
  patchPrice: (p: Partial<SalesConfig['price']>) => void
}) {
  const [customOpen, setCustomOpen] = useState(price.display_label.length > 0)
  const sym = CURRENCY_SYMBOL[price.currency.toUpperCase()] ?? price.currency
  return (
    <div className="bs-insp">
      <InspectorHead icon="bolt" title="Pricing" sub="How you charge for this" />

      <InspGroup label={<><Icon name="eye" size={11} /> Live preview</>}>
        <div className="ss-price-preview">
          <span className="ss-price-main">
            {fmtPricePreview(price.amount, price.currency, price.period, price.display_label)}
          </span>
          {price.compare_at_amount != null &&
            price.amount != null &&
            price.compare_at_amount > price.amount && (
              <span className="ss-price-was">
                {sym}
                {new Intl.NumberFormat('en-US').format(price.compare_at_amount)}
              </span>
            )}
        </div>
      </InspGroup>

      <InspGroup label="Currency">
        <div className="ss-currency-row">
          {COMMON_CURRENCIES.map((c) => {
            const active = c === price.currency
            return (
              <button
                key={c}
                type="button"
                onClick={() => patchPrice({ currency: c })}
                className={`ss-currency-pill ${active ? 'on' : ''}`}
              >
                <span className="ss-currency-sym">{CURRENCY_SYMBOL[c]}</span>
                {c}
              </button>
            )
          })}
        </div>
      </InspGroup>

      <InspGroup>
        <Field label="Price">
          <PriceField
            currency={price.currency}
            value={price.amount}
            onChange={(v) => patchPrice({ amount: v })}
          />
        </Field>
        <Field
          label={
            <>
              Was / compare-at <span style={{ color: 'var(--bs-ink-4)' }}>· optional</span>
            </>
          }
          hint="Shown as strikethrough next to the price. Renders a Save badge."
        >
          <PriceField
            currency={price.currency}
            value={price.compare_at_amount}
            strike
            onChange={(v) => patchPrice({ compare_at_amount: v })}
          />
        </Field>
        <Field label="Billing">
          <div className="bs-segment">
            {(
              [
                { v: null, l: 'One-time' },
                { v: 'monthly' as PricePeriod, l: 'Per month' },
                { v: 'yearly' as PricePeriod, l: 'Per year' },
              ] satisfies Array<{ v: PricePeriod | null; l: string }>
            ).map((o) => (
              <button
                type="button"
                key={o.l}
                onClick={() => patchPrice({ period: o.v })}
                className={`bs-segbtn ${price.period === o.v ? 'on' : ''}`}
              >
                {o.l}
              </button>
            ))}
          </div>
        </Field>
      </InspGroup>

      <InspGroup>
        <button
          type="button"
          onClick={() => setCustomOpen((o) => !o)}
          className="ss-advanced-toggle"
        >
          <Icon name={customOpen ? 'chevDown' : 'chevRight'} size={11} />
          Custom price label override
          <span style={{ fontSize: 10.5, color: 'var(--bs-ink-4)', fontWeight: 400 }}>· advanced</span>
        </button>
        {customOpen && (
          <div style={{ marginTop: 8 }}>
            <input
              className="bs-input"
              value={price.display_label}
              onChange={(e) => patchPrice({ display_label: e.target.value.slice(0, 80) })}
              placeholder='e.g. "Pay what you can"'
              maxLength={80}
            />
            <div className="bs-field-hint">
              Replaces the formatted price entirely. Max 80 chars.
            </div>
          </div>
        )}
      </InspGroup>
    </div>
  )
}

function PriceField({
  currency,
  value,
  strike,
  onChange,
}: {
  currency: string
  value: number | null
  strike?: boolean
  onChange: (v: number | null) => void
}) {
  const sym = CURRENCY_SYMBOL[currency.toUpperCase()] ?? currency
  const handle = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    if (raw === '') {
      onChange(null)
      return
    }
    const n = Number(raw)
    if (Number.isFinite(n)) onChange(n)
  }
  return (
    <div className="ss-price-input">
      <span className="ss-price-input-sym">{sym}</span>
      <input
        type="number"
        step="any"
        value={value ?? ''}
        onChange={handle}
        style={{ textDecoration: strike ? 'line-through' : 'none' }}
      />
      <span className="ss-price-input-suf">{currency}</span>
    </div>
  )
}

function InspectorSocialProof({
  items,
  onChange,
}: {
  items: SalesSocialProof[]
  onChange: (v: SalesSocialProof[]) => void
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="sparkle" title="Social proof" sub="Big-number stats above the fold" />
      <InspGroup
        label="Stats"
        action={
          <button
            type="button"
            className="bs-link"
            onClick={() => onChange([...items, { id: genId(), stat_value: '', stat_label: '' }])}
          >
            <Icon name="plus" size={11} /> Add
          </button>
        }
      >
        <div className="ss-rows">
          {items.length === 0 && (
            <div className="bs-empty-state">
              <Icon name="sparkle" size={18} />
              <div>No stats yet</div>
            </div>
          )}
          {items.map((s) => (
            <div key={s.id} className="ss-statrow">
              <input
                className="ss-stat-value"
                value={s.stat_value}
                onChange={(e) =>
                  onChange(items.map((x) => (x.id === s.id ? { ...x, stat_value: e.target.value.slice(0, 40) } : x)))
                }
                placeholder="1,200+"
              />
              <input
                className="bs-input sm"
                value={s.stat_label}
                onChange={(e) =>
                  onChange(items.map((x) => (x.id === s.id ? { ...x, stat_label: e.target.value.slice(0, 80) } : x)))
                }
                placeholder="businesses served"
              />
              <button
                type="button"
                className="bs-iconbtn danger"
                onClick={() => onChange(items.filter((x) => x.id !== s.id))}
                aria-label="Remove"
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          ))}
        </div>
      </InspGroup>
    </div>
  )
}

function InspectorFeatures({
  features,
  onChange,
}: {
  features: SalesFeature[]
  onChange: (v: SalesFeature[]) => void
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="check" title="What's included" sub="Repeatable feature blocks" />
      <InspGroup
        label="Features"
        action={
          <button
            type="button"
            className="bs-link"
            onClick={() => onChange([...features, { id: genId(), icon: '✨', title: '', body: '' }])}
          >
            <Icon name="plus" size={11} /> Add feature
          </button>
        }
      >
        <div className="ss-rows">
          {features.length === 0 && (
            <div className="bs-empty-state">
              <Icon name="check" size={18} />
              <div>No features yet</div>
            </div>
          )}
          {features.map((f) => (
            <div key={f.id} className="ss-featurerow">
              <input
                className="ss-feature-icon"
                value={f.icon}
                onChange={(e) =>
                  onChange(features.map((x) => (x.id === f.id ? { ...x, icon: e.target.value.slice(0, 8) } : x)))
                }
                placeholder="✨"
              />
              <div className="ss-feature-body">
                <input
                  className="ss-feature-title"
                  value={f.title}
                  onChange={(e) =>
                    onChange(features.map((x) => (x.id === f.id ? { ...x, title: e.target.value.slice(0, 120) } : x)))
                  }
                  placeholder="Feature title"
                />
                <textarea
                  rows={2}
                  className="ss-feature-text"
                  value={f.body}
                  onChange={(e) =>
                    onChange(features.map((x) => (x.id === f.id ? { ...x, body: e.target.value.slice(0, 500) } : x)))
                  }
                  placeholder="One-line description"
                />
              </div>
              <button
                type="button"
                className="bs-iconbtn danger"
                onClick={() => onChange(features.filter((x) => x.id !== f.id))}
                aria-label="Remove"
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          ))}
        </div>
      </InspGroup>
    </div>
  )
}

function InspectorBenefits({
  benefits,
  onChange,
}: {
  benefits: SalesBenefit[]
  onChange: (v: SalesBenefit[]) => void
}) {
  const [draft, setDraft] = useState('')
  function add() {
    const v = draft.trim()
    if (!v) return
    onChange([...benefits, { id: genId(), text: v.slice(0, 200) }])
    setDraft('')
  }
  return (
    <div className="bs-insp">
      <InspectorHead icon="list" title="Benefits" sub="One-line bullets" />
      <InspGroup label="Bullets">
        <div className="ss-rows">
          {benefits.map((b) => (
            <div key={b.id} className="ss-benefitrow">
              <Icon name="check" size={11} color="var(--bs-green)" />
              <input
                className="bs-input sm"
                value={b.text}
                onChange={(e) =>
                  onChange(
                    benefits.map((x) =>
                      x.id === b.id ? { ...x, text: e.target.value.slice(0, 200) } : x,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="bs-iconbtn danger"
                onClick={() => onChange(benefits.filter((x) => x.id !== b.id))}
                aria-label="Remove"
              >
                <Icon name="x" size={11} />
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input
            className="bs-input sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
            placeholder="Type a benefit and press Enter…"
          />
          <button type="button" className="bs-btn sm" onClick={add}>
            <Icon name="plus" size={11} /> Add
          </button>
        </div>
      </InspGroup>
    </div>
  )
}

function InspectorTestimonials({
  pageId,
  testimonials,
  onChange,
}: {
  pageId: string
  testimonials: SalesTestimonial[]
  onChange: (v: SalesTestimonial[]) => void
}) {
  const [uploadingId, setUploadingId] = useState<string | null>(null)

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
      onChange(testimonials.map((t) => (t.id === id ? { ...t, avatar_url: url } : t)))
    } finally {
      setUploadingId(null)
    }
  }

  return (
    <div className="bs-insp">
      <InspectorHead icon="message" title="Testimonials" sub="Quotes from past customers" />
      <InspGroup
        label="Quotes"
        action={
          <button
            type="button"
            className="bs-link"
            onClick={() =>
              onChange([
                ...testimonials,
                { id: genId(), author: '', role: '', avatar_url: null, quote: '' },
              ])
            }
          >
            <Icon name="plus" size={11} /> Add
          </button>
        }
      >
        <div className="ss-rows">
          {testimonials.map((t) => (
            <div key={t.id} className="ss-testimonialrow">
              <div className="ss-testimonial-head">
                <label className="ss-avatar">
                  {t.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.avatar_url} alt="" />
                  ) : (
                    <Icon name="image" size={11} />
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) uploadAvatar(t.id, file)
                      e.target.value = ''
                    }}
                  />
                </label>
                <input
                  className="bs-input sm"
                  value={t.author}
                  onChange={(e) =>
                    onChange(
                      testimonials.map((x) =>
                        x.id === t.id ? { ...x, author: e.target.value.slice(0, 120) } : x,
                      ),
                    )
                  }
                  placeholder="Author name"
                />
                <button
                  type="button"
                  className="bs-iconbtn danger"
                  onClick={() => onChange(testimonials.filter((x) => x.id !== t.id))}
                  aria-label="Remove"
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
              <input
                className="bs-input sm"
                value={t.role ?? ''}
                onChange={(e) =>
                  onChange(
                    testimonials.map((x) =>
                      x.id === t.id ? { ...x, role: e.target.value.slice(0, 120) } : x,
                    ),
                  )
                }
                placeholder="Role / company (optional)"
                style={{ marginTop: 6 }}
              />
              <textarea
                rows={3}
                className="bs-textarea"
                value={t.quote}
                onChange={(e) =>
                  onChange(
                    testimonials.map((x) =>
                      x.id === t.id ? { ...x, quote: e.target.value.slice(0, 800) } : x,
                    ),
                  )
                }
                placeholder="“This changed how I…”"
                style={{ marginTop: 6 }}
              />
              {uploadingId === t.id && <div className="ss-counter">Uploading…</div>}
            </div>
          ))}
        </div>
      </InspGroup>
    </div>
  )
}

function InspectorFaqs({
  faqs,
  onChange,
}: {
  faqs: SalesFaq[]
  onChange: (v: SalesFaq[]) => void
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="info" title="FAQs" sub="Common questions, answered upfront" />
      <InspGroup
        label="Questions"
        action={
          <button
            type="button"
            className="bs-link"
            onClick={() => onChange([...faqs, { id: genId(), question: '', answer: '' }])}
          >
            <Icon name="plus" size={11} /> Add
          </button>
        }
      >
        <div className="ss-rows">
          {faqs.map((f) => (
            <div key={f.id} className="ss-faqrow">
              <div className="ss-faqrow-head">
                <input
                  className="bs-input sm"
                  value={f.question}
                  onChange={(e) =>
                    onChange(
                      faqs.map((x) => (x.id === f.id ? { ...x, question: e.target.value.slice(0, 200) } : x)),
                    )
                  }
                  placeholder="Question"
                />
                <button
                  type="button"
                  className="bs-iconbtn danger"
                  onClick={() => onChange(faqs.filter((x) => x.id !== f.id))}
                  aria-label="Remove"
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
              <textarea
                rows={2}
                className="bs-textarea"
                value={f.answer}
                onChange={(e) =>
                  onChange(
                    faqs.map((x) => (x.id === f.id ? { ...x, answer: e.target.value.slice(0, 2000) } : x)),
                  )
                }
                placeholder="Answer"
                style={{ marginTop: 6 }}
              />
            </div>
          ))}
        </div>
      </InspGroup>
    </div>
  )
}

function InspectorGuarantee({
  guarantee,
  patchGuarantee,
}: {
  guarantee: SalesConfig['guarantee']
  patchGuarantee: (p: Partial<SalesConfig['guarantee']>) => void
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="check" title="Guarantee" sub="A risk-reversal box" />
      <InspGroup>
        <label className="bs-check">
          <input
            type="checkbox"
            checked={guarantee.enabled}
            onChange={(e) => patchGuarantee({ enabled: e.target.checked })}
          />
          Show guarantee box
        </label>
      </InspGroup>
      <InspGroup label="Title">
        <input
          className="bs-input"
          value={guarantee.title}
          onChange={(e) => patchGuarantee({ title: e.target.value.slice(0, 120) })}
          placeholder="e.g. 14-day money-back guarantee"
          disabled={!guarantee.enabled}
        />
      </InspGroup>
      <InspGroup label="Body">
        <textarea
          className="bs-textarea"
          rows={3}
          value={guarantee.body}
          onChange={(e) => patchGuarantee({ body: e.target.value.slice(0, 800) })}
          placeholder="Short body text explaining the guarantee."
          disabled={!guarantee.enabled}
        />
        <div className="ss-counter">{guarantee.body.length}/800</div>
      </InspGroup>
    </div>
  )
}

function InspectorDelivery({
  delivery,
  patchDelivery,
}: {
  delivery: SalesConfig['delivery']
  patchDelivery: (p: Partial<SalesConfig['delivery']>) => void
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="folder" title="Delivery" sub="How customers get what they bought" />
      <InspGroup label="Method">
        <div className="ss-tilegrid">
          {DELIVERY_TILES.map((t) => {
            const active = delivery.type === t.value
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => patchDelivery({ type: t.value })}
                className={`ss-tile ${active ? 'on' : ''}`}
              >
                <span className="ss-tile-icon">{t.icon}</span>
                <span className="ss-tile-label">{t.label}</span>
                <span className="ss-tile-hint">{t.hint}</span>
              </button>
            )
          })}
        </div>
      </InspGroup>
      <InspGroup label="Notes">
        <textarea
          className="bs-textarea"
          rows={3}
          value={delivery.notes}
          onChange={(e) => patchDelivery({ notes: e.target.value.slice(0, 1000) })}
          placeholder="e.g. Access link sent within 5 minutes."
        />
      </InspGroup>
    </div>
  )
}

function InspectorCta({
  cta,
  accent,
  patchCta,
  ctaLabelInitial,
}: {
  cta: SalesConfig['cta']
  accent: string
  patchCta: (p: Partial<SalesConfig['cta']>) => void
  ctaLabelInitial: string
}) {
  const [messengerCta, setMessengerCta] = useState(ctaLabelInitial)
  return (
    <div className="bs-insp">
      <InspectorHead icon="arrowRight" title="Call to action" sub="The buy buttons" />
      <InspGroup label="Preview">
        <div className="ss-cta-preview" style={{ background: '#f5ecdf' }}>
          <button
            type="button"
            className="ss-cta-primary"
            style={{ background: accent, color: '#fbf2e2' }}
          >
            {cta.primary_label || 'Get it now'} →
          </button>
          {cta.secondary_label && (
            <button type="button" className="ss-cta-secondary">
              {cta.secondary_label}
            </button>
          )}
        </div>
      </InspGroup>
      <InspGroup>
        <Field label="Primary label">
          <input
            className="bs-input"
            value={cta.primary_label}
            onChange={(e) => patchCta({ primary_label: e.target.value.slice(0, 60) })}
            maxLength={60}
            placeholder="Get it now"
          />
          <div className="ss-counter">{cta.primary_label.length}/60</div>
        </Field>
        <Field
          label={
            <>
              Secondary label <span style={{ color: 'var(--bs-ink-4)' }}>· optional</span>
            </>
          }
          hint="Leave empty to hide."
        >
          <input
            className="bs-input"
            value={cta.secondary_label}
            onChange={(e) => patchCta({ secondary_label: e.target.value.slice(0, 60) })}
            maxLength={60}
            placeholder="Learn more"
          />
        </Field>
      </InspGroup>
      <InspGroup label="Messenger button label">
        <input
          name="cta_label"
          className="bs-input"
          value={messengerCta}
          onChange={(e) => setMessengerCta(e.target.value.slice(0, 50))}
          maxLength={50}
          placeholder="Buy now"
        />
        <div className="bs-field-hint">
          Used when the bot sends this page in Messenger. ({messengerCta.length}/50)
        </div>
      </InspGroup>
    </div>
  )
}

function InspectorPaymentWrap({
  payment,
  setPayment,
  paymentMethods,
}: {
  payment: SalesConfig['payment']
  setPayment: (p: PaymentSettings) => void
  paymentMethods: PaymentMethod[]
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="bolt" title="Payment" sub="Methods customers can use" />
      <div className="ss-payment-wrap">
        <PaymentSettingsPanel
          value={payment ?? { enabled: true, excluded_method_ids: [] }}
          onChange={setPayment}
          paymentMethods={paymentMethods}
        />
      </div>
    </div>
  )
}

function InspectorLinkedPages({
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

  return (
    <div className="bs-insp">
      <InspectorHead icon="link" title="Linked pages" sub="Action pages chained after the buy" />
      {loading && (
        <div className="bs-group">
          <p className="bs-help">Loading…</p>
        </div>
      )}
      {error && (
        <div className="bs-group">
          <p className="bs-help" style={{ color: 'var(--bs-danger)' }}>
            {error}
          </p>
        </div>
      )}
      <InspGroup label={<>Attached <span style={{ color: 'var(--bs-ink-4)' }}>· {linked.length}</span></>}>
        {linked.length === 0 && (
          <div className="bs-empty-state">
            <Icon name="link" size={18} />
            <div>None attached</div>
          </div>
        )}
        <div className="ss-rows">
          {linked.map((p) => (
            <div key={p.id} className="ss-linkrow on">
              <span className="bs-pill">{p.kind}</span>
              <div className="ss-link-meta">
                <div className="ss-link-title">{p.title}</div>
                <div className="ss-link-slug mono">/a/{p.slug}</div>
              </div>
              <button
                type="button"
                className="bs-link"
                onClick={() => onChange(linkedIds.filter((x) => x !== p.id))}
                style={{ color: 'var(--bs-danger)' }}
              >
                Detach
              </button>
            </div>
          ))}
        </div>
      </InspGroup>
      <InspGroup label="Available to attach">
        {available.length === 0 ? (
          <p className="bs-help">No more pages to attach.</p>
        ) : (
          <div className="ss-rows">
            {available.map((p) => (
              <div key={p.id} className="ss-linkrow">
                <span className="bs-pill">{p.kind}</span>
                <div className="ss-link-meta">
                  <div className="ss-link-title">{p.title}</div>
                  <div className="ss-link-slug mono">/a/{p.slug}</div>
                </div>
                <button
                  type="button"
                  className="bs-btn sm"
                  onClick={() => onChange([...linkedIds, p.id])}
                >
                  <Icon name="plus" size={11} /> Attach
                </button>
              </div>
            ))}
          </div>
        )}
      </InspGroup>
    </div>
  )
}

function InspectorFallback({
  fallback,
  patchFallback,
  hasLinked,
}: {
  fallback: SalesConfig['fallback_form']
  patchFallback: (p: Partial<SalesConfig['fallback_form']>) => void
  hasLinked: boolean
}) {
  function updateField(key: FallbackFieldKey, patch: Partial<SalesFallbackField>) {
    patchFallback({
      fields: fallback.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)),
    })
  }
  return (
    <div className="bs-insp">
      <InspectorHead icon="form" title="Default form" sub="Fallback when no linked pages" />
      {hasLinked && (
        <div className="ss-warn">
          <Icon name="info" size={12} />
          <span>You have action pages linked above. This form only shows as a fallback.</span>
        </div>
      )}
      <InspGroup label="Enabled">
        <label className="bs-check">
          <input
            type="checkbox"
            checked={fallback.enabled}
            onChange={(e) => patchFallback({ enabled: e.target.checked })}
          />
          Show fallback form
        </label>
      </InspGroup>
      <InspGroup label="Built-in fields">
        <div className="ss-rows">
          {FALLBACK_FIELD_KEYS.map((key) => {
            const field = fallback.fields.find((f) => f.key === key)
            if (!field) return null
            return (
              <div key={key} className={`ss-fallbackrow ${field.enabled ? '' : 'off'}`}>
                <label className="bs-check">
                  <input
                    type="checkbox"
                    checked={field.enabled}
                    onChange={(e) => updateField(key, { enabled: e.target.checked })}
                  />
                </label>
                <input
                  className="bs-input sm"
                  value={field.label}
                  onChange={(e) => updateField(key, { label: e.target.value.slice(0, 80) })}
                  disabled={!field.enabled}
                />
                <label className="bs-check">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => updateField(key, { required: e.target.checked })}
                    disabled={!field.enabled}
                  />
                  req
                </label>
              </div>
            )
          })}
        </div>
      </InspGroup>
      <InspGroup>
        <Field label="Submit button">
          <input
            className="bs-input"
            value={fallback.submit_button_label}
            onChange={(e) => patchFallback({ submit_button_label: e.target.value.slice(0, 40) })}
          />
        </Field>
        <Field label="Success message">
          <textarea
            className="bs-textarea"
            rows={2}
            value={fallback.success_message}
            onChange={(e) => patchFallback({ success_message: e.target.value.slice(0, 400) })}
          />
        </Field>
      </InspGroup>
    </div>
  )
}

function InspectorPipeline({
  page,
  stages,
}: {
  page: ActionPageRow
  stages: PipelineStageOption[]
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="pipeline" title="Pipeline" sub="Where leads land on purchase" />
      <InspGroup label={<><Icon name="branch" size={11} /> Stage moves on each outcome</>}>
        <PipelineRulesEditor
          initial={page.pipeline_rules}
          stages={stages}
          kind={page.kind}
        />
      </InspGroup>
    </div>
  )
}

function InspectorConversion({ defaultValue }: { defaultValue: string }) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="target" title="Conversion event" sub="Tell Meta a purchase happened" />
      <InspGroup label="CAPI event">
        <select
          name="capi_event_name_override"
          defaultValue={defaultValue}
          className="bs-select"
        >
          <option value="">Use default (InitiateCheckout / Purchase)</option>
          {CAPI_EVENT_OPTIONS.map((ev) => (
            <option key={ev} value={ev}>
              {ev === 'SKIP' ? "Don't send" : ev}
            </option>
          ))}
        </select>
        <span className="bs-field-hint">Which Meta CAPI event fires when a sale is received.</span>
      </InspGroup>
    </div>
  )
}

function InspectorEcho({ page }: { page: ActionPageRow }) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="message" title="Messenger echo" sub="Auto-reply right after purchase" />
      <div className="bs-group">
        <EchoTemplateField
          name="notification_text"
          kind={page.kind}
          customKeys={extractCustomKeysFromConfig(page.kind, page.config)}
          defaultValue={page.notification_template?.text ?? ''}
          rows={3}
          placeholder="Thanks! Your order is in. Payment instructions sent via Messenger."
        />
        <label className="bs-check" style={{ marginTop: 10 }}>
          <input
            type="checkbox"
            name="echo_payment_proof"
            defaultChecked={page.notification_template?.echo_payment_proof !== false}
          />
          Also re-echo the uploaded payment screenshot in Messenger
        </label>
      </div>
    </div>
  )
}

function InspectorShare({
  publicUrl,
  embedUrl,
  embedSnippet,
  supportsEmbed,
}: {
  publicUrl: string
  embedUrl: string
  embedSnippet: string
  supportsEmbed: boolean
}) {
  return (
    <div className="bs-insp">
      <InspectorHead icon="share" title="Share & embed" sub="How the page reaches buyers" />
      <InspGroup label="Public URL">
        <CopyField value={publicUrl} label="Public URL" />
      </InspGroup>
      {supportsEmbed && (
        <>
          <InspGroup label="Embed URL">
            <CopyField value={embedUrl} label="Embed URL" />
          </InspGroup>
          <InspGroup label="Embed snippet">
            <CopyField value={embedSnippet} label="Embed snippet" />
          </InspGroup>
        </>
      )}
    </div>
  )
}

// ─── Icons ───────────────────────────────────────────────────────────

type IconName =
  | 'grip' | 'plus' | 'x' | 'check' | 'chevDown' | 'chevRight' | 'chevLeft'
  | 'arrowRight' | 'eye' | 'settings' | 'sliders' | 'cal' | 'clock' | 'form'
  | 'pipeline' | 'message' | 'target' | 'share' | 'sparkle' | 'bolt' | 'bot'
  | 'layers' | 'list' | 'image' | 'phone' | 'branch' | 'info' | 'folder'
  | 'text' | 'link' | 'mail' | 'user'

function Icon({
  name,
  size = 14,
  color = 'currentColor',
}: {
  name: IconName
  size?: number
  color?: string
}) {
  const p: Record<IconName, ReactNode> = {
    grip: (<g><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" /></g>),
    plus: (<path d="M12 5v14M5 12h14" />),
    x: (<path d="M6 6l12 12M18 6L6 18" />),
    check: (<path d="M5 12.5l4.5 4.5L19 7" />),
    chevDown: (<path d="M6 9l6 6 6-6" />),
    chevRight: (<path d="M9 6l6 6-6 6" />),
    chevLeft: (<path d="M15 6l-6 6 6 6" />),
    arrowRight: (<path d="M5 12h14m-6-6l6 6-6 6" />),
    eye: (<g><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></g>),
    settings: (<g><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14 3h-4l-.6 2.6a7 7 0 00-2 1.2L5 6l-2 3.4 2 1.5a7 7 0 000 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 002 1.2L10 21h4l.6-2.6a7 7 0 002-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" /></g>),
    sliders: (<g><path d="M4 8h6M14 8h6M4 16h10M18 16h2" /><circle cx="12" cy="8" r="2" /><circle cx="16" cy="16" r="2" /></g>),
    cal: (<g><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></g>),
    clock: (<g><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></g>),
    form: (<g><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 8h10M7 12h10M7 16h6" /></g>),
    pipeline: (<g><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="12" r="2" /><path d="M8 6h4a4 4 0 014 4v0M8 18h4a4 4 0 004-4v0" /></g>),
    message: (<path d="M21 12a8 8 0 01-12 7l-5 1 1.5-4.5A8 8 0 1121 12z" />),
    target: (<g><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></g>),
    share: (<g><circle cx="6" cy="12" r="3" /><circle cx="18" cy="5" r="3" /><circle cx="18" cy="19" r="3" /><path d="M9 11l6-4M9 13l6 4" /></g>),
    sparkle: (<g><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /><path d="M19 14l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" /></g>),
    bolt: (<path d="M13 3L4 14h7l-1 7 9-11h-7l1-7z" />),
    bot: (<g><rect x="4" y="8" width="16" height="12" rx="3" /><circle cx="9" cy="14" r="1.2" /><circle cx="15" cy="14" r="1.2" /><path d="M12 3v5M9 20v2M15 20v2" /></g>),
    layers: (<path d="M12 3l9 5-9 5-9-5 9-5zm-9 9l9 5 9-5M3 17l9 5 9-5" />),
    list: (<g><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1" /><circle cx="3.5" cy="12" r="1" /><circle cx="3.5" cy="18" r="1" /></g>),
    image: (<g><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M3 17l5-5 4 4 3-3 6 6" /></g>),
    phone: (<path d="M5 4h3l2 5-2 1c1 3 3 5 6 6l1-2 5 2v3a2 2 0 01-2 2A17 17 0 013 6a2 2 0 012-2z" />),
    branch: (<g><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M6 8v8M6 12c0-3.3 2.7-6 6-6h2" /></g>),
    info: (<g><circle cx="12" cy="12" r="9" /><path d="M12 8v0M12 11v6" /></g>),
    folder: (<path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V6z" />),
    text: (<path d="M5 6h14M5 12h14M5 18h8" />),
    link: (<g><path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1" /><path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" /></g>),
    mail: (<g><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></g>),
    user: (<g><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></g>),
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden
    >
      {p[name]}
    </svg>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────

function SalesStudioStyles() {
  return (
    <style>{`
/* Hide app chrome while sales studio is mounted */
body[data-sales-studio] .ws-sidebar { display: none !important; }
body[data-sales-studio] .ws-topbar { display: none !important; }
body[data-sales-studio] .ws-main { padding: 0 !important; }

[data-sales-studio] {
  --bs-bg:#fdfaf3;--bs-bg-2:#f5ecdf;--bs-bg-3:#ebe1cd;
  --bs-paper:#fbf6ee;--bs-paper-2:#f7eedb;
  --bs-ink:#231a14;--bs-ink-2:#3d3929;--bs-ink-3:#6e695b;--bs-ink-4:#a59f8e;--bs-ink-5:#c7c1ad;
  --bs-border:#e6dcc8;--bs-border-strong:#d6c8aa;--bs-border-soft:#efe7d3;
  --bs-accent:#a04e3e;--bs-accent-2:#8a3f2f;--bs-accent-soft:#f5e7dc;--bs-accent-ghost:rgba(160,78,62,0.10);
  --bs-green:#5a8c5e;--bs-green-soft:#e4ede0;--bs-amber:#b8860b;--bs-amber-soft:#f5eed4;
  --bs-danger:#b85450;
  --bs-shadow-1:0 1px 2px rgba(60,50,30,.06);
  --bs-shadow-2:0 1px 3px rgba(60,50,30,.07),0 6px 18px rgba(60,50,30,.06);
  font-family:'Inter',ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  color:var(--bs-ink);background:var(--bs-bg);font-size:13px;line-height:1.45;letter-spacing:-.005em;
  -webkit-font-smoothing:antialiased;
  display:flex;flex-direction:column;min-height:calc(100vh - 32px);
}
[data-sales-studio] * { box-sizing:border-box; }
[data-sales-studio] .bs-form { display:flex; flex-direction:column; flex:1; min-height:0; }
[data-sales-studio] button { font:inherit; color:inherit; cursor:pointer; border:0; background:0; padding:0; }
[data-sales-studio] input, [data-sales-studio] textarea, [data-sales-studio] select { font:inherit; color:inherit; }
[data-sales-studio] .mono { font-family: ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace; }

/* TOP BAR */
[data-sales-studio] .bs-topbar {
  display:flex; align-items:center; gap:10px; height:48px;
  padding:0 14px; background:var(--bs-paper-2);
  border-bottom:1px solid var(--bs-border);
  flex-wrap:wrap;
}
[data-sales-studio] .bs-back {
  display:inline-flex; align-items:center; gap:4px;
  text-decoration:none; color:var(--bs-ink-3); font-weight:500; font-size:12.5px;
  padding:5px 8px 5px 4px; border-radius:6px;
}
[data-sales-studio] .bs-back:hover { background:var(--bs-bg-2); color:var(--bs-ink); }
[data-sales-studio] .bs-sep { color:var(--bs-ink-5); }
[data-sales-studio] .bs-crumbs { display:flex; align-items:center; gap:5px; font-size:12.5px; color:var(--bs-ink-3); }
[data-sales-studio] .bs-crumb-muted { color:var(--bs-ink-3); }
[data-sales-studio] .bs-crumb-cur { color:var(--bs-ink); font-weight:500; }
[data-sales-studio] .bs-spacer { flex:1; }
[data-sales-studio] .bs-pill {
  display:inline-flex; align-items:center; gap:5px;
  height:20px; padding:0 8px; border-radius:10px;
  background:var(--bs-bg-2); color:var(--bs-ink-3);
  font-size:11px; font-weight:500;
  border:1px solid var(--bs-border);
  margin-left:6px;
}
[data-sales-studio] .bs-pill .bs-pill-dot { width:6px; height:6px; border-radius:3px; background:var(--bs-ink-4); }
[data-sales-studio] .bs-pill.live { background:var(--bs-green-soft); color:#2f5a35; border-color:#c6d4bc; }
[data-sales-studio] .bs-pill.live .bs-pill-dot { background:var(--bs-green); }
[data-sales-studio] .bs-pill.draft { background:var(--bs-amber-soft); color:#7a5b07; border-color:#e3d29a; }
[data-sales-studio] .bs-pill.draft .bs-pill-dot { background:var(--bs-amber); }
[data-sales-studio] .bs-pill.accent { background:var(--bs-accent-soft); color:var(--bs-accent-2); border-color:#ecd4c6; height:16px; padding:0 6px; font-size:10px; }

/* BUTTONS */
[data-sales-studio] .bs-btn {
  display:inline-flex; align-items:center; gap:5px;
  height:28px; padding:0 10px; border-radius:6px;
  font-size:12.5px; font-weight:500;
  background:var(--bs-paper); border:1px solid var(--bs-border-strong);
  color:var(--bs-ink); box-shadow:var(--bs-shadow-1);
  text-decoration:none;
}
[data-sales-studio] .bs-btn:hover { background:var(--bs-bg-2); }
[data-sales-studio] .bs-btn.sm { height:24px; padding:0 8px; font-size:12px; }
[data-sales-studio] .bs-btn-ghost { background:transparent; border-color:transparent; box-shadow:none; color:var(--bs-ink-2); }
[data-sales-studio] .bs-btn-ghost:hover { background:var(--bs-bg-2); }
[data-sales-studio] .bs-btn-primary { background:var(--bs-accent); color:#fff; border-color:var(--bs-accent-2); }
[data-sales-studio] .bs-btn-primary:hover { background:var(--bs-accent-2); }
[data-sales-studio] .bs-btn-primary:disabled { opacity:.7; cursor:not-allowed; }
[data-sales-studio] .bs-btn-danger { background:var(--bs-paper); color:var(--bs-danger); border-color:#e8c9c7; }
[data-sales-studio] .bs-btn-danger:hover { background:#faf0f0; }

/* BANNER */
[data-sales-studio] .bs-banner { margin:10px 14px 0; padding:8px 12px; border-radius:6px; font-size:12.5px; }
[data-sales-studio] .bs-banner.success { background:var(--bs-green-soft); color:#2f5a35; border:1px solid #c6d4bc; }
[data-sales-studio] .bs-banner.error { background:#faecea; color:#8a3a36; border:1px solid #e8c9c7; }

/* OFFER BAR */
[data-sales-studio] .ss-offerbar {
  display:flex; align-items:center; gap:16px; padding:0 16px; height:60px;
  background: linear-gradient(180deg, #fbf6ee, var(--bs-paper-2));
  border-bottom:1px solid var(--bs-border);
}
[data-sales-studio] .ss-offerbar-id { display:flex; align-items:center; gap:11px; min-width:0; }
[data-sales-studio] .ss-offerbar-icon {
  width:38px; height:38px; border-radius:9px; flex-shrink:0;
  background: linear-gradient(135deg, var(--bs-accent), #6e4a37);
  display:flex; align-items:center; justify-content:center; color:#fbf2e2;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.12);
}
[data-sales-studio] .ss-offerbar-id-meta { min-width:0; }
[data-sales-studio] .ss-offerbar-name { display:flex; align-items:center; gap:6px; }
[data-sales-studio] .ss-offerbar-name > span:first-child {
  font-size:13.5px; font-weight:600; letter-spacing:-.2px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:240px;
}
[data-sales-studio] .ss-offerbar-name .bs-pill { margin-left:0; height:16px; font-size:10px; padding:0 6px; text-transform:capitalize; }
[data-sales-studio] .ss-offerbar-sub { font-size:11px; color:var(--bs-ink-4); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:260px; }
[data-sales-studio] .ss-offerbar-price {
  display:flex; align-items:baseline; gap:8px; padding-left:16px;
  border-left:1px solid var(--bs-border); height:36px;
}
[data-sales-studio] .ss-offerbar-price-main { font-size:22px; font-weight:700; letter-spacing:-.5px; color:var(--bs-accent); line-height:1; }
[data-sales-studio] .ss-offerbar-price-was { font-size:13px; color:var(--bs-ink-4); text-decoration:line-through; }
[data-sales-studio] .ss-offerbar-price-period { font-size:11px; color:var(--bs-ink-4); }

/* 3-PANE SHELL */
[data-sales-studio] .bs-shell {
  display:grid; grid-template-columns:264px 1fr 360px;
  flex:1; min-height:0;
}
[data-sales-studio] .bs-pane { min-height:0; display:flex; flex-direction:column; overflow:hidden; }
[data-sales-studio] .bs-left { background:var(--bs-bg-2); border-right:1px solid var(--bs-border); overflow-y:auto; }
[data-sales-studio] .bs-center { background:var(--bs-bg); }
[data-sales-studio] .bs-right { background:var(--bs-paper-2); border-left:1px solid var(--bs-border); overflow-y:auto; }

/* LEFT PANE */
[data-sales-studio] .bs-section { padding:14px; border-bottom:1px solid var(--bs-border-soft); }
[data-sales-studio] .bs-seclabel {
  display:flex; align-items:center; justify-content:space-between;
  font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.7px;
  color:var(--bs-ink-3); margin-bottom:8px;
}
[data-sales-studio] .bs-seclabel.mt { margin-top:14px; }
[data-sales-studio] .bs-seclabel > span:first-child { display:inline-flex; align-items:center; gap:6px; }
[data-sales-studio] .bs-trigger-box { background:var(--bs-paper); border:1px solid var(--bs-border); border-radius:8px; padding:8px 10px; }
[data-sales-studio] .bs-trigger-help { font-size:11px; color:var(--bs-ink-4); margin-bottom:6px; }
[data-sales-studio] .bs-trigger-textarea {
  width:100%; min-height:60px; resize:vertical;
  background:var(--bs-accent-ghost); border:1px dashed #e5c8b8;
  border-radius:5px; padding:7px 9px;
  font-size:12.5px; line-height:1.45; color:var(--bs-ink);
  font-family:inherit;
}
[data-sales-studio] .bs-trigger-textarea:focus { outline:none; border-color:var(--bs-accent); }

[data-sales-studio] .bs-rows { display:flex; flex-direction:column; gap:1px; }
[data-sales-studio] .bs-row {
  display:flex; align-items:center; gap:8px;
  padding:7px 8px; border-radius:6px; position:relative;
  background:transparent; text-align:left; width:100%;
}
[data-sales-studio] .bs-row:hover { background:rgba(60,50,30,.04); }
[data-sales-studio] .bs-row.sel {
  background:var(--bs-paper);
  box-shadow:var(--bs-shadow-1), 0 0 0 1px var(--bs-border);
}
[data-sales-studio] .bs-row .bs-row-rail {
  position:absolute; left:-14px; top:6px; bottom:6px; width:2px;
  background:transparent; border-radius:2px;
}
[data-sales-studio] .bs-row.sel .bs-row-rail { background:var(--bs-accent); }
[data-sales-studio] .bs-row-meta { flex:1; min-width:0; }
[data-sales-studio] .bs-row-label { display:block; font-size:12.5px; font-weight:500; color:var(--bs-ink); line-height:1.2; }
[data-sales-studio] .bs-row.sel .bs-row-label { font-weight:600; }
[data-sales-studio] .bs-row-sub { display:block; font-size:11px; color:var(--bs-ink-4); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

/* FUNNEL STAGES */
[data-sales-studio] .ss-funnel-stage { margin-bottom:12px; }
[data-sales-studio] .ss-funnel-head { display:flex; align-items:center; gap:7px; padding:0 2px 5px; }
[data-sales-studio] .ss-funnel-num {
  width:16px; height:16px; border-radius:4px; flex-shrink:0;
  background:var(--bs-accent); color:#fbf2e2;
  display:inline-flex; align-items:center; justify-content:center;
  font-size:10px; font-weight:700;
}
[data-sales-studio] .ss-funnel-name { font-size:11.5px; font-weight:600; color:var(--bs-ink); }
[data-sales-studio] .ss-funnel-goal { font-size:10.5px; color:var(--bs-ink-4); }
[data-sales-studio] .ss-funnel-rows {
  display:flex; flex-direction:column; gap:1px;
  margin-left:7px; padding-left:11px; border-left:1.5px solid var(--bs-border);
}

/* CONVERSION CHECKLIST */
[data-sales-studio] .ss-checklist { padding:10px 14px; border-top:1px solid var(--bs-border-soft); background:var(--bs-bg-3); }
[data-sales-studio] .ss-checklist-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:7px;
  font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.6px; color:var(--bs-ink-3);
}
[data-sales-studio] .ss-checklist-head > span:first-child { display:inline-flex; align-items:center; gap:5px; }
[data-sales-studio] .ss-checklist-count { font-weight:600; }
[data-sales-studio] .ss-checklist-item { display:flex; align-items:center; gap:7px; padding:2px 0; }
[data-sales-studio] .ss-checklist-dot {
  width:13px; height:13px; border-radius:7px; flex-shrink:0;
  border:1.5px dashed var(--bs-ink-5);
  display:inline-flex; align-items:center; justify-content:center;
}
[data-sales-studio] .ss-checklist-dot.done { background:var(--bs-green); border:0; }
[data-sales-studio] .ss-checklist-label { font-size:11.5px; color:var(--bs-ink-4); }
[data-sales-studio] .ss-checklist-label.done { color:var(--bs-ink-2); }
[data-sales-studio] .ss-checklist-add { margin-left:auto; font-size:10.5px; color:var(--bs-accent-2); font-weight:500; }

/* CENTER */
[data-sales-studio] .bs-canvas-toolbar {
  display:flex; align-items:center; gap:8px;
  padding:10px 14px; font-size:11.5px; color:var(--bs-ink-4);
  border-bottom:1px solid var(--bs-border-soft);
  background:var(--bs-paper-2);
}
[data-sales-studio] .bs-mute { color:var(--bs-ink-4); }
[data-sales-studio] .ss-canvas {
  flex:1; min-height:0; overflow-y:auto;
  background:var(--bs-bg);
  background-image: radial-gradient(circle at 1px 1px, rgba(60,50,30,.08) 1px, transparent 1px);
  background-size: 20px 20px;
  display:flex; align-items:flex-start; justify-content:center;
  padding: 24px 16px 48px;
}

/* RIGHT PANE / INSPECTOR */
[data-sales-studio] .bs-insp { display:flex; flex-direction:column; }
[data-sales-studio] .bs-insphead {
  display:flex; align-items:flex-start; gap:10px;
  padding:14px 16px; border-bottom:1px solid var(--bs-border-soft);
  background:var(--bs-paper);
}
[data-sales-studio] .bs-insphead-icon {
  width:28px; height:28px; border-radius:7px;
  background:var(--bs-accent-soft); color:var(--bs-accent-2);
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
}
[data-sales-studio] .bs-insphead-title { font-size:13.5px; font-weight:600; letter-spacing:-.1px; }
[data-sales-studio] .bs-insphead-sub { font-size:11.5px; color:var(--bs-ink-4); margin-top:1px; }
[data-sales-studio] .bs-group { padding:12px 16px; border-bottom:1px solid var(--bs-border-soft); }
[data-sales-studio] .bs-field { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; }
[data-sales-studio] .bs-field:last-child { margin-bottom:0; }
[data-sales-studio] .bs-field-label { font-size:11.5px; font-weight:500; color:var(--bs-ink-2); }
[data-sales-studio] .bs-field-hint { font-size:11px; color:var(--bs-ink-4); margin-top:2px; }
[data-sales-studio] .bs-help { font-size:11.5px; color:var(--bs-ink-3); line-height:1.5; margin:0; }
[data-sales-studio] .ss-counter { font-size:10.5px; color:var(--bs-ink-4); margin-top:3px; }

[data-sales-studio] .bs-input, [data-sales-studio] .bs-textarea, [data-sales-studio] .bs-select {
  width:100%; background:var(--bs-paper); border:1px solid var(--bs-border-strong);
  border-radius:5px; padding:6px 8px; font-size:12.5px; color:var(--bs-ink);
  height:28px;
}
[data-sales-studio] .bs-input.sm { height:24px; font-size:12px; }
[data-sales-studio] .bs-textarea { height:auto; min-height:60px; resize:vertical; font-family:inherit; line-height:1.45; }
[data-sales-studio] .bs-select { padding-right:24px; }
[data-sales-studio] .bs-input:focus, [data-sales-studio] .bs-textarea:focus, [data-sales-studio] .bs-select:focus {
  outline:none; border-color:var(--bs-accent); box-shadow:0 0 0 3px var(--bs-accent-ghost);
}
[data-sales-studio] .bs-input.mono { font-family: ui-monospace,Menlo,monospace; }
[data-sales-studio] .bs-input-affix {
  display:flex; align-items:center; background:var(--bs-paper);
  border:1px solid var(--bs-border-strong); border-radius:5px; overflow:hidden;
}
[data-sales-studio] .bs-input-affix .bs-prefix {
  padding:0 8px; font-size:12px; color:var(--bs-ink-4); background:var(--bs-bg-2);
  height:28px; display:inline-flex; align-items:center; border-right:1px solid var(--bs-border-strong);
  font-family: ui-monospace,Menlo,monospace;
}
[data-sales-studio] .bs-input-affix input { flex:1; border:0; padding:0 8px; height:28px; background:transparent; outline:none; font-size:12.5px; }

[data-sales-studio] .bs-segment {
  display:inline-flex; background:var(--bs-bg-2); border-radius:6px; padding:2px; gap:1px;
}
[data-sales-studio] .bs-segbtn {
  height:22px; padding:0 9px; border-radius:5px;
  font-size:11.5px; font-weight:500; color:var(--bs-ink-3);
  display:inline-flex; align-items:center; gap:5px;
}
[data-sales-studio] .bs-segbtn.on { background:var(--bs-paper); color:var(--bs-ink); box-shadow:var(--bs-shadow-1); }
[data-sales-studio] .bs-dot { width:6px; height:6px; border-radius:3px; background:var(--bs-ink-4); }
[data-sales-studio] .bs-dot.draft { background:var(--bs-amber); }
[data-sales-studio] .bs-dot.published { background:var(--bs-green); }
[data-sales-studio] .bs-dot.archived { background:var(--bs-ink-4); }
[data-sales-studio] .bs-link { display:inline-flex; align-items:center; gap:4px; font-size:11.5px; font-weight:500; color:var(--bs-accent-2); background:transparent; }
[data-sales-studio] .bs-link:hover { color:var(--bs-accent); }
[data-sales-studio] .bs-check { display:inline-flex; align-items:center; gap:5px; font-size:11.5px; color:var(--bs-ink-2); cursor:pointer; }
[data-sales-studio] .bs-swatches { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
[data-sales-studio] .bs-swatch { width:22px; height:22px; border-radius:5px; border:0; cursor:pointer; box-shadow:0 0 0 1px rgba(0,0,0,.06); }
[data-sales-studio] .bs-swatch.on { box-shadow:0 0 0 2px var(--bs-paper), 0 0 0 4px var(--bs-accent); }
[data-sales-studio] .bs-color { width:30px; height:24px; border:1px solid var(--bs-border-strong); border-radius:5px; background:var(--bs-paper); padding:0; cursor:pointer; }
[data-sales-studio] .bs-color-row { display:flex; gap:6px; align-items:center; }
[data-sales-studio] .bs-color-row input[type="color"] { width:32px; height:28px; border:1px solid var(--bs-border-strong); border-radius:5px; padding:0; cursor:pointer; background:var(--bs-paper); }
[data-sales-studio] .bs-iconbtn { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:4px; color:var(--bs-ink-4); }
[data-sales-studio] .bs-iconbtn:hover { background:var(--bs-bg-2); color:var(--bs-ink); }
[data-sales-studio] .bs-iconbtn.danger:hover { background:#faecea; color:var(--bs-danger); }
[data-sales-studio] .bs-empty-state {
  display:flex; flex-direction:column; align-items:center; gap:6px;
  padding:20px 12px; border:1px dashed var(--bs-border-strong); border-radius:8px;
  color:var(--bs-ink-4); font-size:12px; text-align:center; background:var(--bs-paper);
}

/* SS-specific row layouts */
[data-sales-studio] .ss-rows { display:flex; flex-direction:column; gap:6px; }
[data-sales-studio] .ss-advanced-toggle {
  display:flex; align-items:center; gap:6px; font-size:12px; color:var(--bs-ink-2); font-weight:500;
  background:transparent;
}

/* Tile grid */
[data-sales-studio] .ss-tilegrid { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
[data-sales-studio] .ss-tile {
  text-align:left; padding:8px 10px; border-radius:7px;
  background:var(--bs-paper); border:1.5px solid var(--bs-border-strong);
  display:flex; flex-direction:column; gap:3px;
}
[data-sales-studio] .ss-tile.on { border-color:var(--bs-accent); box-shadow:0 0 0 3px var(--bs-accent-ghost); }
[data-sales-studio] .ss-tile-icon { font-size:18px; line-height:1; }
[data-sales-studio] .ss-tile-label { font-size:12px; font-weight:600; }
[data-sales-studio] .ss-tile-hint { font-size:10.5px; color:var(--bs-ink-4); }

/* Pricing inspector */
[data-sales-studio] .ss-price-preview {
  background:var(--bs-paper); border-radius:8px; padding:14px 16px; border:1px solid var(--bs-border);
  display:flex; align-items:baseline; gap:10px;
}
[data-sales-studio] .ss-price-main { font-size:24px; font-weight:700; letter-spacing:-.5px; color:var(--bs-accent); }
[data-sales-studio] .ss-price-was { font-size:13px; color:var(--bs-ink-4); text-decoration:line-through; }
[data-sales-studio] .ss-currency-row { display:flex; flex-wrap:wrap; gap:4px; }
[data-sales-studio] .ss-currency-pill {
  display:inline-flex; align-items:center; gap:4px;
  height:26px; padding:0 10px; border-radius:13px;
  background:var(--bs-paper); color:var(--bs-ink-2);
  border:1px solid var(--bs-border-strong);
  font-size:11.5px; font-weight:600;
}
[data-sales-studio] .ss-currency-pill.on { background:var(--bs-ink); color:#fff; border-color:var(--bs-ink); }
[data-sales-studio] .ss-currency-sym { opacity:.6; }
[data-sales-studio] .ss-price-input {
  display:flex; align-items:stretch;
  background:var(--bs-paper); border:1px solid var(--bs-border-strong);
  border-radius:5px; overflow:hidden; height:28px;
}
[data-sales-studio] .ss-price-input-sym {
  display:inline-flex; align-items:center; justify-content:center;
  padding:0 8px; background:var(--bs-bg-2); color:var(--bs-ink-3);
  font-size:12.5px; font-weight:600; font-family:ui-monospace,Menlo,monospace;
  border-right:1px solid var(--bs-border);
}
[data-sales-studio] .ss-price-input input {
  flex:1; border:0; outline:none; padding:0 10px;
  font-size:13px; font-weight:600; color:var(--bs-ink);
  font-family:ui-monospace,Menlo,monospace; background:transparent;
}
[data-sales-studio] .ss-price-input-suf {
  display:inline-flex; align-items:center; padding:0 8px;
  font-size:11px; color:var(--bs-ink-4); font-variant-numeric:tabular-nums;
}

/* Drop zone */
[data-sales-studio] .ss-drop {
  padding:20px; border:2px dashed var(--bs-border-strong); border-radius:8px;
  text-align:center; background:var(--bs-paper);
  display:flex; flex-direction:column; align-items:center; gap:4px; cursor:pointer;
}
[data-sales-studio] .ss-drop.on { border-color:var(--bs-accent); background:var(--bs-accent-ghost); }
[data-sales-studio] .ss-drop-title { font-size:12.5px; font-weight:500; }
[data-sales-studio] .ss-drop-sub { font-size:10.5px; color:var(--bs-ink-4); }
[data-sales-studio] .ss-error { font-size:11.5px; color:var(--bs-danger); margin-top:6px; }

/* Gallery */
[data-sales-studio] .ss-gallery-list { display:flex; flex-direction:column; gap:6px; }
[data-sales-studio] .ss-gallery-item {
  display:grid; grid-template-columns:44px 1fr auto; gap:8px; align-items:center;
  padding:6px; background:var(--bs-paper); border:1px solid var(--bs-border); border-radius:7px;
  position:relative;
}
[data-sales-studio] .ss-gallery-thumb { width:44px; height:32px; border-radius:4px; object-fit:cover; }
[data-sales-studio] .ss-gallery-hero {
  position:absolute; top:-5px; left:-3px; font-size:9px; font-weight:700;
  background:var(--bs-ink); color:#fff; padding:1px 5px; border-radius:2px;
  letter-spacing:.3px; text-transform:uppercase;
}
[data-sales-studio] .ss-gallery-actions { display:inline-flex; align-items:center; gap:6px; }

/* Stat row */
[data-sales-studio] .ss-statrow {
  background:var(--bs-paper); border:1px solid var(--bs-border); border-radius:7px;
  padding:6px 8px; display:grid; grid-template-columns:90px 1fr 24px; gap:6px; align-items:center;
}
[data-sales-studio] .ss-stat-value {
  border:1px solid var(--bs-border-soft); border-radius:4px; padding:4px 6px;
  font-size:14px; font-weight:700; font-family:inherit; outline:none;
  color:var(--bs-accent-2); background:var(--bs-bg); text-align:center;
}

/* Feature row */
[data-sales-studio] .ss-featurerow {
  background:var(--bs-paper); border:1px solid var(--bs-border); border-radius:7px;
  padding:8px; display:grid; grid-template-columns:36px 1fr 24px; gap:6px; align-items:start;
}
[data-sales-studio] .ss-feature-icon {
  width:36px; height:36px; border-radius:6px; background:var(--bs-bg-2);
  border:0; text-align:center; font-size:18px; line-height:1;
}
[data-sales-studio] .ss-feature-body { display:flex; flex-direction:column; gap:4px; min-width:0; }
[data-sales-studio] .ss-feature-title {
  width:100%; border:0; outline:none; font-size:12.5px; font-weight:600; color:var(--bs-ink);
  background:transparent; padding:2px 0;
}
[data-sales-studio] .ss-feature-text {
  width:100%; border:0; outline:none; font-size:11.5px; color:var(--bs-ink-3);
  resize:none; background:transparent; padding:2px 0; line-height:1.4; font-family:inherit;
}

/* Benefit row */
[data-sales-studio] .ss-benefitrow {
  display:flex; align-items:center; gap:6px; padding:4px 6px;
  background:var(--bs-paper); border:1px solid var(--bs-border-soft); border-radius:5px;
}
[data-sales-studio] .ss-benefitrow .bs-input { border:0; background:transparent; padding:0; }

/* Testimonial row */
[data-sales-studio] .ss-testimonialrow {
  background:var(--bs-paper); border:1px solid var(--bs-border); border-radius:7px; padding:10px;
}
[data-sales-studio] .ss-testimonial-head { display:flex; align-items:center; gap:6px; }
[data-sales-studio] .ss-avatar {
  width:28px; height:28px; border-radius:14px; background:var(--bs-bg-2);
  display:inline-flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0;
  color:var(--bs-ink-4); overflow:hidden;
}
[data-sales-studio] .ss-avatar img { width:100%; height:100%; object-fit:cover; }

/* FAQ row */
[data-sales-studio] .ss-faqrow {
  background:var(--bs-paper); border:1px solid var(--bs-border); border-radius:7px; padding:9px;
}
[data-sales-studio] .ss-faqrow-head { display:flex; align-items:center; gap:6px; }

/* CTA preview */
[data-sales-studio] .ss-cta-preview { padding:14px; border-radius:8px; }
[data-sales-studio] .ss-cta-primary {
  width:100%; padding:11px 14px; border-radius:8px;
  font-weight:600; font-size:13px;
}
[data-sales-studio] .ss-cta-secondary {
  width:100%; padding:8px 14px; border-radius:6px; margin-top:6px;
  background:transparent; color:#5a4737; font-weight:500; font-size:12px;
}

/* Payment wrap — neutralize the white card the panel ships with */
[data-sales-studio] .ss-payment-wrap { padding:14px 16px; }
[data-sales-studio] .ss-payment-wrap > section { border:0; padding:0; }

/* Linked pages */
[data-sales-studio] .ss-linkrow {
  display:flex; align-items:center; gap:8px; padding:6px 9px;
  background:var(--bs-bg); border:1px solid var(--bs-border-soft); border-radius:6px;
}
[data-sales-studio] .ss-linkrow.on { background:var(--bs-paper); border-color:var(--bs-border); }
[data-sales-studio] .ss-linkrow .bs-pill { margin-left:0; height:18px; font-size:10px; padding:0 6px; }
[data-sales-studio] .ss-link-meta { flex:1; min-width:0; }
[data-sales-studio] .ss-link-title { font-size:12px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
[data-sales-studio] .ss-link-slug { font-size:10.5px; color:var(--bs-ink-4); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

/* Fallback form rows */
[data-sales-studio] .ss-warn {
  display:flex; gap:6px; align-items:flex-start;
  padding:8px 12px; margin:0 16px; background:var(--bs-amber-soft); border-radius:6px;
  font-size:11px; color:#7a5b07; line-height:1.45;
}
[data-sales-studio] .ss-fallbackrow {
  display:grid; grid-template-columns:auto 1fr auto; gap:8px; align-items:center;
  padding:7px 9px; background:var(--bs-paper); border:1px solid var(--bs-border); border-radius:6px;
}
[data-sales-studio] .ss-fallbackrow.off { opacity:.55; }

/* DANGER */
[data-sales-studio] .bs-danger {
  margin:16px 14px; padding:14px 16px;
  background:var(--bs-paper); border:1px solid #e8c9c7;
  border-radius:8px;
  display:flex; align-items:center; justify-content:space-between; gap:12px;
}
[data-sales-studio] .bs-danger h3 { margin:0; font-size:13px; font-weight:600; color:var(--bs-danger); }
[data-sales-studio] .bs-danger p { margin:2px 0 0; font-size:11.5px; color:var(--bs-ink-3); }

/* MOBILE */
[data-sales-studio] .bs-mobile-tabs { display:none; }
@media (max-width: 960px) {
  [data-sales-studio] .bs-shell { grid-template-columns: 1fr; }
  [data-sales-studio] .bs-pane { display:none; }
  [data-sales-studio] .bs-pane.mobile-active { display:flex; }
  [data-sales-studio] .bs-left, [data-sales-studio] .bs-right { border:0; }
  [data-sales-studio] .bs-mobile-tabs {
    display:flex; gap:4px; padding:8px 12px;
    background:var(--bs-paper-2); border-bottom:1px solid var(--bs-border);
  }
  [data-sales-studio] .bs-mobile-tab {
    flex:1; padding:8px 0; border-radius:6px;
    font-size:12.5px; font-weight:500; color:var(--bs-ink-3);
    background:var(--bs-bg-2);
  }
  [data-sales-studio] .bs-mobile-tab.active { background:var(--bs-paper); color:var(--bs-ink); box-shadow:var(--bs-shadow-1); }
}
    `}</style>
  )
}
