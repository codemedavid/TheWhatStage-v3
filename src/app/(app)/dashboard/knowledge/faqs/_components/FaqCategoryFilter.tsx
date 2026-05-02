'use client'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { CategoryRow } from '../../_lib/queries'

export function FaqCategoryFilter({
  categories,
}: {
  categories: CategoryRow[]
}) {
  const sp = useSearchParams()
  const selected = sp.get('category')

  const link = (value: string | null) => {
    const next = new URLSearchParams(sp)
    if (value === null) next.delete('category')
    else next.set('category', value)
    const qs = next.toString()
    return qs ? `/dashboard/knowledge/faqs?${qs}` : '/dashboard/knowledge/faqs'
  }

  const Pill = ({
    href,
    active,
    children,
  }: {
    href: string
    active: boolean
    children: React.ReactNode
  }) => (
    <Link
      href={href}
      className={
        'inline-flex h-7 items-center rounded-full px-3 text-[12.5px] font-medium transition-colors ' +
        (active
          ? 'bg-[rgba(5,150,105,0.1)] text-[#059669]'
          : 'border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB]')
      }
    >
      {children}
    </Link>
  )

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pill href={link(null)} active={selected === null}>
        All
      </Pill>
      <Pill href={link('uncategorized')} active={selected === 'uncategorized'}>
        Uncategorized
      </Pill>
      {categories.map((c) => (
        <Pill key={c.id} href={link(c.id)} active={selected === c.id}>
          {c.name}
        </Pill>
      ))}
    </div>
  )
}
