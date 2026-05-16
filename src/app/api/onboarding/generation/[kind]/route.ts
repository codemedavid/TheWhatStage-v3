import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getJob, sweepStaleForProfile } from '@/lib/onboarding/generation/repo'
import { isGenerationKind } from '@/lib/onboarding/generation/types'

export const dynamic = 'force-dynamic'

const STALE_AFTER_MS = 90_000

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ kind: string }> },
): Promise<NextResponse> {
  const { kind } = await ctx.params
  if (!isGenerationKind(kind)) {
    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let job = await getJob(auth.user.id, kind)

  // Only sweep when something is actually stale. The poll storms otherwise:
  // the gate hits this endpoint ~17x per 60s generation and almost every
  // sweep was a no-op UPDATE.
  const isStale =
    job?.status === 'running' &&
    !!job.started_at &&
    Date.now() - new Date(job.started_at).getTime() > STALE_AFTER_MS
  if (isStale) {
    await sweepStaleForProfile(auth.user.id)
    job = await getJob(auth.user.id, kind)
  }

  if (!job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const body: Record<string, unknown> = {
    status: job.status,
    updatedAt: job.updated_at,
  }
  if (job.status === 'done') body.result = job.result
  if (job.status === 'failed') body.error = job.error ?? 'unknown_error'

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
