import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Media library reads. Assets live in the private `media-assets` bucket, so
// image thumbnails are signed with the user's session (RLS: owner read).

const MEDIA_BUCKET = 'media-assets'
const ASSET_LIMIT = 200
const THUMB_TTL_SECONDS = 60 * 60

export type MediaKind = 'image' | 'video' | 'audio'

export interface MediaAsset {
  id: string
  folder_id: string
  name: string
  description: string | null
  storage_path: string
  mime_type: string
  byte_size: number
  media_folders?: { name: string } | { name: string }[] | null
}

export const mediaKeys = {
  all: ['media'] as const,
  assets: ['media', 'assets'] as const,
  thumb: (path: string) => ['media', 'thumb', path] as const,
  assetThumb: (id: string) => ['media', 'asset-thumb', id] as const,
}

export function mediaKindFromMime(mime: string): MediaKind | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return null
}

export function useMediaAssets(enabled = true) {
  return useQuery({
    queryKey: mediaKeys.assets,
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('media_assets')
        .select('id, folder_id, name, description, storage_path, mime_type, byte_size, media_folders(name)')
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })
        .limit(ASSET_LIMIT)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as MediaAsset[]
    },
  })
}

/** Short-lived signed URL for an image thumbnail; null for non-images. */
export function useMediaThumb(asset: Pick<MediaAsset, 'storage_path' | 'mime_type'>) {
  const isImage = mediaKindFromMime(asset.mime_type) === 'image'
  return useQuery({
    queryKey: mediaKeys.thumb(asset.storage_path),
    enabled: isImage,
    staleTime: (THUMB_TTL_SECONDS - 60) * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .createSignedUrl(asset.storage_path, THUMB_TTL_SECONDS)
      if (error) throw new Error(error.message)
      return data.signedUrl
    },
  })
}

/**
 * Signed thumbnail for one library asset given only its id — what a saved
 * message stores. Returns null when the asset has since been deleted, which the
 * caller shows as a missing image rather than an error.
 */
export function useMediaAssetThumb(assetId: string | null | undefined) {
  return useQuery({
    queryKey: mediaKeys.assetThumb(assetId ?? ''),
    enabled: !!assetId,
    staleTime: (THUMB_TTL_SECONDS - 60) * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('media_assets')
        .select('storage_path')
        .eq('id', assetId!)
        .maybeSingle<{ storage_path: string }>()
      if (error) throw new Error(error.message)
      if (!data) return null
      const { data: signed, error: signErr } = await supabase.storage
        .from(MEDIA_BUCKET)
        .createSignedUrl(data.storage_path, THUMB_TTL_SECONDS)
      if (signErr) throw new Error(signErr.message)
      return signed.signedUrl
    },
  })
}
