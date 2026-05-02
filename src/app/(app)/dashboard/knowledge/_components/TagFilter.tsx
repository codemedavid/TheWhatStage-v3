'use client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { TagRow } from '../_lib/queries'

export function TagFilter({ tags }: { tags: TagRow[] }) {
  const sp = useSearchParams()
  const selected = sp.get('tag')

  if (tags.length === 0) return null

  const link = (value: string | null) => {
    const next = new URLSearchParams(sp)
    if (value === null) next.delete('tag')
    else next.set('tag', value)
    const qs = next.toString()
    return qs ? `/dashboard/knowledge?${qs}` : '/dashboard/knowledge'
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11.5px] uppercase tracking-wide text-[#9aa0a6]">
        Tags
      </span>
      <Link
        href={link(null)}
        className={
          'inline-flex h-6 items-center rounded-full px-2 text-[11.5px] ' +
          (selected === null
            ? 'bg-[#3c4043] text-white'
            : 'border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB]')
        }
      >
        All
      </Link>
      {tags.map((t) => (
        <Link
          key={t.id}
          href={link(t.id)}
          className={
            'inline-flex h-6 items-center rounded-full px-2 text-[11.5px] ' +
            (selected === t.id
              ? 'bg-[#3c4043] text-white'
              : 'border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB]')
          }
        >
          #{t.name}
        </Link>
      ))}
    </div>
  )
}
