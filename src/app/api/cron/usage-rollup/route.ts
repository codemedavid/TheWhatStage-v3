import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Supabase Cron entry point (Phase 2 — usage-based billing).
 * Recomputes usage_daily from the llm_usage_events ledger by calling the
 * rollup_llm_usage_daily() Postgres function. Scheduled hourly from pg_cron.
 *
 * Auth mirrors the other /api/cron routes: in production we require the cron
 * bearer token; in dev any caller is allowed for easy manual triggering.
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

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('rollup_llm_usage_daily')
  if (error) {
    console.error('[cron.usage-rollup] rollup failed', error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, rowsUpserted: data ?? 0 })
}
