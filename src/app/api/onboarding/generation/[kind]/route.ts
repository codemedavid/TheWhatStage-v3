import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getJob,
  getJobStatus,
  sweepStaleForProfile,
} from '@/lib/onboarding/generation/repo'
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

  let status = await getJobStatus(auth.user.id, kind)

  const isStale =
    status?.status === 'running' &&
    !!status.started_at &&
    Date.now() - new Date(status.started_at).getTime() > STALE_AFTER_MS
  if (isStale) {
    await sweepStaleForProfile(auth.user.id)
    status = await getJobStatus(auth.user.id, kind)
  }

  if (!status) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const body: Record<string, unknown> = {
    status: status.status,
    updatedAt: status.updated_at,
  }
  if (status.status === 'failed') body.error = status.error ?? 'unknown_error'

  // Only fetch the (potentially multi-KB) result JSONB on the terminal
  // transition. The gate redirects via router.refresh() on done, so the
  // result lands via the RSC page render anyway — but we expose it here
  // too in case a future caller needs it inline.
  if (status.status === 'done') {
    const full = await getJob(auth.user.id, kind)
    if (full?.result !== undefined) body.result = full.result
  }

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
