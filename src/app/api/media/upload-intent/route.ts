import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { MAX_FILES_PER_UPLOAD } from '@/lib/media/upload'
import { createUploadIntent } from '@/lib/media/upload-intent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BODY_SCHEMA = z.object({
  folderId: z.string().uuid(),
  description: z.string().trim().max(4000).optional(),
  files: z
    .array(z.object({ name: z.string().min(1).max(255), type: z.string().min(1), size: z.number().int() }))
    .min(1)
    .max(MAX_FILES_PER_UPLOAD),
})

// Creates hidden (archived) asset rows and signed upload URLs. Rows are
// published by /api/media/upload-complete once the bytes are in storage, so a
// half-finished upload never shows up in the library.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = BODY_SCHEMA.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid upload request' }, { status: 400 })

  const result = await createUploadIntent(supabase, user.id, parsed.data)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ uploads: result.uploads })
}
