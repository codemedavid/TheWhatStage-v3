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

  // Lazy semantic ranking — fetched only when needed (folder pick or fallback).
  let semanticRanking: Map<string, number> | null = null
  const loadSemanticRanking = async (): Promise<Map<string, number>> => {
    if (semanticRanking) return semanticRanking
    if (!args.client.rpc) {
      semanticRanking = new Map()
      return semanticRanking
    }
    const queryParts = [args.customerMessage, refText].filter((p) => p && p.trim())
    const qvec = await args.embedder.embed(queryParts.join('\n\n'))
    const { data, error } = await args.client.rpc(args.rpcName ?? 'match_media_assets', {
      p_user_id: args.userId,
      p_query_text: args.customerMessage,
      p_query_embed: qvec,
      p_match_limit: 40,
    })
    if (error) throw new Error(`match media assets failed: ${error.message ?? error}`)
    const map = new Map<string, number>()
    let i = 0
    for (const r of (data ?? []) as { media_asset_id: string }[]) {
      if (r.media_asset_id && !map.has(r.media_asset_id)) map.set(r.media_asset_id, i++)
    }
    semanticRanking = map
    return map
  }

  // Priority 1 — explicit @asset references in retrieved knowledge.
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

  // Priority 2 — #folder references: pick the single best image per folder.
  if (selected.length < limit && refs.folderSlugs.length) {
    const { data: folders, error: folderErr } = await args.client
      .from('media_folders')
      .select('id, slug')
      .eq('user_id', args.userId)
      .in('slug', refs.folderSlugs)
    if (folderErr) throw new Error(`load media folder refs failed: ${folderErr.message ?? folderErr}`)
    const folderRows = (folders ?? []) as { id: string; slug: string }[]
    const folderIds = folderRows.map((f) => f.id)
    if (folderIds.length) {
      const { data, error } = await args.client
        .from('media_assets')
        .select('id, folder_id, name, slug, description, storage_path, mime_type')
        .eq('user_id', args.userId)
        .eq('is_archived', false)
        .in('folder_id', folderIds)
      if (error) throw new Error(`load folder media failed: ${error.message ?? error}`)
      const assetsByFolder = new Map<string, MediaAssetRow[]>()
      for (const row of (data ?? []) as MediaAssetRow[]) {
        const list = assetsByFolder.get(row.folder_id) ?? []
        list.push(row)
        assetsByFolder.set(row.folder_id, list)
      }
      const ranking = await loadSemanticRanking()
      const slugToFolder = new Map(folderRows.map((f) => [f.slug, f]))
      // Walk in the order the folder slugs appeared in the chunks.
      for (const slug of refs.folderSlugs) {
        const folder = slugToFolder.get(slug)
        if (!folder) continue
        const candidates = assetsByFolder.get(folder.id) ?? []
        const best = pickBestAsset(candidates, ranking)
        if (best) addUnique(selected, best, 'folder_ref', limit)
      }
    }
  }

  // Images are only sent when retrieved knowledge explicitly references them
  // via @asset or #folder. No semantic fallback — keeps the bot from attaching
  // images on every reply just because something looked vaguely similar.
  return selected.slice(0, limit)
}

function pickBestAsset(candidates: MediaAssetRow[], ranking: Map<string, number>): MediaAssetRow | null {
  if (!candidates.length) return null
  let best: MediaAssetRow | null = null
  let bestRank = Number.POSITIVE_INFINITY
  for (const row of candidates) {
    const rank = ranking.get(row.id)
    if (rank !== undefined && rank < bestRank) {
      bestRank = rank
      best = row
    }
  }
  return best ?? candidates[0]
}
