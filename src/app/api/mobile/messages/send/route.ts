import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireMobileUser, mobileError } from '@/lib/mobile/auth'
import { personalizeForLead } from '@/lib/mobile/personalize'
import { replyAsOperatorFor } from '@/lib/messenger/operator-send'

export const dynamic = 'force-dynamic'

// Messenger caps one text message at 2000 chars; the send layer splits longer
// text, but the mobile composer enforces the same cap.
const MESSAGE_MAX = 2000

const bodySchema = z.object({
  leadId: z.string().uuid(),
  text: z.string().trim().min(1).max(MESSAGE_MAX),
  // Saved messages may carry [first_name]-style merge tags. Plain typed
  // replies are sent verbatim.
  personalize: z.boolean().optional().default(false),
})

/** POST /api/mobile/messages/send — operator text reply from the Expo app. */
export async function POST(req: NextRequest) {
  try {
    const { userId, admin } = await requireMobileUser(req)
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
    }
    const { leadId, personalize: shouldPersonalize } = parsed.data
    const text = shouldPersonalize
      ? await personalizeForLead(admin, userId, leadId, parsed.data.text)
      : parsed.data.text

    const result = await replyAsOperatorFor(admin, userId, leadId, text)
    return NextResponse.json(result, { status: result.ok ? 200 : 422 })
  } catch (err) {
    return mobileError(err)
  }
}
