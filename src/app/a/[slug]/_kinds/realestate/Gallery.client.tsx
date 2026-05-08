'use client'

import { useState } from 'react'
import type { RealestateGalleryItem } from './schema'

interface Props {
  gallery: RealestateGalleryItem[]
  primaryId: string
}

export default function GalleryClient({ gallery, primaryId }: Props) {
  const [activeId, setActiveId] = useState<string>(primaryId)
  const active = gallery.find((g) => g.id === activeId) ?? gallery[0]
  if (!active) return null

  return (
    <div className="mb-6">
      <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-[#F1F5F9]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={active.url}
          alt={active.alt || 'Property photo'}
          className="aspect-[16/9] w-full object-cover"
        />
      </div>
      {gallery.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {gallery.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setActiveId(g.id)}
              className={`relative h-16 w-24 shrink-0 overflow-hidden rounded-md border transition-colors ${
                g.id === activeId ? 'border-[#0F172A]' : 'border-[#E5E7EB]'
              }`}
              aria-label={g.alt || 'Show photo'}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.url} alt={g.alt ?? ''} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
