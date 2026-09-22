import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { MAX_FILES_PER_UPLOAD } from '@/lib/media/upload'
import { publishUploadedAssets } from '@/lib/media/upload-publish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BODY_SCHEMA = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(MAX_FILES_PER_UPLOAD),
})

// Publishes rows created by /api/media/upload-intent once the browser has
// finished the direct-to-storage upload. Rows whose object never arrived are
// deleted so abandoned uploads do not linger as hidden assets.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = BODY_SCHEMA.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const result = await publishUploadedAssets(supabase, user.id, parsed.data.assetIds)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, assets: result.assets, failed: result.failed })
}
