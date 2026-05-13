/*
 * pg_cron scheduling SQL (run once in Supabase Studio):
 *
 * select cron.schedule(
 *   'stage-suggestions-tick',
 *   '* * * * *',
 *   $$
 *     select net.http_get(
 *       url := current_setting('app.cron_base_url') || '/api/cron/stage-suggestions-tick',
 *       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_secret'))
 *     );
 *   $$
 * );
 */

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runSuggesterForUser } from '@/lib/leads/stage-suggester';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  const isDev = process.env.NODE_ENV !== 'production';
  if (!isDev) {
    const auth = req.headers.get('authorization');
    const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
    if (!process.env.CRON_SECRET || auth !== expected) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // Claim up to 20 due jobs.
  const { data: due } = await admin
    .from('stage_suggestion_jobs')
    .select('user_id')
    .eq('status', 'queued')
    .lte('run_at', nowIso)
    .limit(20);

  let processed = 0;
  for (const j of (due ?? []) as { user_id: string }[]) {
    // Mark running, idempotently (best-effort lock).
    const { error: lockErr } = await admin
      .from('stage_suggestion_jobs')
      .update({ status: 'running' })
      .eq('user_id', j.user_id)
      .eq('status', 'queued');
    if (lockErr) continue;

    try {
      await runSuggesterForUser(admin, j.user_id);
      processed++;
    } catch (err) {
      console.warn('[stage-suggestions-tick] failed', { user_id: j.user_id, err });
      await admin.from('stage_suggestion_jobs').update({ status: 'idle' }).eq('user_id', j.user_id);
    }
  }

  return NextResponse.json({ ok: true, processed });
}
