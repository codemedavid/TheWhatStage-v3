import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireMobileUser, mobileError } from '@/lib/mobile/auth'
import { personalizeForLead } from '@/lib/mobile/personalize'
import { sendActionPageFor } from '@/lib/messenger/operator-send'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  leadId: z.string().uuid(),
  actionPageId: z.string().uuid(),
  messageText: z.string().trim().min(1).max(640).optional(),
  ctaLabel: z.string().trim().min(1).max(20).optional(),
  // Set when the text came from a saved message, which may carry merge tags.
  personalize: z.boolean().optional().default(false),
})

/** POST /api/mobile/action-pages/send — send a page as a signed Messenger button. */
export async function POST(req: NextRequest) {
  try {
    const { userId, admin } = await requireMobileUser(req)
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
    }
    const { leadId, actionPageId, ctaLabel, personalize: shouldPersonalize } = parsed.data
    const messageText =
      shouldPersonalize && parsed.data.messageText
        ? await personalizeForLead(admin, userId, leadId, parsed.data.messageText)
        : parsed.data.messageText

    const result = await sendActionPageFor(admin, userId, leadId, actionPageId, {
      messageText,
      ctaLabel,
    })
    return NextResponse.json(result, { status: result.ok ? 200 : 422 })
  } catch (err) {
    return mobileError(err)
  }
}
