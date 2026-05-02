import { after, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Vercel Cron safety net. Fires the messenger worker via internal POST,
 * fire-and-forget through `after()` so this cron route returns fast and
 * the actual drain runs on the worker invocation's own 300s budget.
 *
 * Primary path is still the per-webhook `triggerWorker()` from the FB
 * webhook handler — this cron exists for cases where webhooks burst-fail
 * or the queue accumulates while the worker invocations were maxed out.
 *
 * Authentication: Vercel sets `Authorization: Bearer ${CRON_SECRET}` on
 * scheduled requests; we verify it to keep ad-hoc external calls out.
 */
export async function GET(req: Request) {
  const isDev = process.env.NODE_ENV !== 'production'
  if (!isDev) {
    const auth = req.headers.get('authorization')
    const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
    if (!process.env.CRON_SECRET || auth !== expected) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  const base = process.env.NEXT_PUBLIC_APP_URL
  const secret = process.env.MESSENGER_WORKER_SECRET
  if (!base || !secret) {
    return NextResponse.json(
      { fired: false, reason: 'NEXT_PUBLIC_APP_URL or MESSENGER_WORKER_SECRET missing' },
      { status: 200 },
    )
  }

  // Fire-and-forget via after() — same pattern as the FB webhook trigger.
  after(async () => {
    try {
      await fetch(`${base}/api/messenger/process`, {
        method: 'POST',
        headers: { 'x-worker-secret': secret },
      })
    } catch (e) {
      console.warn('[cron.messenger-drain] worker trigger failed', e)
    }
  })

  return NextResponse.json({ fired: true })
}
