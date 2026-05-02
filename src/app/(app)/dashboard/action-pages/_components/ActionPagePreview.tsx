'use client'

import { useMemo } from 'react'
import {
  KIND_REGISTRY,
  type ActionPageKind,
} from '@/lib/action-pages/kinds'
import type { ActionPageRow } from '../_lib/queries'
import FormRenderer from '@/app/a/[slug]/_kinds/form/Renderer'
import { QualificationClient } from '@/app/a/[slug]/_kinds/qualification/Renderer.client'
import { parseQualificationConfig } from '@/app/a/[slug]/_kinds/qualification/schema'

const KIND_ICON: Record<ActionPageKind, React.ReactNode> = {
  form: <IconForm />,
  booking: <IconBooking />,
  qualification: <IconQuiz />,
  sales: <IconSales />,
  catalog: <IconCatalog />,
  realestate: <IconRealEstate />,
}

export { KIND_ICON }

function previewSlug(title: string, fallback?: string): string {
  if (fallback) return fallback
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base.length >= 3 ? `${base}-xxxxxx` : 'page-xxxxxx'
}

export function ActionPagePreview({
  kind,
  title,
  description,
  slug,
  accent,
  status,
  config,
  realPage,
}: {
  kind: ActionPageKind
  title: string
  description: string
  slug?: string
  accent?: string
  status?: 'draft' | 'published' | 'archived'
  config?: Record<string, unknown>
  realPage?: ActionPageRow | null
}) {
  const useReal =
    realPage != null && (kind === 'form' || kind === 'qualification')
  const meta = KIND_REGISTRY[kind]
  const resolvedSlug = useMemo(() => previewSlug(title || '', slug), [title, slug])
  const resolvedAccent =
    accent ??
    (meta.defaultConfig as { theme?: { accent_color?: string } }).theme
      ?.accent_color ??
    '#059669'
  const statusLabel =
    status === 'published'
      ? 'Published'
      : status === 'archived'
        ? 'Archived'
        : 'Draft'

  return (
    <aside className="lg:sticky lg:top-6 lg:self-start">
      <div className="overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
        <div className="flex items-center justify-between border-b border-[#F3F4F6] bg-[#F9FAFB] px-4 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
            Live preview
          </span>
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-[#6B7280] ring-1 ring-inset ring-[#E5E7EB]">
            {statusLabel}
          </span>
        </div>

        <div className="bg-[#F3F4F6] p-4">
          <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
            <div className="flex items-center gap-1.5 border-b border-[#F3F4F6] px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-[#F87171]" />
              <span className="h-2 w-2 rounded-full bg-[#FBBF24]" />
              <span className="h-2 w-2 rounded-full bg-[#34D399]" />
              <span className="ml-2 truncate font-mono text-[10px] text-[#9CA3AF]">
                /a/{resolvedSlug}
              </span>
            </div>
            {useReal ? (
              <div
                className="origin-top-left p-3"
                style={{
                  pointerEvents: 'none',
                  transform: 'scale(0.78)',
                  transformOrigin: 'top left',
                  width: '128.2%',
                }}
                aria-hidden
                inert
              >
                {kind === 'qualification' ? (
                  <QualificationPreview page={realPage!} />
                ) : (
                  <FormRenderer
                    page={realPage!}
                    claims={null}
                    rawToken={null}
                    variant="standalone"
                  />
                )}
              </div>
            ) : (
              <div className="p-4">
                <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[10px] font-semibold text-[#374151]">
                  <span className="opacity-70">{KIND_ICON[kind]}</span>
                  {meta.label}
                </div>
                <h3 className="text-[15px] font-semibold leading-snug text-[#111827]">
                  {title.trim() || 'Your page title'}
                </h3>
                {description.trim() && (
                  <p className="mt-1 text-[12px] leading-snug text-[#6B7280]">
                    {description}
                  </p>
                )}
                <div className="mt-3 space-y-2">
                  <KindMockBody kind={kind} config={config} />
                </div>
                <button
                  type="button"
                  disabled
                  className="mt-3 w-full rounded-md px-3 py-1.5 text-[11px] font-semibold text-white"
                  style={{ backgroundColor: resolvedAccent }}
                >
                  {kindCta(kind, config)}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-[#F3F4F6] px-4 py-3 text-[12px] text-[#6B7280]">
          {meta.blurb}
        </div>
      </div>
    </aside>
  )
}

function QualificationPreview({ page }: { page: ActionPageRow }) {
  const config = parseQualificationConfig(page.config ?? {})
  return (
    <div
      className="space-y-5"
      style={{ backgroundColor: config.theme.background_color }}
    >
      <header>
        <p className="text-[12px] uppercase tracking-wide text-[#6B7280]">
          Qualification
        </p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-[#111827]">
          {page.title}
        </h1>
        {page.description && (
          <p className="mt-1 text-[14px] text-[#6B7280]">{page.description}</p>
        )}
      </header>
      <QualificationClient slug={page.slug} config={config} deeplink={null} />
    </div>
  )
}

function kindCta(kind: ActionPageKind, config?: Record<string, unknown>): string {
  if (kind === 'form') {
    const v = (config as { submit_button_label?: string } | undefined)?.submit_button_label
    return v && v.length > 0 ? v : 'Submit'
  }
  if (kind === 'sales') {
    const v = (config as { cta_label?: string } | undefined)?.cta_label
    return v && v.length > 0 ? v : 'Buy now'
  }
  if (kind === 'booking') return 'Book slot'
  if (kind === 'qualification') return 'Continue'
  if (kind === 'catalog') return 'Add to cart'
  if (kind === 'realestate') return 'Request viewing'
  return 'Submit'
}

function KindMockBody({
  kind,
  config,
}: {
  kind: ActionPageKind
  config?: Record<string, unknown>
}) {
  switch (kind) {
    case 'form': {
      const blocks =
        (config as { blocks?: Array<{ type: string; label?: string; text?: string }> } | undefined)
          ?.blocks ?? []
      const fields = blocks.filter((b) => b.type === 'field').slice(0, 4)
      if (fields.length === 0) {
        return (
          <>
            <MockField label="Your name" />
            <MockField label="Email" />
          </>
        )
      }
      return (
        <>
          {fields.map((f, i) => (
            <MockField key={i} label={f.label ?? 'Field'} />
          ))}
        </>
      )
    }
    case 'booking':
      return (
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className="rounded border border-[#E5E7EB] py-1 text-center text-[10px] text-[#6B7280]"
            >
              {9 + i}:00
            </span>
          ))}
        </div>
      )
    case 'qualification': {
      const questions =
        (config as { questions?: Array<{ prompt: string; options?: Array<{ label: string }> }> } | undefined)
          ?.questions ?? []
      const q = questions[0]
      if (!q) {
        return (
          <>
            <p className="text-[11px] font-medium text-[#374151]">
              Are you the decision maker?
            </p>
            <div className="flex gap-1.5">
              <span className="rounded border border-[#E5E7EB] px-2 py-1 text-[10px]">
                Yes
              </span>
              <span className="rounded border border-[#E5E7EB] px-2 py-1 text-[10px]">
                No
              </span>
            </div>
          </>
        )
      }
      return (
        <>
          <p className="text-[11px] font-medium text-[#374151]">{q.prompt}</p>
          <div className="flex flex-wrap gap-1.5">
            {(q.options ?? []).slice(0, 4).map((o, i) => (
              <span
                key={i}
                className="rounded border border-[#E5E7EB] px-2 py-1 text-[10px]"
              >
                {o.label}
              </span>
            ))}
          </div>
        </>
      )
    }
    case 'sales': {
      const headline =
        (config as { headline?: string; subhead?: string } | undefined)?.headline
      const subhead = (config as { subhead?: string } | undefined)?.subhead
      return (
        <>
          <div className="h-12 rounded bg-[#F3F4F6]" />
          {headline && (
            <p className="text-[11px] font-semibold text-[#111827]">{headline}</p>
          )}
          {subhead && (
            <p className="text-[11px] text-[#6B7280]">{subhead}</p>
          )}
          {!headline && !subhead && (
            <p className="text-[11px] text-[#6B7280]">Pre-templated offer copy.</p>
          )}
        </>
      )
    }
    case 'catalog':
      return (
        <div className="grid grid-cols-2 gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded border border-[#E5E7EB] p-1.5">
              <div className="h-6 rounded bg-[#F3F4F6]" />
              <div className="mt-1 h-1.5 w-2/3 rounded bg-[#E5E7EB]" />
            </div>
          ))}
        </div>
      )
    case 'realestate':
      return (
        <>
          <div className="h-16 rounded bg-[#F3F4F6]" />
          <p className="text-[11px] text-[#6B7280]">
            Property details + viewing slots.
          </p>
        </>
      )
  }
}

function MockField({ label }: { label: string }) {
  return (
    <div>
      <span className="block text-[10px] font-medium text-[#6B7280]">{label}</span>
      <span className="mt-0.5 block h-6 rounded border border-[#E5E7EB] bg-[#F9FAFB]" />
    </div>
  )
}

function IconForm() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  )
}
function IconBooking() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  )
}
function IconQuiz() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7M12 17h.01" />
    </svg>
  )
}
function IconSales() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h18l-2 12H5L3 7z" />
      <path d="M8 7V5a4 4 0 0 1 8 0v2" />
    </svg>
  )
}
function IconCatalog() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="7" height="7" rx="1" />
      <rect x="14" y="4" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}
function IconRealEstate() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2v-9z" />
    </svg>
  )
}
