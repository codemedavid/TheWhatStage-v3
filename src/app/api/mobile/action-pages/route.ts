import { NextResponse, type NextRequest } from 'next/server'
import { requireMobileUser, mobileError } from '@/lib/mobile/auth'
import { listSendableActionPagesFor } from '@/lib/messenger/operator-send'

export const dynamic = 'force-dynamic'

/** GET /api/mobile/action-pages — published pages the operator can send. */
export async function GET(req: NextRequest) {
  try {
    const { userId, admin } = await requireMobileUser(req)
    const pages = await listSendableActionPagesFor(admin, userId)
    return NextResponse.json({ ok: true, pages })
  } catch (err) {
    return mobileError(err)
  }
}
