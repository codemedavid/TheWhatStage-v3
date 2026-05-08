'use client'

import { useEffect, useState } from 'react'

export function SalesRevealForm({
  ctaLabel,
  accent,
  ctaFg,
  children,
}: {
  ctaLabel: string
  accent: string
  ctaFg: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (window.location.hash === '#convert') setOpen(true)
    const onHash = () => {
      if (window.location.hash === '#convert') setOpen(true)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-md px-5 py-3 text-[15px] font-semibold shadow-sm"
        style={{ backgroundColor: accent, color: ctaFg }}
      >
        {ctaLabel}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
        >
          <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
              <h3 className="text-[15px] font-semibold text-[#111827]">
                {ctaLabel}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[#6B7280] hover:bg-[#F3F4F6]"
                aria-label="Close"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5">{children}</div>
          </div>
        </div>
      )}
    </>
  )
}
