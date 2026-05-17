import type { CSSProperties } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { signDeeplink } from '@/lib/action-pages/signing'
import type { ActionPageRow } from '@/app/(app)/dashboard/action-pages/_lib/queries'
import type { KindRendererProps, SourceContext } from '../types'
import { parseSalesConfig, type SalesConfig } from './schema'
import FormRenderer from '../form/Renderer'
import BookingRenderer from '../booking/Renderer'
import QualificationRenderer from '../qualification/Renderer'
import { SalesGalleryClient } from './GalleryClient'
import { SalesCheckoutModal } from './SalesCheckoutModal'

const KIND_CTA_LABEL: Record<string, string> = {
  form: 'Fill out the form',
  booking: 'Book a call',
  qualification: 'See if you qualify',
}

export default async function SalesRenderer(props: KindRendererProps) {
  const config = parseSalesConfig(props.page.config)
  const linked = await loadLinkedPages(
    props.page.id,
    config.linked_action_page_ids,
  )

  const rootStyle: CSSProperties & Record<string, string> = {
    ['--sales-bg']: config.theme.background_color,
    ['--sales-accent']: config.theme.accent_color,
    ['--sales-accent-fg']: config.theme.button_text_color,
    backgroundColor: 'var(--sales-bg)',
  }

  const primaryImage =
    config.gallery.find((g) => g.primary) ?? config.gallery[0] ?? null
  const sortedGallery = [...config.gallery].sort(
    (a, b) => a.position - b.position,
  )

  const sourceContext: SourceContext = {
    source_sales_page_id: props.page.id,
    source_sales_page_title: props.page.title,
  }

  const productName = config.product.name || props.page.title
  const productHeadline =
    config.product.headline && config.product.headline !== productName
      ? config.product.headline
      : null
  const productTypeLabel = productTypeName(config.product.type)
  const priceLabel = formatPriceLabel(config)
  const priceMeta = priceLabel
    ? [priceLabel.primary, priceLabel.suffix].filter(Boolean).join(' ')
    : null
  const primaryStat = config.social_proof[0] ?? null
  const sidebarStats = config.social_proof.slice(0, 3)
  const sidebarLinks = config.features
    .filter((f) => f.title)
    .slice(0, 3)
    .map((f) => ({ id: f.id, icon: f.icon, title: f.title }))

  return (
    <main className="min-h-screen w-full" style={rootStyle}>
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-8 sm:py-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ─── Main card ─── */}
        <article className="rounded-2xl border border-[#E5E7EB] bg-white p-5 sm:p-7">
          {config.product.tagline && (
            <p
              className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--sales-accent)' }}
            >
              {config.product.tagline}
            </p>
          )}
          <h1 className="text-[22px] font-bold text-[#111827] sm:text-[26px]">
            {productName}
          </h1>

          <div className="mt-4">
            {sortedGallery.length > 0 ? (
              <SalesGalleryClient
                gallery={sortedGallery.map((g) => ({
                  id: g.id,
                  url: g.url,
                  alt: g.alt,
                }))}
                accent={config.theme.accent_color}
                showHeading={false}
                className=""
              />
            ) : (
              <div className="aspect-[21/9] w-full rounded-xl border border-dashed border-[#E5E7EB] bg-[#F9FAFB]" />
            )}
          </div>

          {productHeadline && (
            <p className="mt-3 text-[15px] leading-snug text-[#374151]">
              {productHeadline}
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-[#374151]">
            <MetaItem icon={<LockIcon />} label={productTypeLabel} />
            {primaryStat && (
              <MetaItem
                icon={<UsersIcon />}
                label={`${primaryStat.stat_value} ${primaryStat.stat_label}`.trim()}
              />
            )}
            {priceMeta && (
              <MetaItem icon={<TagIcon />} label={priceMeta} />
            )}
          </div>

          {config.product.description && (
            <p className="mt-6 whitespace-pre-wrap text-[15px] leading-relaxed text-[#374151]">
              {config.product.description}
            </p>
          )}

          {config.features.length > 0 && (
            <Section title="What's included">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {config.features.map((f) => (
                  <div
                    key={f.id}
                    className="rounded-xl border border-[#E5E7EB] bg-white p-4"
                  >
                    {f.icon && (
                      <div className="mb-2 text-[22px] leading-none">{f.icon}</div>
                    )}
                    <h3 className="text-[15px] font-semibold text-[#111827]">
                      {f.title}
                    </h3>
                    {f.body && (
                      <p className="mt-1 text-[13px] leading-relaxed text-[#6B7280]">
                        {f.body}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {config.benefits.length > 0 && (
            <Section title="Why it works">
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {config.benefits.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-start gap-2 text-[14px] text-[#374151]"
                  >
                    <span
                      aria-hidden
                      className="mt-1 inline-flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ backgroundColor: 'var(--sales-accent)' }}
                    >
                      ✓
                    </span>
                    <span>{b.text}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {config.testimonials.length > 0 && (
            <Section title="What customers say">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {config.testimonials.map((t) => (
                  <figure
                    key={t.id}
                    className="rounded-xl border border-[#E5E7EB] bg-white p-5"
                  >
                    <blockquote className="text-[14px] leading-relaxed text-[#374151]">
                      &ldquo;{t.quote}&rdquo;
                    </blockquote>
                    <figcaption className="mt-4 flex items-center gap-3">
                      {t.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.avatar_url}
                          alt=""
                          className="h-9 w-9 rounded-full object-cover"
                        />
                      ) : (
                        <div className="h-9 w-9 rounded-full bg-[#F3F4F6]" />
                      )}
                      <div>
                        <div className="text-[13px] font-semibold text-[#111827]">
                          {t.author}
                        </div>
                        {t.role && (
                          <div className="text-[12px] text-[#6B7280]">
                            {t.role}
                          </div>
                        )}
                      </div>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </Section>
          )}

          {config.guarantee.enabled && (
            <Section>
              <div
                className="rounded-xl border-2 p-5"
                style={{
                  borderColor: 'var(--sales-accent)',
                  backgroundColor: `color-mix(in srgb, var(--sales-accent) 5%, white)`,
                }}
              >
                <div
                  className="text-[15px] font-bold"
                  style={{ color: 'var(--sales-accent)' }}
                >
                  ✓ {config.guarantee.title || 'Our guarantee'}
                </div>
                {config.guarantee.body && (
                  <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-[#374151]">
                    {config.guarantee.body}
                  </p>
                )}
              </div>
            </Section>
          )}

          {config.delivery.notes && (
            <Section>
              <div className="rounded-xl bg-[#F9FAFB] p-4">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-[#6B7280]">
                  Delivery
                </div>
                <div className="mt-1 text-[14px] text-[#374151]">
                  {deliveryLabel(config.delivery.type)} — {config.delivery.notes}
                </div>
              </div>
            </Section>
          )}

          {config.faqs.length > 0 && (
            <Section title="Frequently asked questions">
              <div className="space-y-2">
                {config.faqs.map((f) => (
                  <details
                    key={f.id}
                    className="group rounded-xl border border-[#E5E7EB] bg-white p-4"
                  >
                    <summary className="cursor-pointer list-none text-[14px] font-semibold text-[#111827] [&::-webkit-details-marker]:hidden">
                      <span className="flex items-center justify-between gap-2">
                        <span>{f.question}</span>
                        <span className="text-[#9CA3AF] group-open:rotate-180 transition-transform">
                          ▾
                        </span>
                      </span>
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-[#374151]">
                      {f.answer}
                    </p>
                  </details>
                ))}
              </div>
            </Section>
          )}

          <section id="convert" className="mt-10 scroll-mt-6">
            {linked.length > 0 ? (
              <>
                <h2 className="mb-4 text-[20px] font-semibold text-[#111827]">
                  Get started
                </h2>
                <LinkedConversions
                  linked={linked}
                  claims={props.claims}
                  rawToken={props.rawToken}
                  sourceContext={sourceContext}
                />
              </>
            ) : (
              <SalesCheckoutModal
                slug={props.page.slug}
                pageId={props.page.id}
                ctaLabel={config.cta.primary_label}
                submitButtonLabel={config.fallback_form.submit_button_label}
                successMessage={config.fallback_form.success_message}
                fields={config.fallback_form.fields}
                paymentEnabled={config.payment.enabled}
                paymentMethods={props.paymentMethods ?? []}
                defaultCurrency={config.price.currency ?? 'PHP'}
                priceAmount={config.price.amount}
                accent={config.theme.accent_color}
                ctaFg={config.theme.button_text_color}
                claims={props.claims}
                rawToken={props.rawToken}
              />
            )}
          </section>
        </article>

        {/* ─── Sticky sidebar ─── */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Sidebar
            title={productName}
            slug={props.page.slug}
            tagline={config.product.tagline}
            description={excerpt(config.product.description, 220)}
            primaryImage={primaryImage}
            accent={config.theme.accent_color}
            ctaLabel={config.cta.primary_label}
            ctaFg={config.theme.button_text_color}
            stats={sidebarStats}
            links={sidebarLinks}
            priceLabel={priceLabel}
          />
        </aside>
      </div>

    </main>
  )
}

/* ────────────────────────── Sidebar ────────────────────────── */

function Sidebar({
  title,
  slug,
  tagline,
  description,
  primaryImage,
  accent,
  ctaLabel,
  ctaFg,
  stats,
  links,
  priceLabel,
}: {
  title: string
  slug: string
  tagline: string
  description: string
  primaryImage: SalesConfig['gallery'][number] | null
  accent: string
  ctaLabel: string
  ctaFg: string
  stats: SalesConfig['social_proof']
  links: Array<{ id: string; icon: string; title: string }>
  priceLabel: ReturnType<typeof formatPriceLabel>
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white">
      {primaryImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={primaryImage.url}
          alt={primaryImage.alt || title}
          className="aspect-[16/10] w-full object-cover"
        />
      ) : (
        <div
          className="aspect-[16/10] w-full"
          style={{
            background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 25%, white), color-mix(in srgb, ${accent} 65%, white))`,
          }}
        />
      )}

      <div className="p-5">
        <h2 className="text-[18px] font-bold text-[#111827]">{title}</h2>
        <p className="mt-0.5 truncate text-[12px] text-[#6B7280]">/{slug}</p>

        {description && (
          <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-[#374151]">
            {description}
          </p>
        )}

        {links.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {links.map((l) => (
              <li
                key={l.id}
                className="flex items-center gap-2 text-[13px] text-[#374151]"
              >
                <LinkIcon />
                <span className="truncate">
                  {l.icon ? `${l.icon} ` : ''}
                  {l.title}
                </span>
              </li>
            ))}
          </ul>
        )}

        {stats.length > 0 && (
          <div className="mt-5 grid grid-cols-3 gap-2 border-y border-[#E5E7EB] py-4 text-center">
            {stats.map((s) => (
              <div key={s.id}>
                <div className="text-[18px] font-bold text-[#111827]">
                  {s.stat_value}
                </div>
                <div className="text-[11px] text-[#6B7280]">{s.stat_label}</div>
              </div>
            ))}
          </div>
        )}

        {priceLabel && (
          <div className="mt-4 flex items-baseline gap-2">
            <div
              className="text-[20px] font-bold"
              style={{ color: accent }}
            >
              {priceLabel.primary}
            </div>
            {priceLabel.compareAt && (
              <div className="text-[13px] text-[#9CA3AF] line-through">
                {priceLabel.compareAt}
              </div>
            )}
            {priceLabel.suffix && (
              <div className="text-[12px] text-[#6B7280]">{priceLabel.suffix}</div>
            )}
          </div>
        )}

        <a
          href="#convert"
          className="mt-4 flex w-full items-center justify-center rounded-md px-5 py-3 text-[14px] font-semibold uppercase tracking-wide shadow-sm"
          style={{
            backgroundColor: accent,
            color: ctaFg,
          }}
        >
          {ctaLabel}
        </a>

        {tagline && (
          <p className="mt-3 text-center text-[11px] text-[#9CA3AF]">
            {tagline}
          </p>
        )}
      </div>
    </div>
  )
}

/* ────────────────────────── Meta items ────────────────────────── */

function MetaItem({
  icon,
  label,
}: {
  icon: React.ReactNode
  label: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[#6B7280]">{icon}</span>
      <span>{label}</span>
    </span>
  )
}

function LockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function TagIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20.59 13.41 11 22l-9-9V3h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
      <circle cx="7" cy="7" r="1.5" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="text-[#6B7280]"
    >
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  )
}

function productTypeName(type: SalesConfig['product']['type']): string {
  switch (type) {
    case 'digital':
      return 'Digital'
    case 'physical':
      return 'Physical'
    case 'service':
      return 'Service'
    case 'course':
      return 'Course'
    case 'other':
      return 'Offer'
  }
}

function excerpt(text: string, max: number): string {
  if (!text) return ''
  if (text.length <= max) return text
  return `${text.slice(0, max).trimEnd()}…`
}

/* ────────────────────────── Sections ────────────────────────── */

function Section({
  title,
  children,
}: {
  title?: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-10">
      {title && (
        <h2 className="mb-4 text-[20px] font-semibold text-[#111827]">{title}</h2>
      )}
      {children}
    </section>
  )
}

/* ────────────────────────── Conversion section ────────────────────────── */

interface LinkedPageRow {
  id: string
  kind: ActionPageRow['kind']
  page: ActionPageRow
}

async function loadLinkedPages(
  excludeId: string,
  ids: string[],
): Promise<LinkedPageRow[]> {
  if (!ids.length) return []
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('action_pages')
    .select(
      'id, user_id, kind, slug, title, description, status, config, pipeline_rules, notification_template, cta_label, bot_send_instructions, signing_secret, created_at, updated_at',
    )
    .in('id', ids)
    .eq('status', 'published')
  if (error || !data) return []

  const byId = new Map<string, ActionPageRow>()
  for (const row of data as Array<Record<string, unknown>>) {
    if (row.id === excludeId) continue
    const kind = row.kind as ActionPageRow['kind']
    if (kind !== 'form' && kind !== 'booking' && kind !== 'qualification') continue
    byId.set(row.id as string, {
      id: row.id as string,
      kind,
      slug: row.slug as string,
      title: row.title as string,
      description: (row.description as string | null) ?? null,
      status: row.status as ActionPageRow['status'],
      config: (row.config as Record<string, unknown>) ?? {},
      pipeline_rules: (row.pipeline_rules as ActionPageRow['pipeline_rules']) ?? [],
      notification_template:
        (row.notification_template as ActionPageRow['notification_template']) ?? null,
      cta_label: (row.cta_label as string | null) ?? null,
      bot_send_instructions: (row.bot_send_instructions as string | null) ?? null,
      signing_secret: row.signing_secret as string,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    })
  }

  // Preserve user-defined link order.
  const out: LinkedPageRow[] = []
  for (const id of ids) {
    const p = byId.get(id)
    if (p) out.push({ id: p.id, kind: p.kind, page: p })
  }
  return out
}

function LinkedConversions({
  linked,
  claims,
  rawToken,
  sourceContext,
}: {
  linked: LinkedPageRow[]
  claims: KindRendererProps['claims']
  rawToken: KindRendererProps['rawToken']
  sourceContext: SourceContext
}) {
  return (
    <div className="space-y-4">
      {linked.map(({ page, kind }) => {
        const linkedToken = claims
          ? signDeeplink(page.signing_secret, {
              slug: page.slug,
              psid: claims.psid,
              pageId: claims.pageId,
              exp: claims.exp,
            })
          : null
        const linkedClaims = claims ? { ...claims, slug: page.slug } : null
        return (
        <details
          key={page.id}
          open={linked.length === 1}
          className="group rounded-xl border border-[#E5E7EB] bg-white"
        >
          <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 text-[14px] font-semibold text-[#111827] [&::-webkit-details-marker]:hidden">
            <span>
              {KIND_CTA_LABEL[kind] ?? page.title} ·{' '}
              <span className="text-[12px] font-normal text-[#6B7280]">
                {page.title}
              </span>
            </span>
            <span className="text-[#9CA3AF] group-open:rotate-180 transition-transform">
              ▾
            </span>
          </summary>
          <div className="border-t border-[#E5E7EB] p-5">
            {kind === 'form' && (
              <FormRenderer
                page={page}
                claims={linkedClaims}
                rawToken={linkedToken}
                variant="embed"
                sourceContext={sourceContext}
              />
            )}
            {kind === 'booking' && (
              <BookingRenderer
                page={page}
                claims={linkedClaims}
                rawToken={linkedToken}
                variant="embed"
                sourceContext={sourceContext}
              />
            )}
            {kind === 'qualification' && (
              <QualificationRenderer
                page={page}
                claims={linkedClaims}
                rawToken={linkedToken}
                variant="embed"
                sourceContext={sourceContext}
              />
            )}
          </div>
        </details>
        )
      })}
    </div>
  )
}

/* ────────────────────────── Helpers ────────────────────────── */

function deliveryLabel(type: SalesConfig['delivery']['type']): string {
  switch (type) {
    case 'instant_download':
      return 'Instant download'
    case 'email':
      return 'Sent by email'
    case 'shipped':
      return 'Shipped'
    case 'scheduled':
      return 'Scheduled / booked'
    case 'manual':
      return 'Manual fulfilment'
  }
}

function formatPriceLabel(
  config: SalesConfig,
): { primary: string; compareAt: string | null; suffix: string | null } | null {
  const { price } = config
  if (price.display_label) {
    return { primary: price.display_label, compareAt: null, suffix: null }
  }
  if (price.amount === null) return null
  const primary = formatMoney(price.amount, price.currency)
  const compareAt =
    price.compare_at_amount && price.compare_at_amount > price.amount
      ? formatMoney(price.compare_at_amount, price.currency)
      : null
  const suffix =
    price.period === 'monthly'
      ? '/ month'
      : price.period === 'yearly'
        ? '/ year'
        : null
  return { primary, compareAt, suffix }
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}
