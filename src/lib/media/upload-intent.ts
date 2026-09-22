import type { SupabaseClient } from '@supabase/supabase-js'
import { makeSlug } from '@/lib/media/slug'
import { mediaKindFromMime } from '@/lib/media/kind'
import { MEDIA_ASSETS_BUCKET } from '@/lib/messenger/attachments'
import { ensureDefaultFolder } from '@/lib/media/default-folder'
import { buildStoragePath, defaultAssetName, validateUploadFiles, type UploadFileMeta } from '@/lib/media/upload'

// Step 1 of the direct-to-storage upload (see src/lib/media/upload.ts for the
// whole shape). Shared by the browser route and the mobile route: the only
// difference between them is how the caller was authenticated, so the client
// and user id are passed in rather than read from cookies here.

export interface UploadIntentEntry {
  assetId: string
  path: string
  /** Signed-upload token, for supabase-js `uploadToSignedUrl`. */
  token: string
  /** The same grant as a ready-to-PUT URL, for clients without supabase-js. */
  signedUrl: string
  contentType: string
}

export interface UploadIntentInput {
  /** Omitted by clients with no folder UI; the user's first folder is used. */
  folderId?: string
  description?: string
  files: readonly UploadFileMeta[]
}

export type UploadIntentResult =
  | { ok: true; folderId: string; uploads: UploadIntentEntry[] }
  | { ok: false; status: 400 | 404 | 500; error: string }

async function resolveFolderId(
  supabase: SupabaseClient,
  userId: string,
  folderId: string | undefined,
): Promise<string | null> {
  if (!folderId) return ensureDefaultFolder(supabase, userId)
  const { data } = await supabase
    .from('media_folders')
    .select('id')
    .eq('id', folderId)
    .eq('user_id', userId)
    .maybeSingle<{ id: string }>()
  return data?.id ?? null
}

/**
 * Registers each file as a hidden (archived) asset row and mints a signed
 * upload URL for it. Rows stay hidden until /upload-complete confirms the bytes
 * landed, so an abandoned upload never shows up in the library.
 */
export async function createUploadIntent(
  supabase: SupabaseClient,
  userId: string,
  input: UploadIntentInput,
): Promise<UploadIntentResult> {
  const validation = validateUploadFiles(input.files)
  if (!validation.ok) return { ok: false, status: 400, error: validation.error }

  let folderId: string | null
  try {
    folderId = await resolveFolderId(supabase, userId, input.folderId)
  } catch (err) {
    console.error('[media.upload-intent] folder lookup failed', err)
    return { ok: false, status: 500, error: 'Could not prepare upload' }
  }
  if (!folderId) return { ok: false, status: 404, error: 'Folder not found' }

  const description = input.description?.trim() || null
  const uploads: UploadIntentEntry[] = []
  for (const file of input.files) {
    const kind = mediaKindFromMime(file.type) ?? 'image'
    const name = defaultAssetName(file.name, kind)
    const slug = `${makeSlug(name, kind, 90)}-${Date.now().toString(36)}${uploads.length}`
    const { data: inserted, error: insertErr } = await supabase
      .from('media_assets')
      .insert({
        user_id: userId,
        folder_id: folderId,
        name,
        slug,
        description,
        storage_path: 'pending',
        mime_type: file.type,
        byte_size: file.size,
        is_archived: true,
      })
      .select('id')
      .single<{ id: string }>()
    if (insertErr || !inserted) {
      console.error('[media.upload-intent] insert failed', insertErr?.message)
      return { ok: false, status: 500, error: 'Could not register upload' }
    }

    const path = buildStoragePath(userId, folderId, inserted.id, file.name, kind)
    const { data: signed, error: signErr } = await supabase.storage
      .from(MEDIA_ASSETS_BUCKET)
      .createSignedUploadUrl(path)
    if (signErr || !signed) {
      console.error('[media.upload-intent] signed upload url failed', signErr?.message)
      await supabase.from('media_assets').delete().eq('id', inserted.id)
      return { ok: false, status: 500, error: 'Could not prepare upload' }
    }
    // The row is inserted before the path is known (the asset id is part of
    // it), so the real path is written back here. upload-complete treats a row
    // still reading 'pending' as an upload that never happened.
    await supabase.from('media_assets').update({ storage_path: path }).eq('id', inserted.id)
    uploads.push({
      assetId: inserted.id,
      path,
      token: signed.token,
      signedUrl: signed.signedUrl,
      contentType: file.type,
    })
  }

  return { ok: true, folderId, uploads }
}
