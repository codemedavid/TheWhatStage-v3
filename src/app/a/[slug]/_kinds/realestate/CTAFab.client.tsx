'use client'

import { useState, useEffect, useCallback, useRef, useId, type ReactNode } from 'react'
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
  const titleId = useId()

  const childArray = Array.isArray(children) ? children : [children]

  // Fix #1 — scroll lock
  useEffect(() => {
    if (activeIndex === null) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [activeIndex])

  // Fix #1 — hide "Next Steps" section while modal is open (eliminates duplicate DOM IDs)
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-next-steps]')
    if (!el) return
    if (activeIndex !== null) {
      el.style.display = 'none'
      el.setAttribute('aria-hidden', 'true')
    } else {
      el.style.display = ''
      el.removeAttribute('aria-hidden')
    }
    return () => {
      el.style.display = ''
      el.removeAttribute('aria-hidden')
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

  // Fix #5 — simple focus trap inside dialog
  const trapFocus = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    if (!focusable || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

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
      {/* Fix #3 — transparent sentinel backdrop behind pill menu */}
      {expanded && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => setExpanded(false)}
          aria-hidden="true"
        />
      )}

      {/* FAB + expand menu */}
      <div className="fixed bottom-6 right-6 z-30 flex flex-col items-end gap-3">
        {/* Fix #4 — id on expand menu for aria-controls */}
        {expanded && (
          <div id="fab-pill-menu" className="flex flex-col items-end gap-2">
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

        {/* Fix #4 — aria-controls on FAB button */}
        <button
          type="button"
          onClick={handleFabClick}
          aria-label="Property actions"
          aria-expanded={expanded}
          aria-controls="fab-pill-menu"
          className="flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition hover:scale-105 active:scale-95"
          style={{ background: accent }}
        >
          <span
            aria-hidden="true"
            className="text-xl text-white transition-transform duration-200"
            style={{
              display: 'inline-block',
              // Fix #6 — use rotate(0deg) instead of 'none' so Safari transition works
              transform: expanded ? 'rotate(45deg)' : 'rotate(0deg)',
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
            aria-labelledby={titleId}
            onKeyDown={trapFocus}
            className="fixed bottom-0 left-0 right-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white shadow-xl lg:bottom-auto lg:left-1/2 lg:right-auto lg:top-1/2 lg:w-full lg:max-w-lg lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-2xl"
          >
            {/* Drag handle (mobile only) */}
            <div className="flex justify-center pt-3 lg:hidden">
              <div className="h-1 w-9 rounded-full bg-[#E2E8F0]" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#F1F5F9] px-5 py-4">
              {/* Fix #7 — useId-generated title ID */}
              <h2 id={titleId} className="text-[15px] font-semibold text-[#0F172A]">
                {pages[activeIndex]?.title}
              </h2>
              {/* Fix #2 — larger touch target on close button */}
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="flex h-10 w-10 items-center justify-center rounded-md text-xl leading-none text-[#94A3B8] hover:text-[#475569]"
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
