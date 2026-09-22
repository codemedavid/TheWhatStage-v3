import { useMutation, useQueryClient } from '@tanstack/react-query'
import { File, UploadType } from 'expo-file-system'
import { useState } from 'react'
import { api, type UploadedMediaAsset } from '@/lib/api'
import { mediaKeys } from '@/data/media'
import { pickMedia, MediaPermissionError, type PickedMedia, type PickSource } from '@/lib/pick-media'

// Uploading from the phone, in the same three steps the dashboard uses:
//   1. /api/mobile/media/upload-intent  → hidden rows + signed upload URLs
//   2. PUT each file straight into Supabase Storage
//   3. /api/mobile/media/upload-complete → publish the rows and queue embedding
//
// Step 2 goes through expo-file-system's native uploader rather than fetch so a
// 25 MB video streams off disk instead of being read into the JS heap first.

const CACHE_SECONDS = 31536000

/** How far along a multi-file upload is, for the caller's progress label. */
export interface UploadProgress {
  done: number
  total: number
}

function errorFrom(result: { ok: false; error: string }): Error {
  if (result.error === 'network_unreachable') return new Error('No connection — try again.')
  return new Error(result.error)
}

async function putToStorage(file: PickedMedia, signedUrl: string, contentType: string): Promise<void> {
  const response = await new File(file.uri).upload(signedUrl, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    mimeType: contentType,
    headers: {
      'content-type': contentType,
      'cache-control': `max-age=${CACHE_SECONDS}`,
      'x-upsert': 'false',
    },
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${file.name} failed to upload`)
  }
}

async function uploadPicked(
  files: PickedMedia[],
  onProgress: (progress: UploadProgress) => void,
): Promise<UploadedMediaAsset[]> {
  const intent = await api.mediaUploadIntent(
    files.map((file) => ({ name: file.name, type: file.mimeType, size: file.size })),
  )
  if (!intent.ok) throw errorFrom(intent)
  if (intent.uploads.length !== files.length) throw new Error('Upload could not be prepared')

  onProgress({ done: 0, total: files.length })
  for (let i = 0; i < files.length; i++) {
    const entry = intent.uploads[i]
    await putToStorage(files[i], entry.signedUrl, entry.contentType)
    onProgress({ done: i + 1, total: files.length })
  }

  const complete = await api.mediaUploadComplete(intent.uploads.map((entry) => entry.assetId))
  if (!complete.ok) throw errorFrom(complete)
  return complete.assets
}

/**
 * Picks from the camera roll (or camera) and uploads to the media library.
 * Resolves to an empty array when the operator cancels the picker, so callers
 * can treat "nothing chosen" as a no-op rather than an error.
 */
export function useUploadMedia() {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<UploadProgress | null>(null)

  const mutation = useMutation({
    mutationFn: async (source: PickSource): Promise<UploadedMediaAsset[]> => {
      const files = await pickMedia(source)
      if (files.length === 0) return []
      try {
        return await uploadPicked(files, setProgress)
      } finally {
        setProgress(null)
      }
    },
    onSuccess: async (assets) => {
      if (assets.length === 0) return
      // Only the list changes; signed thumbnails for existing assets are still
      // valid and re-signing them all would cost a round trip each.
      await queryClient.invalidateQueries({ queryKey: mediaKeys.assets })
    },
  })

  return {
    upload: mutation.mutateAsync,
    isUploading: mutation.isPending,
    progress,
    error: mutation.error,
    reset: mutation.reset,
  }
}

export { MediaPermissionError }
