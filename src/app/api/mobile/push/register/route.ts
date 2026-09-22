import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireMobileUser, mobileError } from '@/lib/mobile/auth'
import { registerPushDevice, PUSH_PLATFORMS } from '@/lib/push/devices'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  // "ExponentPushToken[...]" in practice; the length bounds mirror the column
  // check so a malformed token is rejected here rather than by Postgres.
  token: z.string().trim().min(8).max(512),
  platform: z.enum(PUSH_PLATFORMS),
  deviceName: z.string().trim().max(120).nullish(),
})

/** POST /api/mobile/push/register — claim this device for the signed-in user. */
export async function POST(req: NextRequest) {
  try {
    const { userId, admin } = await requireMobileUser(req)
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
    }
    const { enabled } = await registerPushDevice(admin, { userId, ...parsed.data })
    return NextResponse.json({ ok: true, enabled })
  } catch (err) {
    return mobileError(err)
  }
}
