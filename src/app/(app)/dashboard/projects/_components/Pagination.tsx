import Link from 'next/link'
import { PAGE_SIZE } from '../_lib/schemas'

// Sliding-window pager (mirrors the leads board's) scoped to projects so it uses
// the projects PAGE_SIZE — keeping the page math aligned with fetchProjectsPage.
export function Pagination({
  total, page, makeHref,
}: {
  total: number
  page: number
  makeHref: (p: number) => string
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  if (pages <= 1) return null
  const start = Math.max(0, page - 3)
  const window = Array.from({ length: pages }, (_, i) => i + 1).slice(start, start + 5)

  return (
    <nav className="flex items-center justify-end gap-1 text-[12px]">
      <PageLink href={makeHref(Math.max(1, page - 1))} disabled={page === 1} label="Prev" />
      {window.map((p) => (
        <PageLink key={p} href={makeHref(p)} label={String(p)} active={p === page} />
      ))}
      <PageLink href={makeHref(Math.min(pages, page + 1))} disabled={page === pages} label="Next" />
    </nav>
  )
}

function PageLink({
  href, label, active, disabled,
}: {
  href: string
  label: string
  active?: boolean
  disabled?: boolean
}) {
  if (disabled) {
    return (
      <span
        aria-disabled
        className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-full px-2 font-medium opacity-40"
        style={{ color: 'var(--lead-muted)' }}
      >
        {label}
      </span>
    )
  }
  return (
    <Link
      href={href}
      className="lead-focus inline-flex h-7 min-w-[28px] items-center justify-center rounded-full px-2 font-medium transition-colors"
      style={active ? { background: 'var(--lead-accent)', color: '#fff' } : { color: 'var(--lead-body)' }}
    >
      {label}
    </Link>
  )
}
