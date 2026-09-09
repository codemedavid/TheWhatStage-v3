'use client'

import { createClient } from '@/lib/supabase/client'
import { MEDIA_ASSETS_BUCKET } from '@/lib/messenger/attachments'
import type { UploadIntentEntry } from '@/app/api/media/upload-intent/route'

export interface UploadedMediaAsset {
  id: string
  name: string
  slug: string
  storage_path: string
  mime_type: string
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  return body.error ?? fallback
}

/**
 * Browser-side upload: register the files, PUT each straight into Supabase
 * Storage with a signed upload URL, then publish the rows. Never streams the
 * bytes through our own server.
 */
export async function uploadMediaFiles(args: {
  folderId: string
  files: File[]
  description?: string
  onProgress?: (done: number, total: number) => void
}): Promise<UploadedMediaAsset[]> {
  const { folderId, files, description, onProgress } = args
  if (files.length === 0) return []

  const intentRes = await fetch('/api/media/upload-intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      folderId,
      description: description || undefined,
      files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
    }),
  })
  if (!intentRes.ok) throw new Error(await readError(intentRes, 'Upload failed'))
  const { uploads } = (await intentRes.json()) as { uploads: UploadIntentEntry[] }
  if (uploads.length !== files.length) throw new Error('Upload failed')

  const storage = createClient().storage.from(MEDIA_ASSETS_BUCKET)
  const uploadedIds: string[] = []
  for (let i = 0; i < uploads.length; i++) {
    const entry = uploads[i]
    const { error } = await storage.uploadToSignedUrl(entry.path, entry.token, files[i], {
      contentType: entry.contentType,
      cacheControl: '31536000',
      upsert: false,
    })
    if (error) throw new Error(`${files[i].name}: ${error.message}`)
    uploadedIds.push(entry.assetId)
    onProgress?.(i + 1, uploads.length)
  }

  const completeRes = await fetch('/api/media/upload-complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assetIds: uploadedIds }),
  })
  if (!completeRes.ok) throw new Error(await readError(completeRes, 'Upload failed'))
  const { assets } = (await completeRes.json()) as { assets: UploadedMediaAsset[] }
  return assets
}
