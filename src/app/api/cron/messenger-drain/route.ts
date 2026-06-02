import { after, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Surface a spike of terminally-failed jobs (e.g. a Meta/OpenRouter outage that
// exhausted retries on many replies at once) — the single largest blind spot
// against guaranteed delivery, since `failed` rows are otherwise invisible.
const FAILED_ALERT_WINDOW_MIN = 15
const FAILED_ALERT_THRESHOLD = 10

/**
 * Supabase Cron safety net. Fires the messenger worker via internal POST,
 * fire-and-forget through `after()` so this cron route returns fast and
 * the actual drain runs on the worker invocation's own 300s budget.
 *
 * Primary path is still the per-webhook `triggerWorker()` from the FB
 * webhook handler — this cron exists for cases where webhooks burst-fail
 * or the queue accumulates while the worker invocations were maxed out.
 *
 * Authentication: scheduled requests send `Authorization: Bearer ${CRON_SECRET}`;
 * we verify it to keep ad-hoc external calls out.
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
    // Best-effort failed-job spike alert (never blocks the drain).
    try {
      const admin = createAdminClient()
      const since = new Date(Date.now() - FAILED_ALERT_WINDOW_MIN * 60_000).toISOString()
      const { count } = await admin
        .from('messenger_jobs')
        .select('id', { head: true, count: 'exact' })
        .eq('status', 'failed')
        .gte('finished_at', since)
      if ((count ?? 0) >= FAILED_ALERT_THRESHOLD) {
        console.error(
          `[cron.messenger-drain] ${count} failed jobs in last ${FAILED_ALERT_WINDOW_MIN}m`,
        )
        Sentry.captureMessage(
          `[messenger] ${count} jobs failed in the last ${FAILED_ALERT_WINDOW_MIN} minutes`,
          'error',
        )
      }
    } catch (e) {
      console.warn('[cron.messenger-drain] failed-job count check errored', e)
    }

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
