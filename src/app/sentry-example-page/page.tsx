'use client'

import * as Sentry from '@sentry/nextjs'
import { useState } from 'react'

class SentryExampleFrontendError extends Error {
  constructor(message: string | undefined) {
    super(message)
    this.name = 'SentryExampleFrontendError'
  }
}

// Visit /sentry-example-page and click the button to verify Sentry is wired up.
// Delete this route once you've confirmed errors show up in your Sentry dashboard.
export default function SentryExamplePage() {
  const [hasSentError, setHasSentError] = useState(false)

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F9FAFB]">
      <div className="rounded-xl border border-[#E5E7EB] bg-white px-8 py-10 max-w-md w-full text-center">
        <h1 className="text-[18px] font-semibold text-[#111827]">Sentry test</h1>
        <p className="mt-2 text-[13px] text-[#6B7280]">
          Click below to throw both a frontend and a backend error and send them to Sentry.
        </p>
        <button
          type="button"
          className="mt-6 rounded-md bg-[#111827] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#1F2937]"
          onClick={async () => {
            await Sentry.startSpan(
              { name: 'Example Frontend/Backend Span', op: 'test' },
              async () => {
                const res = await fetch('/api/sentry-example-api')
                if (!res.ok) {
                  setHasSentError(true)
                }
                // This throws an unhandled error captured by Sentry.
                throw new SentryExampleFrontendError('This error is raised on the frontend of the example page.')
              },
            )
          }}
        >
          Throw test error
        </button>
        {hasSentError ? (
          <p className="mt-4 text-[12px] text-[#16A34A]">
            Errors sent — check your Sentry Issues dashboard.
          </p>
        ) : null}
      </div>
    </div>
  )
}
