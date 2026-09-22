import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { enqueueEmbedJob } from '@/lib/rag'
import { processSourceInline } from '@/lib/rag/process-now'
import { MEDIA_ASSETS_BUCKET } from '@/lib/messenger/attachments'

// Step 3 of the direct-to-storage upload: publish the hidden rows that
// /upload-intent created, once the client says the bytes are in storage. Shared
// by the browser route and the mobile route.

export interface PublishedAsset {
  id: string
  name: string
  slug: string
  storage_path: string
  mime_type: string
}

interface PendingRow extends PublishedAsset {
  version: number
}

export type PublishUploadResult =
  | { ok: true; assets: PublishedAsset[]; failed: string[] }
  | { ok: false; status: 400 | 500; error: string }

async function objectExists(supabase: SupabaseClient, path: string): Promise<boolean> {
  const slash = path.lastIndexOf('/')
  const prefix = path.slice(0, slash)
  const fileName = path.slice(slash + 1)
  const { data } = await supabase.storage.from(MEDIA_ASSETS_BUCKET).list(prefix, { search: fileName, limit: 5 })
  return (data ?? []).some((o) => o.name === fileName)
}

/**
 * Flips each confirmed upload out of its hidden state and queues it for
 * embedding. Rows whose object never arrived are deleted, so an interrupted
 * upload leaves nothing behind.
 */
export async function publishUploadedAssets(
  supabase: SupabaseClient,
  userId: string,
  assetIds: readonly string[],
): Promise<PublishUploadResult> {
  const { data: rows, error } = await supabase
    .from('media_assets')
    .select('id, name, slug, storage_path, mime_type, version')
    .eq('user_id', userId)
    .eq('is_archived', true)
    .in('id', assetIds)
    .returns<PendingRow[]>()
  if (error) return { ok: false, status: 500, error: error.message }

  const published: PendingRow[] = []
  const missing: string[] = []
  for (const row of rows ?? []) {
    if (row.storage_path === 'pending' || !(await objectExists(supabase, row.storage_path))) {
      missing.push(row.id)
      continue
    }
    const { error: updateErr } = await supabase
      .from('media_assets')
      .update({ is_archived: false, embedding_status: 'stale' })
      .eq('id', row.id)
    if (updateErr) {
      console.error('[media.upload-complete] publish failed', row.id, updateErr.message)
      continue
    }
    await enqueueEmbedJob(supabase, { kind: 'media_asset', sourceId: row.id, userId, sourceVersion: row.version })
    published.push(row)
  }

  if (missing.length) await supabase.from('media_assets').delete().in('id', missing)

  if (published.length) {
    after(async () => {
      for (const row of published) {
        try {
          await processSourceInline({ kind: 'media_asset', sourceId: row.id })
        } catch (e) {
          console.error('[media.upload-complete] inline embed failed', e)
        }
      }
    })
  }

  if (published.length === 0) {
    return { ok: false, status: 400, error: 'Upload did not finish — please try again' }
  }
  return {
    ok: true,
    assets: published.map(({ id, name, slug, storage_path, mime_type }) => ({
      id,
      name,
      slug,
      storage_path,
      mime_type,
    })),
    failed: missing,
  }
}
