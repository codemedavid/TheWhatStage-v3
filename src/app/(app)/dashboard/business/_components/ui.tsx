import type { ReactNode } from 'react'

type Tone = 'gray' | 'green' | 'amber' | 'red' | 'blue'

const toneStyles: Record<Tone, string> = {
  gray: 'bg-[#F3F4F6] text-[#374151] ring-[#E5E7EB]',
  green: 'bg-[#ECFDF5] text-[#047857] ring-[#A7F3D0]',
  amber: 'bg-[#FFFBEB] text-[#B45309] ring-[#FDE68A]',
  red: 'bg-[#FEF2F2] text-[#B91C1C] ring-[#FECACA]',
  blue: 'bg-[#EFF6FF] text-[#1D4ED8] ring-[#BFDBFE]',
}

export function StatusBadge({
  children,
  tone = 'gray',
}: {
  children: ReactNode
  tone?: Tone
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${toneStyles[tone]}`}
    >
      <span className={`size-1.5 rounded-full bg-current opacity-70`} />
      {children}
    </span>
  )
}

export function productStatusTone(status: string): Tone {
  if (status === 'published') return 'green'
  if (status === 'draft') return 'gray'
  if (status === 'archived') return 'amber'
  return 'gray'
}

export function orderStatusTone(status: string): Tone {
  if (status === 'fulfilled') return 'green'
  if (status === 'confirmed') return 'blue'
  if (status === 'cancelled') return 'red'
  if (status === 'new') return 'amber'
  return 'gray'
}

export function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_0_rgba(17,24,39,0.04)]">
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-[#F3F4F6] px-5 py-4">
          <div>
            {title && <h2 className="text-[14px] font-semibold text-[#111827]">{title}</h2>}
            {description && <p className="mt-0.5 text-[12.5px] text-[#6B7280]">{description}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white px-5 py-4 shadow-[0_1px_0_rgba(17,24,39,0.04)]">
      <div className="text-[12px] font-medium uppercase tracking-wide text-[#6B7280]">{label}</div>
      <div className="mt-1.5 text-[24px] font-semibold tabular-nums text-[#111827]">{value}</div>
      {hint && <div className="mt-1 text-[12px] text-[#9CA3AF]">{hint}</div>}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  back,
  actions,
}: {
  title: string
  description?: string
  back?: { href: string; label: string }
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-[#E5E7EB] pb-5 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {back && (
          <a
            href={back.href}
            className="mb-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-[#6B7280] hover:text-[#111827]"
          >
            <span aria-hidden>←</span> {back.label}
          </a>
        )}
        <h1 className="truncate text-[22px] font-semibold tracking-[-0.01em] text-[#111827]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-[13.5px] text-[#6B7280]">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
