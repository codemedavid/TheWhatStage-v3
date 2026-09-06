import Link from 'next/link'
import type { ReactNode } from 'react'

// Matches the sign-in screen's palette so the consent step feels like part of
// the same login journey.
export function OAuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#F5F1E8] px-4 py-10 text-[#1F1E1D]">
      <Link
        href="/"
        className="mb-8 inline-flex items-center gap-3 font-[family-name:var(--font-instrument-serif)] text-[22px] tracking-tight"
      >
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#1F1E1D] pb-[2px] font-[family-name:var(--font-instrument-serif)] text-[19px] italic leading-none text-[#FBF8F1]">
          W
        </span>
        WhatStage
      </Link>
      <div className="w-full max-w-[440px] rounded-2xl border border-[#E5DFD0] bg-white p-8 shadow-[0_12px_40px_-24px_rgba(31,30,29,0.35)]">
        {children}
      </div>
    </main>
  )
}
