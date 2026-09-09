import type { Embedder } from '@/lib/rag/hf-client'
import type { RetrievedChunk } from '@/lib/rag/retriever'
import { type MediaMatchReason } from './match-reason'
import { extractMediaRefs } from './rag-text'

export interface MediaSelectorClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc?: (fn: string, args?: Record<string, unknown>) => any
}

export { isKnowledgeRef, KNOWLEDGE_REF_REASONS, type MediaMatchReason } from './match-reason'

export interface SelectedMediaAsset {
  id: string
  folderId: string
  name: string
  slug: string
  description: string | null
  storagePath: string
  mimeType: string
  matchReason: MediaMatchReason
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

const ASSET_COLUMNS = 'id, folder_id, name, slug, description, storage_path, mime_type'
/** How many semantically ranked `auto_send` assets may join the candidate list. */
export const DEFAULT_SEMANTIC_CANDIDATES = 3
/** Only the top-N of the hybrid ranking count as "relevant enough" to offer. */
const SEMANTIC_RANK_WINDOW = 10
/** Upper bound on auto_send assets loaded per turn (ranking prunes the rest). */
const AUTO_SEND_FETCH_LIMIT = 60

export interface SelectMediaArgs {
  client: MediaSelectorClient
  embedder: Pick<Embedder, 'embed'>
  userId: string
  customerMessage: string
  retrievedChunks: RetrievedChunk[]
  /** Chatbot instructions / rules text. @slug and #folder tokens found here
   *  become `instruction_ref` candidates on every turn. */
  instructionText?: string
  /** When true, `auto_send` assets are ranked semantically against the
   *  customer's message and the best few join as `semantic` candidates. Only
   *  enable on a path where the reply model picks per asset. */
  includeSemantic?: boolean
  semanticLimit?: number
  rpcName?: 'match_media_assets' | 'match_media_assets_service'
  limit?: number
}

function toSelected(row: MediaAssetRow, matchReason: MediaMatchReason): SelectedMediaAsset {
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

/** Returns a new list with `row` appended unless the cap is hit or it is a duplicate. */
function withUnique(
  selected: SelectedMediaAsset[],
  row: MediaAssetRow,
  reason: MediaMatchReason,
  limit: number,
): SelectedMediaAsset[] {
  if (selected.length >= limit) return selected
  if (selected.some((item) => item.id === row.id)) return selected
  return [...selected, toSelected(row, reason)]
}

function sortByRanking(candidates: MediaAssetRow[], ranking: Map<string, number>): MediaAssetRow[] {
  return [...candidates].sort((a, b) => {
    const ra = ranking.get(a.id) ?? Number.POSITIVE_INFINITY
    const rb = ranking.get(b.id) ?? Number.POSITIVE_INFINITY
    return ra - rb
  })
}

type Ranking = Map<string, number>

/** Lazily runs the hybrid media RPC once per turn and memoizes the rank map. */
function makeRankingLoader(args: SelectMediaArgs, refText: string): () => Promise<Ranking> {
  let cached: Ranking | null = null
  return async () => {
    if (cached) return cached
    if (!args.client.rpc) {
      cached = new Map()
      return cached
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
    const map: Ranking = new Map()
    let i = 0
    for (const r of (data ?? []) as { media_asset_id: string }[]) {
      if (r.media_asset_id && !map.has(r.media_asset_id)) map.set(r.media_asset_id, i++)
    }
    cached = map
    return map
  }
}

async function loadAssetsBySlug(args: SelectMediaArgs, slugs: string[]): Promise<Map<string, MediaAssetRow>> {
  if (slugs.length === 0) return new Map()
  const { data, error } = await args.client
    .from('media_assets')
    .select(ASSET_COLUMNS)
    .eq('user_id', args.userId)
    .eq('is_archived', false)
    .in('slug', slugs)
  if (error) throw new Error(`load media asset refs failed: ${error.message ?? error}`)
  return new Map<string, MediaAssetRow>((data ?? []).map((row: MediaAssetRow) => [row.slug, row]))
}

/** Resolves @slug refs in order; returns the (possibly grown) selection. */
async function addAssetRefs(
  args: SelectMediaArgs,
  selected: SelectedMediaAsset[],
  slugs: string[],
  reason: MediaMatchReason,
  limit: number,
  label: string,
): Promise<SelectedMediaAsset[]> {
  if (slugs.length === 0 || selected.length >= limit) return selected
  const bySlug = await loadAssetsBySlug(args, slugs)
  console.log(`[media.selector] ${label} asset lookup`, {
    requested: slugs,
    hits: slugs.filter((s) => bySlug.has(s)),
    missing: slugs.filter((s) => !bySlug.has(s)),
  })
  return slugs.reduce((acc, slug) => {
    const row = bySlug.get(slug)
    return row ? withUnique(acc, row, reason, limit) : acc
  }, selected)
}

/** Resolves #folder refs: every asset in each folder, ordered by relevance. */
async function addFolderRefs(
  args: SelectMediaArgs,
  selected: SelectedMediaAsset[],
  folderSlugs: string[],
  reason: MediaMatchReason,
  limit: number,
  loadRanking: () => Promise<Ranking>,
  label: string,
): Promise<SelectedMediaAsset[]> {
  if (folderSlugs.length === 0 || selected.length >= limit) return selected
  const { data: folders, error: folderErr } = await args.client
    .from('media_folders')
    .select('id, slug')
    .eq('user_id', args.userId)
    .in('slug', folderSlugs)
  if (folderErr) throw new Error(`load media folder refs failed: ${folderErr.message ?? folderErr}`)
  const folderRows = (folders ?? []) as { id: string; slug: string }[]
  console.log(`[media.selector] ${label} folder lookup`, {
    requested: folderSlugs,
    hits: folderRows.map((f) => f.slug),
    missing: folderSlugs.filter((s) => !folderRows.some((f) => f.slug === s)),
  })
  if (folderRows.length === 0) return selected

  const { data, error } = await args.client
    .from('media_assets')
    .select(ASSET_COLUMNS)
    .eq('user_id', args.userId)
    .eq('is_archived', false)
    .in('folder_id', folderRows.map((f) => f.id))
  if (error) throw new Error(`load folder media failed: ${error.message ?? error}`)
  const rows = (data ?? []) as MediaAssetRow[]
  const ranking = await loadRanking()
  const slugToFolder = new Map(folderRows.map((f) => [f.slug, f]))

  // Walk in the order the folder slugs appeared in the source text.
  let out = selected
  for (const slug of folderSlugs) {
    const folder = slugToFolder.get(slug)
    if (!folder) continue
    const inFolder = rows.filter((r) => r.folder_id === folder.id)
    for (const row of sortByRanking(inFolder, ranking)) {
      if (out.length >= limit) return out
      out = withUnique(out, row, reason, limit)
    }
  }
  return out
}

/**
 * `auto_send` assets ranked by their embedded name + description against the
 * customer's message. Only assets inside the top of the hybrid ranking are
 * offered, so an unrelated flag-on asset does not show up on every turn.
 */
async function addSemanticCandidates(
  args: SelectMediaArgs,
  selected: SelectedMediaAsset[],
  limit: number,
  semanticLimit: number,
  loadRanking: () => Promise<Ranking>,
): Promise<SelectedMediaAsset[]> {
  if (semanticLimit <= 0 || selected.length >= limit) return selected
  if (!args.customerMessage.trim()) return selected

  const { data, error } = await args.client
    .from('media_assets')
    .select(ASSET_COLUMNS)
    .eq('user_id', args.userId)
    .eq('is_archived', false)
    .eq('auto_send', true)
    .limit(AUTO_SEND_FETCH_LIMIT)
  if (error) throw new Error(`load auto-send media failed: ${error.message ?? error}`)
  const rows = (data ?? []) as MediaAssetRow[]
  if (rows.length === 0) return selected

  const ranking = await loadRanking()
  const relevant = sortByRanking(rows, ranking).filter((row) => {
    const rank = ranking.get(row.id)
    return rank !== undefined && rank < SEMANTIC_RANK_WINDOW
  })
  console.log('[media.selector] semantic auto-send candidates', {
    autoSendAssets: rows.length,
    ranked: relevant.map((r) => ({ slug: r.slug, rank: ranking.get(r.id) })),
  })

  const cap = Math.min(limit, selected.length + semanticLimit)
  return relevant.reduce((acc, row) => withUnique(acc, row, 'semantic', cap), selected)
}

/**
 * Builds the per-turn media CANDIDATE list, in send-priority order:
 *   1. @asset refs in retrieved knowledge chunks
 *   2. #folder refs in retrieved knowledge chunks
 *   3. @asset / #folder refs in the chatbot instructions (`instructionText`)
 *   4. `auto_send` assets ranked semantically (when `includeSemantic`)
 *
 * The caller decides what is actually sent: the structured reply model picks
 * per asset by slug, while unstructured paths may only trust 1–2 (see
 * `isKnowledgeRef`).
 */
export async function selectMediaForReply(args: SelectMediaArgs): Promise<SelectedMediaAsset[]> {
  const limit = args.limit ?? 4
  if (limit <= 0) return []

  const refText = args.retrievedChunks.map((chunk) => chunk.content).join('\n')
  const refs = extractMediaRefs(refText)
  const instructionRefs = extractMediaRefs(args.instructionText ?? '')
  const loadRanking = makeRankingLoader(args, refText)

  console.log('[media.selector] scan', {
    userId: args.userId,
    chunks: args.retrievedChunks.length,
    refTextChars: refText.length,
    assetSlugs: refs.assetSlugs,
    folderSlugs: refs.folderSlugs,
    instructionAssetSlugs: instructionRefs.assetSlugs,
    instructionFolderSlugs: instructionRefs.folderSlugs,
    includeSemantic: args.includeSemantic === true,
  })

  let selected: SelectedMediaAsset[] = []
  selected = await addAssetRefs(args, selected, refs.assetSlugs, 'asset_ref', limit, 'knowledge')
  selected = await addFolderRefs(args, selected, refs.folderSlugs, 'folder_ref', limit, loadRanking, 'knowledge')
  selected = await addAssetRefs(args, selected, instructionRefs.assetSlugs, 'instruction_ref', limit, 'instruction')
  selected = await addFolderRefs(
    args,
    selected,
    instructionRefs.folderSlugs,
    'instruction_ref',
    limit,
    loadRanking,
    'instruction',
  )
  if (args.includeSemantic) {
    selected = await addSemanticCandidates(
      args,
      selected,
      limit,
      args.semanticLimit ?? DEFAULT_SEMANTIC_CANDIDATES,
      loadRanking,
    )
  }

  console.log('[media.selector] result', {
    count: selected.length,
    picks: selected.map((a) => ({ slug: a.slug, reason: a.matchReason })),
  })
  return selected
}
