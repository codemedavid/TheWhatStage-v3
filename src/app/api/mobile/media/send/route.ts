import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireMobileUser, mobileError } from '@/lib/mobile/auth'
import { sendMediaAssetFor } from '@/lib/media/operator-send'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  leadId: z.string().uuid(),
  assetId: z.string().uuid(),
})

/** POST /api/mobile/media/send — send one media-library asset as the operator. */
export async function POST(req: NextRequest) {
  try {
    const { userId, admin } = await requireMobileUser(req)
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
    }
    const { leadId, assetId } = parsed.data
    const result = await sendMediaAssetFor(admin, userId, leadId, assetId)
    return NextResponse.json(result, { status: result.ok ? 200 : 422 })
  } catch (err) {
    return mobileError(err)
  }
}
