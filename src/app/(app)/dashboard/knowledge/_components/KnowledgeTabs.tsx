'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/dashboard/knowledge', label: 'Documents', match: 'docs' as const },
  { href: '/dashboard/knowledge/faqs', label: 'FAQs', match: 'faqs' as const },
]

export function KnowledgeTabs({
  rightSlot,
}: {
  rightSlot?: React.ReactNode
}) {
  const pathname = usePathname() ?? ''
  const active: 'docs' | 'faqs' = pathname.startsWith('/dashboard/knowledge/faqs')
    ? 'faqs'
    : 'docs'

  return (
    <div className="flex items-end gap-4 border-b border-[#E5E7EB]">
      <nav className="-mb-px flex gap-6" aria-label="Knowledge sections">
        {tabs.map((t) => {
          const isActive = active === t.match
          return (
            <Link
              key={t.href}
              href={t.href}
              className={
                'relative inline-flex h-10 items-center text-[13.5px] font-medium transition-colors ' +
                (isActive
                  ? 'text-[#059669]'
                  : 'text-[#6B7280] hover:text-[#111827]')
              }
            >
              {t.label}
              <span
                className={
                  'absolute inset-x-0 -bottom-px h-[2px] rounded-full transition-colors ' +
                  (isActive ? 'bg-[#059669]' : 'bg-transparent')
                }
              />
            </Link>
          )
        })}
      </nav>
      {rightSlot && (
        <div className="ml-auto flex items-center gap-2 pb-2">{rightSlot}</div>
      )}
    </div>
  )
}
