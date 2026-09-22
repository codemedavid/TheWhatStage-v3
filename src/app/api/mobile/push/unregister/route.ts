import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireMobileUser, mobileError } from '@/lib/mobile/auth'
import { unregisterPushDevice } from '@/lib/push/devices'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({ token: z.string().trim().min(8).max(512) })

/**
 * POST /api/mobile/push/unregister — drop this device on sign-out so the next
 * inbound message does not land on a phone nobody is signed in on.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, admin } = await requireMobileUser(req)
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
    }
    await unregisterPushDevice(admin, { userId, token: parsed.data.token })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return mobileError(err)
  }
}
