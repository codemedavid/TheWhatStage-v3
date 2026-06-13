import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSuperadmin, AdminAuthError } from '@/lib/auth/admin-guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auth/admin-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Records a correction to a tenant's metered usage in the append-only
// usage_adjustments ledger (the frozen llm_usage_events table is never edited).
//  - adjust : apply the signed deltaTokens / deltaCostMicros as given
//  - credit : same, but the UI sends negative deltas (a goodwill reduction)
//  - reset  : zero this Manila-month's net usage (delta = -(metered + prior adj))
const bodySchema = z.object({
  kind: z.enum(['adjust', 'credit', 'reset']),
  deltaTokens: z.number().int().optional(),
  deltaCostMicros: z.number().int().optional(),
  reason: z.string().trim().min(1).max(500),
})

function manilaMonthStartIso(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return `${parts.slice(0, 7)}-01T00:00:00+08:00`
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let session
  try {
    session = await requireSuperadmin()
  } catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }

  const { id } = await ctx.params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid adjustment' }, { status: 400 })
  }
  const { kind, reason } = parsed.data

  const admin = createAdminClient()
  const { data: target } = await admin
    .from('profiles')
    .select('role')
    .eq('id', id)
    .maybeSingle<{ role: string }>()
  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (target.role !== 'user') {
    return NextResponse.json({ error: 'adjustments apply to tenant accounts only' }, { status: 403 })
  }

  let deltaTokens: number
  let deltaCostMicros: number

  if (kind === 'reset') {
    // Net this month = metered ledger + prior adjustments; negate to zero it.
    const monthStart = manilaMonthStartIso()
    const [eventsRes, adjRes] = await Promise.all([
      admin.from('llm_usage_events').select('total_tokens, cost_micros').eq('user_id', id).gte('created_at', monthStart),
      admin.from('usage_adjustments').select('delta_tokens, delta_cost_micros').eq('user_id', id).gte('created_at', monthStart),
    ])
    const usedTokens =
      (eventsRes.data ?? []).reduce((s, r) => s + Number(r.total_tokens ?? 0), 0) +
      (adjRes.data ?? []).reduce((s, r) => s + Number(r.delta_tokens ?? 0), 0)
    const usedCost =
      (eventsRes.data ?? []).reduce((s, r) => s + Number(r.cost_micros ?? 0), 0) +
      (adjRes.data ?? []).reduce((s, r) => s + Number(r.delta_cost_micros ?? 0), 0)
    deltaTokens = -usedTokens
    deltaCostMicros = -usedCost
  } else {
    if (parsed.data.deltaTokens == null) {
      return NextResponse.json({ error: 'deltaTokens required' }, { status: 400 })
    }
    deltaTokens = parsed.data.deltaTokens
    deltaCostMicros = parsed.data.deltaCostMicros ?? 0
  }

  const { data, error } = await admin
    .from('usage_adjustments')
    .insert({
      user_id: id,
      delta_tokens: deltaTokens,
      delta_cost_micros: deltaCostMicros,
      reason,
      kind,
      actor_id: session.userId,
    })
    .select('id, delta_tokens, delta_cost_micros, kind, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(admin, {
    actorId: session.userId,
    actorEmail: session.email,
    action: 'usage.adjust',
    targetUserId: id,
    detail: { kind, deltaTokens, deltaCostMicros, reason },
  })

  return NextResponse.json(data)
}
