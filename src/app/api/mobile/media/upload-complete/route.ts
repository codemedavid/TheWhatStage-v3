import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireMobileUser, mobileError } from '@/lib/mobile/auth'
import { MAX_FILES_PER_UPLOAD } from '@/lib/media/upload'
import { publishUploadedAssets } from '@/lib/media/upload-publish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(MAX_FILES_PER_UPLOAD),
})

/**
 * POST /api/mobile/media/upload-complete — publish the rows whose bytes the app
 * has finished pushing to storage.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, admin } = await requireMobileUser(req)
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 })
    }
    const result = await publishUploadedAssets(admin, userId, parsed.data.assetIds)
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
    }
    return NextResponse.json({ ok: true, assets: result.assets, failed: result.failed })
  } catch (err) {
    return mobileError(err)
  }
}
