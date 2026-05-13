/*
 * pg_cron scheduling SQL (run once in Supabase Studio — do NOT execute here):
 *
 * select cron.schedule(
 *   'leads-dormant-sweep-daily',
 *   '0 3 * * *',
 *   $$
 *     select net.http_get(
 *       url := current_setting('app.cron_base_url') || '/api/cron/leads-dormant-sweep',
 *       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_secret'))
 *     );
 *   $$
 * );
 *
 * Confirm with: select * from cron.job where jobname = 'leads-dormant-sweep-daily';
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runDormantSweepForAllUsers } from '@/lib/leads/dormant-sweeper'
import { runSuggestionHousekeeping } from '@/lib/leads/suggestion-housekeeping'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  const isDev = process.env.NODE_ENV !== 'production'
  if (!isDev) {
    const auth = req.headers.get('authorization')
    const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
    if (!process.env.CRON_SECRET || auth !== expected) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  try {
    const admin = createAdminClient()
    const moved = await runDormantSweepForAllUsers(admin)
    const housekeeping = await runSuggestionHousekeeping(admin)
    return NextResponse.json({ ok: true, moved, housekeeping })
  } catch (err) {
    console.error('[cron.leads-dormant-sweep] crashed', { err: (err as Error).message })
    return NextResponse.json({ ok: false, err: (err as Error).message }, { status: 500 })
  }
}
