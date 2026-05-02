'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { CategoryRow } from '../_lib/queries'
import { setDocumentCategory } from '../actions/documents'

export function CategoryFilter({ categories }: { categories: CategoryRow[] }) {
  const router = useRouter()
  const sp = useSearchParams()
  const selected = sp.get('category')
  const [hoverId, setHoverId] = useState<string | null>(null)

  const link = (value: string | null) => {
    const next = new URLSearchParams(sp)
    if (value === null) next.delete('category')
    else next.set('category', value)
    const qs = next.toString()
    return qs ? `/dashboard/knowledge?${qs}` : '/dashboard/knowledge'
  }

  const handleDrop =
    (categoryId: string | null) => async (e: React.DragEvent) => {
      e.preventDefault()
      const docId = e.dataTransfer.getData('application/x-knowledge-doc-id')
      setHoverId(null)
      if (!docId) return
      try {
        await setDocumentCategory({ id: docId, categoryId })
        router.refresh()
      } catch {
        // surface silently — the list will not move; safe.
      }
    }

  const Pill = ({
    href,
    active,
    children,
    dropTargetId,
    onDrop,
  }: {
    href: string
    active: boolean
    children: React.ReactNode
    dropTargetId: string
    onDrop: (e: React.DragEvent) => void
  }) => {
    const hovered = hoverId === dropTargetId
    return (
      <Link
        href={href}
        onDragOver={(e) => {
          if (
            e.dataTransfer.types.includes('application/x-knowledge-doc-id')
          ) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setHoverId(dropTargetId)
          }
        }}
        onDragLeave={() => setHoverId(null)}
        onDrop={onDrop}
        className={
          'inline-flex h-7 items-center rounded-full px-3 text-[12.5px] font-medium transition-colors ' +
          (hovered
            ? 'border border-[#059669] bg-[rgba(5,150,105,0.18)] text-[#059669]'
            : active
            ? 'bg-[rgba(5,150,105,0.1)] text-[#059669]'
            : 'border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB]')
        }
      >
        {children}
      </Link>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pill
        href={link(null)}
        active={selected === null}
        dropTargetId="all"
        onDrop={(e) => {
          // "All" doesn't move anything — just stop the drop.
          e.preventDefault()
          setHoverId(null)
        }}
      >
        All
      </Pill>
      <Pill
        href={link('uncategorized')}
        active={selected === 'uncategorized'}
        dropTargetId="uncategorized"
        onDrop={handleDrop(null)}
      >
        Uncategorized
      </Pill>
      {categories.map((c) => (
        <Pill
          key={c.id}
          href={link(c.id)}
          active={selected === c.id}
          dropTargetId={c.id}
          onDrop={handleDrop(c.id)}
        >
          {c.name}
        </Pill>
      ))}
    </div>
  )
}
