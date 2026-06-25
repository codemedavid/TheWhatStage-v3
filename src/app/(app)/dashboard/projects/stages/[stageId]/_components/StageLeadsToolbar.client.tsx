'use client'
import { useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

const SORTS: { value: string; label: string }[] = [
  { value: 'recent', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'title_asc', label: 'Title A–Z' },
  { value: 'value_desc', label: 'Value: high → low' },
]

const fieldStyle = { borderColor: 'var(--lead-line)', background: 'var(--lead-surface)', color: 'var(--lead-ink)' } as const

// Search + sort for the stage's leads list. Pushes URL params (server-driven
// filtering, like the leads board) and resets to page 1 on any change.
export function StageLeadsToolbar({ q, sort }: { q: string; sort: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [text, setText] = useState(q)

  const push = (next: Record<string, string>) => {
    const sp = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v)
      else sp.delete(k)
    }
    sp.delete('page') // any filter change returns to the first page
    const qs = sp.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div className="flex items-center gap-2">
      <form onSubmit={(e) => { e.preventDefault(); push({ q: text.trim() }) }} className="flex-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search deals in this stage…"
          aria-label="Search deals in this stage"
          className="w-full rounded-md border px-2.5 py-1.5 text-[13px]"
          style={fieldStyle}
        />
      </form>
      <select
        value={sort}
        onChange={(e) => push({ sort: e.target.value })}
        aria-label="Sort deals"
        className="rounded-md border px-2 py-1.5 text-[12.5px]"
        style={fieldStyle}
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
    </div>
  )
}
