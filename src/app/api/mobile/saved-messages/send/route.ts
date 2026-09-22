import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireMobileUser, mobileError } from '@/lib/mobile/auth'
import { sendSavedMessageFor } from '@/lib/saved-messages/send'
import { TEXT_MAX } from '@/lib/saved-messages/template'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  leadId: z.string().uuid(),
  savedMessageId: z.string().uuid(),
  // The operator's edit in the composer. Text layouts only — a card message
  // carries its copy inside the cards, so there is nothing to override.
  text: z.string().trim().min(1).max(TEXT_MAX).optional(),
})

/** POST /api/mobile/saved-messages/send — send a saved message with its layout. */
export async function POST(req: NextRequest) {
  try {
    const { userId, admin } = await requireMobileUser(req)
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
    }
    const { leadId, savedMessageId, text } = parsed.data
    // Merge tags are rendered inside the send path, which sees the card copy
    // too — and rendering is idempotent, so a pre-rendered composer edit is
    // unaffected.
    const result = await sendSavedMessageFor(admin, userId, leadId, savedMessageId, text)
    return NextResponse.json(result, { status: result.ok ? 200 : 422 })
  } catch (err) {
    return mobileError(err)
  }
}
