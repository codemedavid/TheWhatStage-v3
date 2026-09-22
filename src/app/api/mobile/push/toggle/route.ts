import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireMobileUser, mobileError } from '@/lib/mobile/auth'
import { setPushDeviceEnabled } from '@/lib/push/devices'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  token: z.string().trim().min(8).max(512),
  enabled: z.boolean(),
})

/**
 * POST /api/mobile/push/toggle — per-device mute from the Me screen. Muting
 * keeps the row (and the OS permission) so unmuting needs no re-registration.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, admin } = await requireMobileUser(req)
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
    }
    await setPushDeviceEnabled(admin, { userId, ...parsed.data })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return mobileError(err)
  }
}
