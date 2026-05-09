'use client'

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import type { ActionPageKind } from '@/lib/action-pages/kinds'

type PageMeta = {
  id: string
  kind: ActionPageKind
  title: string
  cta_label: string | null
}

function getFabButtonLabel(page: PageMeta): string {
  return page.cta_label ?? page.title
}

const KIND_ICONS: Partial<Record<ActionPageKind, string>> = {
  booking: '📅',
  form: '📋',
  qualification: '🎯',
}
function getKindIcon(kind: ActionPageKind): string {
  return KIND_ICONS[kind] ?? '📋'
}

export default function CTAFab({
  pages,
  accent,
  children,
}: {
  pages: PageMeta[]
  accent: string
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const childArray = Array.isArray(children) ? children : [children]

  useEffect(() => {
    if (activeIndex === null) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [activeIndex])

  useEffect(() => {
    if (activeIndex !== null) {
      dialogRef.current?.focus()
    }
  }, [activeIndex])

  const close = useCallback(() => {
    setActiveIndex(null)
    setExpanded(false)
  }, [])

  useEffect(() => {
    if (activeIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeIndex, close])

  const handleFabClick = () => {
    if (pages.length === 1) {
      setActiveIndex(0)
      setExpanded(false)
    } else {
      setExpanded((prev) => !prev)
    }
  }

  if (pages.length === 0) return null

  return (
    <>
      {/* FAB + expand menu */}
      <div className="fixed bottom-6 right-6 z-30 flex flex-col items-end gap-3">
        {expanded && (
          <div className="flex flex-col items-end gap-2">
            {pages.map((page, idx) => (
              <button
                type="button"
                key={page.id}
                onClick={() => {
                  setActiveIndex(idx)
                  setExpanded(false)
                }}
                className="flex items-center gap-2 rounded-full border border-[#E2E8F0] bg-white px-4 py-2 text-[13px] font-medium text-[#1E293B] shadow-md transition hover:shadow-lg"
              >
                <span aria-hidden="true">{getKindIcon(page.kind)}</span>
                {getFabButtonLabel(page)}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={handleFabClick}
          aria-label="Property actions"
          aria-expanded={expanded}
          className="flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition hover:scale-105 active:scale-95"
          style={{ background: accent }}
        >
          <span
            aria-hidden="true"
            className="text-xl text-white transition-transform duration-200"
            style={{
              display: 'inline-block',
              transform: expanded ? 'rotate(45deg)' : 'none',
            }}
          >
            ✦
          </span>
        </button>
      </div>

      {/* Bottom sheet (mobile) / Centered modal (desktop) */}
      {activeIndex !== null && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={close}
            aria-hidden="true"
          />

          {/* Sheet */}
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="fab-dialog-title"
            className="fixed bottom-0 left-0 right-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white shadow-xl lg:bottom-auto lg:left-1/2 lg:right-auto lg:top-1/2 lg:w-full lg:max-w-lg lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-2xl"
          >
            {/* Drag handle (mobile only) */}
            <div className="flex justify-center pt-3 lg:hidden">
              <div className="h-1 w-9 rounded-full bg-[#E2E8F0]" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#F1F5F9] px-5 py-4">
              <h2 id="fab-dialog-title" className="text-[15px] font-semibold text-[#0F172A]">
                {pages[activeIndex]?.title}
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="text-xl leading-none text-[#94A3B8] hover:text-[#475569]"
              >
                ✕
              </button>
            </div>

            {/* Body — server-rendered form/booking/qualification */}
            <div>
              {childArray[activeIndex] ?? (
                <p className="p-5 text-sm text-[#94A3B8]">Content unavailable</p>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
