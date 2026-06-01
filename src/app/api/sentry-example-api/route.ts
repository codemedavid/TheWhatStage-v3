import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

class SentryExampleAPIError extends Error {
  constructor(message: string | undefined) {
    super(message)
    this.name = 'SentryExampleAPIError'
  }
}

// Throws on purpose so Sentry captures a backend error (with tracing connected
// to the frontend span). Delete this route after verifying your setup.
export function GET() {
  throw new SentryExampleAPIError('This error is raised on the backend called by the example page.')
  return NextResponse.json({ data: 'Testing Sentry Error...' })
}
