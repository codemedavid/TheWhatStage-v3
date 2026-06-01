'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

// Catches errors thrown in the root layout/template. Must render its own
// <html> and <body> because it replaces the root layout when it triggers.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body>
        <div className="min-h-screen flex items-center justify-center bg-[#F9FAFB]">
          <div className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-8 py-10 max-w-md w-full text-center">
            <p className="text-[15px] font-medium text-[#991B1B]">Something went wrong</p>
            <p className="mt-2 text-[13px] text-[#B91C1C]">
              {error.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={reset}
              className="mt-6 rounded-md bg-[#111827] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#1F2937]"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
