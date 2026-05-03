import type { SupabaseClient } from '@supabase/supabase-js'

export interface MediaFolderRow {
  id: string
  name: string
  slug: string
  description: string | null
  position: number
  created_at: string
  updated_at: string
  asset_count: number
}

export interface MediaAssetRow {
  id: string
  folder_id: string
  name: string
  slug: string
  description: string | null
  storage_path: string
  mime_type: string
  byte_size: number
  is_archived: boolean
  embedding_status: 'pending' | 'indexed' | 'stale'
  updated_at: string
  signed_url: string | null
}

export async function fetchMediaFolders(supabase: SupabaseClient, userId: string): Promise<MediaFolderRow[]> {
  const { data, error } = await supabase
    .from('media_folders')
    .select('id, name, slug, description, position, created_at, updated_at, media_assets(id)')
    .eq('user_id', userId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
    asset_count: Array.isArray(row.media_assets) ? row.media_assets.length : 0,
  }))
}

export async function fetchMediaAssets(
  supabase: SupabaseClient,
  userId: string,
  folderId: string | null,
): Promise<MediaAssetRow[]> {
  let query = supabase
    .from('media_assets')
    .select('id, folder_id, name, slug, description, storage_path, mime_type, byte_size, is_archived, embedding_status, updated_at')
    .eq('user_id', userId)
    .eq('is_archived', false)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (folderId) query = query.eq('folder_id', folderId)
  const { data, error } = await query
  if (error) throw error
  const rows = (data ?? []) as Omit<MediaAssetRow, 'signed_url'>[]
  return Promise.all(
    rows.map(async (row) => {
      const { data: signed } = await supabase.storage
        .from('media-assets')
        .createSignedUrl(row.storage_path, 3600)
      return { ...row, signed_url: signed?.signedUrl ?? null }
    }),
  )
}
