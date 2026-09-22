import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireMobileUser, mobileError } from '@/lib/mobile/auth'
import { moveProjectFor, nextStagePosition } from '@/app/(app)/dashboard/projects/_lib/mutations'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  projectId: z.string().uuid(),
  toStageId: z.string().uuid(),
})

/**
 * POST /api/mobile/projects/move — same path as the web board's moveProject,
 * so the stage event is written and follow-up sequences are re-seeded.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, admin } = await requireMobileUser(req)
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
    }
    const { projectId, toStageId } = parsed.data
    const position = await nextStagePosition(admin, userId, toStageId)
    const result = await moveProjectFor(admin, userId, projectId, toStageId, position, {
      source: 'user',
      reason: 'moved from mobile',
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return mobileError(err)
  }
}
