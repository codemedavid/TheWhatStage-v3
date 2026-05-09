import type { CSSProperties } from 'react'
import Link from 'next/link'
import type { KindRendererProps } from '../types'
import type { ActionPageRow } from '@/app/(app)/dashboard/action-pages/_lib/queries'
import { createAdminClient } from '@/lib/supabase/admin'
import { signDeeplink } from '@/lib/action-pages/signing'
import { buildMapEmbedUrl, joinAddress } from '@/lib/action-pages/maps'
import {
  parseRealestateConfig,
  type RealestateConfig,
  type RealestateProperty,
  type PropertyStatus,
  type PropertyType,
} from './schema'
import GalleryClient from './Gallery.client'
import FormRenderer from '../form/Renderer'
import BookingRenderer from '../booking/Renderer'
import QualificationRenderer from '../qualification/Renderer'
import CTAFab from './CTAFab.client'

const STATUS_LABELS: Record<PropertyStatus, string> = {
  for_sale: 'For sale',
  for_rent: 'For rent',
  sold: 'Sold',
  reserved: 'Reserved',
  draft: 'Draft',
}

const STATUS_COLORS: Record<PropertyStatus, { bg: string; text: string }> = {
  for_sale: { bg: '#D1FAE5', text: '#065F46' },
  for_rent: { bg: '#DBEAFE', text: '#1E40AF' },
  sold: { bg: '#FEE2E2', text: '#991B1B' },
  reserved: { bg: '#FEF3C7', text: '#92400E' },
  draft: { bg: '#F3F4F6', text: '#6B7280' },
}

const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  house: 'House',
  condo: 'Condo',
  townhouse: 'Townhouse',
  lot: 'Lot',
  commercial: 'Commercial',
  other: 'Other',
}

interface LinkedPage {
  id: string
  user_id: string
  kind: ActionPageRow['kind']
  slug: string
  title: string
  description: string | null
  status: ActionPageRow['status']
  config: Record<string, unknown>
  pipeline_rules: ActionPageRow['pipeline_rules']
  notification_template: ActionPageRow['notification_template']
  cta_label: string | null
  bot_send_instructions: string | null
  signing_secret: string
  created_at: string
  updated_at: string
}

async function loadLinkedPages(
  ids: string[],
  ownerUserId: string,
): Promise<ActionPageRow[]> {
  if (ids.length === 0) return []
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('action_pages')
    .select(
      'id, user_id, kind, slug, title, description, status, config, pipeline_rules, notification_template, cta_label, bot_send_instructions, signing_secret, created_at, updated_at',
    )
    .in('id', ids)
    .eq('status', 'published')
    .eq('user_id', ownerUserId)
  if (error || !data) return []
  const ordered: ActionPageRow[] = []
  for (const id of ids) {
    const row = (data as LinkedPage[]).find((r) => r.id === id)
    if (!row) continue
    ordered.push({
      id: row.id,
      kind: row.kind,
      slug: row.slug,
      title: row.title,
      description: row.description,
      status: row.status,
      config: row.config ?? {},
      pipeline_rules: row.pipeline_rules ?? [],
      notification_template: row.notification_template ?? null,
      cta_label: row.cta_label ?? null,
      bot_send_instructions: row.bot_send_instructions ?? null,
      signing_secret: row.signing_secret,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })
  }
  return ordered
}

async function getPageOwnerUserId(pageId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('action_pages')
    .select('user_id')
    .eq('id', pageId)
    .maybeSingle<{ user_id: string }>()
  return data?.user_id ?? null
}

