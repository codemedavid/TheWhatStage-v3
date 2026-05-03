import type { Embedder } from '@/lib/rag/hf-client'
import type { RetrievedChunk } from '@/lib/rag/retriever'
import { extractMediaRefs } from './rag-text'

export interface MediaSelectorClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc?: (fn: string, args?: Record<string, unknown>) => any
}

export interface SelectedMediaAsset {
  id: string
  folderId: string
  name: string
  slug: string
  description: string | null
  storagePath: string
  mimeType: string
  matchReason: 'asset_ref' | 'folder_ref' | 'semantic'
}

interface MediaAssetRow {
  id: string
  folder_id: string
  name: string
  slug: string
  description: string | null
  storage_path: string
  mime_type: string
}

function toSelected(row: MediaAssetRow, matchReason: SelectedMediaAsset['matchReason']): SelectedMediaAsset {
  return {
    id: row.id,
    folderId: row.folder_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    matchReason,
  }
}

function addUnique(out: SelectedMediaAsset[], row: MediaAssetRow, reason: SelectedMediaAsset['matchReason'], limit: number) {
  if (out.length >= limit) return
  if (out.some((item) => item.id === row.id)) return
  out.push(toSelected(row, reason))
}

export async function selectMediaForReply(args: {
  client: MediaSelectorClient
  embedder: Pick<Embedder, 'embed'>
  userId: string
  customerMessage: string
  retrievedChunks: RetrievedChunk[]
  rpcName?: 'match_media_assets' | 'match_media_assets_service'
  limit?: number
}): Promise<SelectedMediaAsset[]> {
  const limit = args.limit ?? 4
  if (limit <= 0) return []

  const refText = args.retrievedChunks.map((chunk) => chunk.content).join('\n')
  const refs = extractMediaRefs(refText)
  const selected: SelectedMediaAsset[] = []

  if (refs.assetSlugs.length) {
    const { data, error } = await args.client
      .from('media_assets')
      .select('id, folder_id, name, slug, description, storage_path, mime_type')
      .eq('user_id', args.userId)
      .eq('is_archived', false)
      .in('slug', refs.assetSlugs)
    if (error) throw new Error(`load media asset refs failed: ${error.message ?? error}`)
    const bySlug = new Map<string, MediaAssetRow>((data ?? []).map((row: MediaAssetRow) => [row.slug, row]))
    for (const slug of refs.assetSlugs) {
      const row = bySlug.get(slug)
      if (row) addUnique(selected, row, 'asset_ref', limit)
    }
  }

  if (selected.length < limit && refs.folderSlugs.length) {
    const { data: folders, error: folderErr } = await args.client
      .from('media_folders')
      .select('id, slug')
      .eq('user_id', args.userId)
      .in('slug', refs.folderSlugs)
    if (folderErr) throw new Error(`load media folder refs failed: ${folderErr.message ?? folderErr}`)
    const folderIds = (folders ?? []).map((f: { id: string }) => f.id)
    if (folderIds.length) {
      const { data, error } = await args.client
        .from('media_assets')
        .select('id, folder_id, name, slug, description, storage_path, mime_type')
        .eq('user_id', args.userId)
        .eq('is_archived', false)
        .in('folder_id', folderIds)
      if (error) throw new Error(`load folder media failed: ${error.message ?? error}`)
      for (const row of (data ?? []) as MediaAssetRow[]) addUnique(selected, row, 'folder_ref', limit)
    }
  }

  if (selected.length < limit && args.client.rpc) {
    const qvec = await args.embedder.embed(
      [args.customerMessage, refText].filter((part) => part.trim()).join('\n\n'),
    )
    const { data, error } = await args.client.rpc(args.rpcName ?? 'match_media_assets', {
      p_user_id: args.userId,
      p_query_text: args.customerMessage,
      p_query_embed: qvec,
      p_match_limit: 40,
    })
    if (error) throw new Error(`match media assets failed: ${error.message ?? error}`)
    const ids = Array.from(new Set((data ?? []).map((r: { media_asset_id: string }) => r.media_asset_id).filter(Boolean)))
    if (ids.length) {
      const { data: rows, error: rowsErr } = await args.client
        .from('media_assets')
        .select('id, folder_id, name, slug, description, storage_path, mime_type')
        .eq('user_id', args.userId)
        .eq('is_archived', false)
        .in('id', ids)
      if (rowsErr) throw new Error(`load semantic media failed: ${rowsErr.message ?? rowsErr}`)
      const byId = new Map<string, MediaAssetRow>((rows ?? []).map((row: MediaAssetRow) => [row.id, row]))
      for (const id of ids) {
        const row = byId.get(id as string)
        if (row) addUnique(selected, row, 'semantic', limit)
      }
    }
  }

  return selected.slice(0, limit)
}
