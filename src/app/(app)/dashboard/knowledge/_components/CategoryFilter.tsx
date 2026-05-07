'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { CategoryRow } from '../_lib/queries'
import { setDocumentCategory } from '../actions/documents'

function Pill({
  href,
  active,
  children,
  dropTargetId,
  hoverId,
  onDrop,
  onHover,
  onHoverLeave,
}: {
  href: string
  active: boolean
  children: React.ReactNode
  dropTargetId: string
  hoverId: string | null
  onDrop: (e: React.DragEvent) => void
  onHover: (id: string) => void
  onHoverLeave: () => void
}) {
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
          onHover(dropTargetId)
        }
      }}
      onDragLeave={onHoverLeave}
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pill
        href={link(null)}
        active={selected === null}
        dropTargetId="all"
        hoverId={hoverId}
        onDrop={(e) => {
          // "All" doesn't move anything — just stop the drop.
          e.preventDefault()
          setHoverId(null)
        }}
        onHover={setHoverId}
        onHoverLeave={() => setHoverId(null)}
      >
        All
      </Pill>
      <Pill
        href={link('uncategorized')}
        active={selected === 'uncategorized'}
        dropTargetId="uncategorized"
        hoverId={hoverId}
        onDrop={handleDrop(null)}
        onHover={setHoverId}
        onHoverLeave={() => setHoverId(null)}
      >
        Uncategorized
      </Pill>
      {categories.map((c) => (
        <Pill
          key={c.id}
          href={link(c.id)}
          active={selected === c.id}
          dropTargetId={c.id}
          hoverId={hoverId}
          onDrop={handleDrop(c.id)}
          onHover={setHoverId}
          onHoverLeave={() => setHoverId(null)}
        >
          {c.name}
        </Pill>
      ))}
    </div>
  )
}
