'use client'

import { useState } from 'react'

interface GalleryItem {
  id: string
  url: string
  alt: string
}

export function SalesGalleryClient({
  gallery,
  accent,
  showHeading = true,
  className = 'mt-10',
}: {
  gallery: GalleryItem[]
  accent: string
  showHeading?: boolean
  className?: string
}) {
  const [activeIdx, setActiveIdx] = useState(0)
  if (gallery.length === 0) return null
  const active = gallery[activeIdx] ?? gallery[0]!

  return (
    <section className={className}>
      {showHeading && (
        <h2 className="mb-4 text-[20px] font-semibold text-[#111827]">
          Gallery
        </h2>
      )}
      <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={active.url}
          alt={active.alt || ''}
          className="aspect-[21/9] w-full object-cover"
        />
      </div>
      {gallery.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {gallery.map((g, i) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setActiveIdx(i)}
              className="overflow-hidden rounded-md border-2 transition-all"
              style={{
                borderColor: i === activeIdx ? accent : '#E5E7EB',
              }}
              aria-label={`Show image ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={g.url}
                alt={g.alt || ''}
                className="h-16 w-20 object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