export default async function RealEstateRenderer(props: KindRendererProps) {
  const { page, claims, rawToken, searchParams } = props
  const config = parseRealestateConfig(page.config)

  const sp = searchParams ?? {}
  const selectedRaw = sp.property
  const selectedId =
    typeof selectedRaw === 'string'
      ? selectedRaw
      : Array.isArray(selectedRaw)
        ? selectedRaw[0]
        : undefined
  const selected =
    (selectedId && config.properties.find((p) => p.id === selectedId)) || null

  const cssVars: CSSProperties = {
    ['--ws-bg' as string]: config.theme.background_color,
    ['--ws-accent' as string]: config.theme.accent_color,
    ['--ws-button-text' as string]: config.theme.button_text_color,
  }

  if (selected) {
    return (
      <PropertyDetail
        page={page}
        config={config}
        property={selected}
        claims={claims}
        rawToken={rawToken}
        cssVars={cssVars}
      />
    )
  }

  return (
    <main
      className="min-h-screen pb-20"
      style={{ background: config.theme.background_color, ...cssVars }}
    >
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8">
          <h1 className="text-[28px] font-semibold leading-tight text-[#0F172A] sm:text-[34px]">
            {page.title}
          </h1>
          {page.description && (
            <p className="mt-2 max-w-2xl text-[14.5px] text-[#475569]">
              {page.description}
            </p>
          )}
          <p className="mt-3 text-[12.5px] text-[#64748B]">
            {config.properties.length}{' '}
            {config.properties.length === 1 ? 'property' : 'properties'} listed
          </p>
        </header>

        {config.properties.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#CBD5E1] bg-white px-6 py-16 text-center">
            <p className="text-[13.5px] text-[#64748B]">
              No properties listed yet. Check back soon.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {config.properties.map((p) => (
              <PropertyCard
                key={p.id}
                slug={page.slug}
                property={p}
                accent={config.theme.accent_color}
                queryString={preserveQueryString(sp, p.id)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

/* ────────────────────────── Card (catalog item) ────────────────────────── */

function PropertyCard({
  slug,
  property,
  accent,
  queryString,
}: {
  slug: string
  property: RealestateProperty
  accent: string
  queryString: string
}) {
  const sortedGallery = [...property.gallery].sort(
    (a, b) => a.position - b.position,
  )
  const cover =
    sortedGallery.find((g) => g.primary) ?? sortedGallery[0] ?? null
  const statusMeta = STATUS_COLORS[property.status]
  const priceLabel = formatPrice(property.price)
  const addressLine = joinAddress(property.address)
  const href = `/a/${slug}?${queryString}`

  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#F1F5F9]">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover.url}
            alt={cover.alt || property.title || 'Property photo'}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[12px] text-[#94A3B8]">
            No photo
          </div>
        )}
        <span
          className="absolute left-3 top-3 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold backdrop-blur"
          style={{ background: statusMeta.bg, color: statusMeta.text }}
        >
          {STATUS_LABELS[property.status]}
        </span>
        {property.gallery.length > 1 && (
          <span className="absolute right-3 top-3 inline-flex items-center rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
            {property.gallery.length} photos
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-[16px] font-semibold text-[#0F172A] group-hover:underline">
            {property.title || 'Untitled property'}
          </h3>
        </div>
        {addressLine && (
          <p className="line-clamp-1 text-[12.5px] text-[#64748B]">
            {addressLine}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[#475569]">
          {property.specs.beds !== null && <span>{property.specs.beds} bd</span>}
          {property.specs.baths !== null && <span>{property.specs.baths} ba</span>}
          {property.specs.floor_area && (
            <span>
              {property.specs.floor_area.value} {property.specs.floor_area.unit}
            </span>
          )}
        </div>
        <div className="mt-auto flex items-end justify-between pt-2">
          {priceLabel ? (
            <span
              className="text-[18px] font-semibold"
              style={{ color: accent }}
            >
              {priceLabel}
            </span>
          ) : (
            <span className="text-[12px] text-[#94A3B8]">Inquire for price</span>
          )}
          <span
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-semibold text-white"
            style={{ background: accent }}
          >
            View →
          </span>
        </div>
      </div>
    </Link>
  )
}

function preserveQueryString(
  sp: Record<string, string | string[] | undefined>,
  propertyId: string,
): string {
  const params = new URLSearchParams()
  for (const k of ['p', 'g', 'e', 't']) {
    const v = sp[k]
    if (typeof v === 'string') params.set(k, v)
    else if (Array.isArray(v) && typeof v[0] === 'string') params.set(k, v[0])
  }
  params.set('property', propertyId)
  return params.toString()
}

/* ────────────────────────── Detail ────────────────────────── */

async function PropertyDetail({
  page,
  config,
  property,
  claims,
  rawToken,
  cssVars,
}: {
  page: ActionPageRow
  config: RealestateConfig
  property: RealestateProperty
  claims: KindRendererProps['claims']
  rawToken: KindRendererProps['rawToken']
  cssVars: CSSProperties
}) {
  const ownerUserId = await getPageOwnerUserId(page.id)
  const linkedPages = ownerUserId
    ? await loadLinkedPages(config.linked_action_page_ids, ownerUserId)
    : []

  const sourceContext = {
    source_property_action_page_id: page.id,
    source_property_title: page.title,
    source_property_unit_id: property.id,
    source_property_unit_title: property.title || page.title,
  }

  const mapEmbedUrl = buildMapEmbedUrl(property.address)
  const addressLine = joinAddress(property.address)
  const sortedGallery = [...property.gallery].sort(
    (a, b) => a.position - b.position,
  )
  const primary = sortedGallery.find((g) => g.primary) ?? sortedGallery[0] ?? null
  const statusMeta = STATUS_COLORS[property.status]
  const statusLabel = STATUS_LABELS[property.status]
  const priceLabel = formatPrice(property.price)

  return (
    <main
      className="min-h-screen pb-20"
      style={{ background: config.theme.background_color, ...cssVars }}
    >
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4">
          <Link
            href={`/a/${page.slug}`}
            className="inline-flex items-center gap-1 text-[12.5px] text-[#64748B] hover:text-[#0F172A]"
          >
            ← All properties
          </Link>
        </div>

        {/* Header */}
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span
              className="mb-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
              style={{ background: statusMeta.bg, color: statusMeta.text }}
            >
              {statusLabel}
            </span>
            <h1 className="text-[26px] font-semibold leading-tight text-[#0F172A] sm:text-[32px]">
              {property.title || page.title}
            </h1>
            {addressLine && (
              <p className="mt-1 flex items-center gap-1.5 text-[14px] text-[#475569]">
                <PinIcon /> {addressLine}
              </p>
            )}
          </div>
          {priceLabel && (
            <div className="text-left sm:text-right">
              <div
                className="text-[24px] font-semibold sm:text-[28px]"
                style={{ color: config.theme.accent_color }}
              >
                {priceLabel}
              </div>
            </div>
          )}
        </header>

        {/* Gallery */}
        {sortedGallery.length > 0 && primary ? (
          <GalleryClient gallery={sortedGallery} primaryId={primary.id} />
        ) : (
          <div className="mb-6 flex aspect-[16/9] items-center justify-center rounded-xl border border-dashed border-[#E5E7EB] bg-[#F9FAFB] text-[13px] text-[#9CA3AF]">
            No photos yet
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {property.description && (
              <Section title="About this property">
                <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-[#334155]">
                  {property.description}
                </p>
              </Section>
            )}

            <SpecsBlock property={property} />

            {property.amenities.length > 0 && (
              <Section title="Amenities">
                <div className="flex flex-wrap gap-2">
                  {property.amenities.map((a) => (
                    <span
                      key={a}
                      className="inline-flex items-center rounded-full border border-[#E5E7EB] bg-white px-3 py-1 text-[13px] text-[#334155]"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {(property.financing_options.length > 0 || property.financing_notes) && (
              <Section title="Financing">
                {property.financing_options.length > 0 && (
                  <FinancingTable
                    options={property.financing_options}
                    accent={config.theme.accent_color}
                  />
                )}
                {property.financing_notes && (
                  <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-[#475569]">
                    {property.financing_notes}
                  </p>
                )}
              </Section>
            )}
          </div>

          <aside className="space-y-6">
            {mapEmbedUrl && (
              <Section title="Location">
                <div className="overflow-hidden rounded-md border border-[#E5E7EB]">
                  <iframe
                    src={mapEmbedUrl}
                    width="100%"
                    height="280"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    allowFullScreen
                    className="block"
                    title="Property location"
                  />
                </div>
                {addressLine && (
                  <p className="mt-2 text-[13px] text-[#64748B]">{addressLine}</p>
                )}
              </Section>
            )}
          </aside>
        </div>

        {linkedPages.length > 0 && (
          <section className="mt-10 space-y-6">
            <header>
              <h2 className="text-[20px] font-semibold text-[#0F172A]">
                Next steps
              </h2>
              <p className="mt-1 text-[13px] text-[#64748B]">
                Take action on this property — your responses are linked to this
                listing.
              </p>
            </header>
            {linkedPages.map((linked, idx) => (
              <div
                key={linked.id}
                className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm"
              >
                <div className="mb-3 flex items-center gap-2">
                  <StepBadge n={idx + 1} accent={config.theme.accent_color} />
                  <h3 className="text-[16px] font-semibold text-[#0F172A]">
                    {linked.title}
                  </h3>
                  <KindBadge kind={linked.kind} />
                </div>
                <LinkedRenderer
                  page={linked}
                  claims={claims}
                  rawToken={rawToken}
                  sourceContext={sourceContext}
                />
              </div>
            ))}
          </section>
        )}
      </div>

      {linkedPages.length > 0 && (
        <CTAFab
          pages={linkedPages.map((p) => ({
            id: p.id,
            kind: p.kind,
            title: p.title,
            cta_label: p.cta_label,
          }))}
          accent={config.theme.accent_color}
        >
          {linkedPages.map((linked) => (
            <LinkedRenderer
              key={linked.id}
              page={linked}
              claims={claims}
              rawToken={rawToken}
              sourceContext={sourceContext}
            />
          ))}
        </CTAFab>
      )}
    </main>
  )
}

/* ────────────────────────── Linked sub-page dispatcher ────────────────────────── */

function LinkedRenderer({
  page,
  claims,
  rawToken,
  sourceContext,
}: {
  page: ActionPageRow
  claims: KindRendererProps['claims']
  rawToken: KindRendererProps['rawToken']
  sourceContext: KindRendererProps['sourceContext']
}) {
  const reSignedToken = claims
    ? signDeeplink(page.signing_secret, {
        slug: page.slug,
        psid: claims.psid,
        pageId: claims.pageId,
        exp: claims.exp,
      })
    : null
  const baseProps: KindRendererProps = {
    page,
    claims: claims ? { ...claims, slug: page.slug } : null,
    rawToken: reSignedToken,
    variant: 'embed',
    sourceContext,
  }
  switch (page.kind) {
    case 'form':
      return <FormRenderer {...baseProps} />
    case 'booking':
      return <BookingRenderer {...baseProps} />
    case 'qualification':
      return <QualificationRenderer {...baseProps} />
    default:
      return (
        <p className="text-[12px] text-[#9CA3AF]">
          This linked page kind is not embeddable yet.
        </p>
      )
  }
}

/* ────────────────────────── Sub-components ────────────────────────── */

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-[15px] font-semibold text-[#0F172A]">{title}</h3>
      {children}
    </section>
  )
}

function SpecsBlock({ property }: { property: RealestateProperty }) {
  const specs = property.specs
  const rows: Array<{ label: string; value: string }> = []
  if (specs.property_type)
    rows.push({ label: 'Type', value: PROPERTY_TYPE_LABELS[specs.property_type] })
  if (specs.beds !== null) rows.push({ label: 'Bedrooms', value: String(specs.beds) })
  if (specs.baths !== null) rows.push({ label: 'Bathrooms', value: String(specs.baths) })
  if (specs.floor_area)
    rows.push({
      label: 'Floor area',
      value: `${specs.floor_area.value} ${specs.floor_area.unit}`,
    })
  if (specs.lot_area)
    rows.push({
      label: 'Lot area',
      value: `${specs.lot_area.value} ${specs.lot_area.unit}`,
    })
  if (specs.year_built !== null)
    rows.push({ label: 'Year built', value: String(specs.year_built) })
  if (specs.parking !== null)
    rows.push({ label: 'Parking', value: String(specs.parking) })
  for (const f of property.custom_specs) {
    if (f.value) rows.push({ label: f.label, value: f.value })
  }
  if (rows.length === 0) return null

  return (
    <Section title="Property details">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        {rows.map((r) => (
          <div key={`${r.label}-${r.value}`}>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
              {r.label}
            </dt>
            <dd className="mt-0.5 text-[14px] font-medium text-[#0F172A]">
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}

function FinancingTable({
  options,
  accent,
}: {
  options: RealestateProperty['financing_options']
  accent: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr
            className="text-left text-[11px] font-semibold uppercase tracking-wide text-[#64748B]"
            style={{ borderBottom: `2px solid ${accent}33` }}
          >
            <th className="px-3 py-2">Option</th>
            <th className="px-3 py-2">Down payment</th>
            <th className="px-3 py-2">Term</th>
            <th className="px-3 py-2">Monthly</th>
            <th className="px-3 py-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {options.map((o) => (
            <tr key={o.id} className="border-b border-[#F1F5F9] align-top">
              <td className="px-3 py-2.5 font-semibold text-[#0F172A]">{o.label}</td>
              <td className="px-3 py-2.5 text-[#334155]">
                {formatDownPayment(o)}
              </td>
              <td className="px-3 py-2.5 text-[#334155]">
                {o.term_months ? `${o.term_months} mo` : '—'}
              </td>
              <td className="px-3 py-2.5 text-[#334155]">
                {o.monthly_amount !== null
                  ? formatCurrency(o.monthly_amount, o.currency)
                  : '—'}
              </td>
              <td className="px-3 py-2.5 text-[#475569]">{o.notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StepBadge({ n, accent }: { n: number; accent: string }) {
  return (
    <span
      className="grid h-6 w-6 place-items-center rounded-full text-[12px] font-semibold text-white"
      style={{ background: accent }}
    >
      {n}
    </span>
  )
}

function KindBadge({ kind }: { kind: string }) {
  const meta: Record<string, { bg: string; text: string; label: string }> = {
    form: { bg: '#F5F3FF', text: '#6D28D9', label: 'Form' },
    booking: { bg: '#EFF6FF', text: '#1D4ED8', label: 'Booking' },
    qualification: { bg: '#FFFBEB', text: '#B45309', label: 'Qualification' },
  }
  const m = meta[kind] ?? { bg: '#F3F4F6', text: '#6B7280', label: kind }
  return (
    <span
      className="ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: m.bg, color: m.text }}
    >
      {m.label}
    </span>
  )
}

function PinIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21s-7-7.5-7-12a7 7 0 0114 0c0 4.5-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  )
}

/* ────────────────────────── Formatting ────────────────────────── */

function formatPrice(price: RealestateProperty['price']): string | null {
  if (price.display_label) return price.display_label
  if (price.amount === null || !Number.isFinite(price.amount)) return null
  const base = formatCurrency(price.amount, price.currency)
  if (price.period === 'monthly') return `${base} / mo`
  if (price.period === 'yearly') return `${base} / yr`
  return base
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${amount.toLocaleString()} ${currency}`
  }
}

function formatDownPayment(
  o: RealestateProperty['financing_options'][number],
): string {
  const parts: string[] = []
  if (o.down_payment_percent !== null && Number.isFinite(o.down_payment_percent)) {
    parts.push(`${o.down_payment_percent}%`)
  }
  if (o.down_payment_amount !== null && Number.isFinite(o.down_payment_amount)) {
    parts.push(formatCurrency(o.down_payment_amount, o.currency))
  }
  return parts.length > 0 ? parts.join(' · ') : '—'
}
