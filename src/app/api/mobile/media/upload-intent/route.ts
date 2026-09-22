import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireMobileUser, mobileError } from '@/lib/mobile/auth'
import { MAX_FILES_PER_UPLOAD } from '@/lib/media/upload'
import { createUploadIntent } from '@/lib/media/upload-intent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  // The app has no folder picker, so an omitted folder means "the first one".
  folderId: z.string().uuid().optional(),
  description: z.string().trim().max(4000).optional(),
  files: z
    .array(z.object({ name: z.string().min(1).max(255), type: z.string().min(1), size: z.number().int() }))
    .min(1)
    .max(MAX_FILES_PER_UPLOAD),
})

/**
 * POST /api/mobile/media/upload-intent — register camera-roll files and mint
 * signed upload URLs. Same three-step flow as the dashboard (see
 * src/lib/media/upload.ts); only the auth differs.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, admin } = await requireMobileUser(req)
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
    }
    const result = await createUploadIntent(admin, userId, parsed.data)
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
    }
    return NextResponse.json({ ok: true, uploads: result.uploads })
  } catch (err) {
    return mobileError(err)
  }
}
