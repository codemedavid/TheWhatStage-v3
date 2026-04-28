import Link from 'next/link'
import { PAGE_SIZE } from '../_lib/schemas'

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
    <nav className="flex items-center gap-2 text-sm">
      <Link
        href={makeHref(Math.max(1, page - 1))}
        className="px-2 py-1 border rounded"
        aria-disabled={page === 1}
      >
        Prev
      </Link>
      {window.map((p) => (
        <Link
          key={p}
          href={makeHref(p)}
          className={`px-2 py-1 border rounded ${p === page ? 'bg-emerald-600 text-white' : ''}`}
        >
          {p}
        </Link>
      ))}
      <Link
        href={makeHref(Math.min(pages, page + 1))}
        className="px-2 py-1 border rounded"
        aria-disabled={page === pages}
      >
        Next
      </Link>
    </nav>
  )
}
