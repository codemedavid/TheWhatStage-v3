import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireMobileUser, mobileError } from '@/lib/mobile/auth'
import { moveLeadToStage } from '@/lib/leads/move-stage'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  leadId: z.string().uuid(),
  toStageId: z.string().uuid(),
  reason: z.string().trim().max(200).optional(),
})

/**
 * POST /api/mobile/leads/move — audited stage move.
 *
 * Goes through the set_lead_stage RPC (service role) so the move lands in
 * lead_stage_events and bumps version/entered_stage_at, unlike the web
 * board's bare update.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, admin } = await requireMobileUser(req)
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
    }
    const { leadId, toStageId, reason } = parsed.data

    // Ownership check: the RPC is security definer, so guard here.
    const [{ data: lead }, { data: stage }] = await Promise.all([
      admin.from('leads').select('id').eq('id', leadId).eq('user_id', userId).maybeSingle(),
      admin.from('pipeline_stages').select('id').eq('id', toStageId).eq('user_id', userId).maybeSingle(),
    ])
    if (!lead || !stage) {
      return NextResponse.json({ ok: false, error: 'lead or stage not found' }, { status: 404 })
    }

    const moved = await moveLeadToStage(admin, {
      leadId,
      toStageId,
      source: 'user',
      reason: reason || 'moved from mobile',
      matchedSignals: [],
    })
    if (!moved) return NextResponse.json({ ok: false, error: 'move failed' }, { status: 409 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return mobileError(err)
  }
}
