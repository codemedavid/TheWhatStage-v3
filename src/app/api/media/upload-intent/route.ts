import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { makeSlug } from '@/lib/media/slug'
import { mediaKindFromMime } from '@/lib/media/kind'
import { MEDIA_ASSETS_BUCKET } from '@/lib/messenger/attachments'
import { MAX_FILES_PER_UPLOAD, buildStoragePath, defaultAssetName, validateUploadFiles } from '@/lib/media/upload'

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

export interface UploadIntentEntry {
  assetId: string
  path: string
  token: string
  contentType: string
}

// Creates hidden (archived) asset rows and signed upload URLs. Rows are
// published by /api/media/upload-complete once the bytes are in storage, so a
// half-finished upload never shows up in the library.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = BODY_SCHEMA.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid upload request' }, { status: 400 })
  const { folderId, description, files } = parsed.data

  const validation = validateUploadFiles(files)
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 })

  const { data: folder } = await supabase
    .from('media_folders')
    .select('id')
    .eq('id', folderId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })

  const uploads: UploadIntentEntry[] = []
  for (const file of files) {
    const kind = mediaKindFromMime(file.type) ?? 'image'
    const name = defaultAssetName(file.name, kind)
    const slug = `${makeSlug(name, kind, 90)}-${Date.now().toString(36)}${uploads.length}`
    const { data: inserted, error: insertErr } = await supabase
      .from('media_assets')
      .insert({
        user_id: user.id,
        folder_id: folder.id,
        name,
        slug,
        description: description || null,
        storage_path: 'pending',
        mime_type: file.type,
        byte_size: file.size,
        is_archived: true,
      })
      .select('id')
      .single()
    if (insertErr || !inserted) {
      console.error('[media.upload-intent] insert failed', insertErr?.message)
      return NextResponse.json({ error: 'Could not register upload' }, { status: 500 })
    }

    const path = buildStoragePath(user.id, folder.id, inserted.id, file.name, kind)
    const { data: signed, error: signErr } = await supabase.storage
      .from(MEDIA_ASSETS_BUCKET)
      .createSignedUploadUrl(path)
    if (signErr || !signed) {
      console.error('[media.upload-intent] signed upload url failed', signErr?.message)
      await supabase.from('media_assets').delete().eq('id', inserted.id)
      return NextResponse.json({ error: 'Could not prepare upload' }, { status: 500 })
    }
    await supabase.from('media_assets').update({ storage_path: path }).eq('id', inserted.id)
    uploads.push({ assetId: inserted.id, path, token: signed.token, contentType: file.type })
  }

  return NextResponse.json({ uploads })
}
