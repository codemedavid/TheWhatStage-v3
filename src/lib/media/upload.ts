import { MEDIA_KIND_LIMITS, isAllowedMediaMime, mediaKindFromMime, type MediaKind } from './kind'

// Pure helpers behind the direct-to-storage upload flow:
//   1. POST /api/media/upload-intent   → validate + create rows + signed upload URLs
//   2. browser uploads straight to Supabase Storage (bypasses the 4.5 MB
//      request-body ceiling a server-proxied upload would hit on Vercel)
//   3. POST /api/media/upload-complete → verify objects, publish rows, embed

export const MAX_FILES_PER_UPLOAD = 20
const MAX_NAME_LENGTH = 120
const MB = 1024 * 1024

export interface UploadFileMeta {
  name: string
  type: string
  size: number
}

export type UploadValidation = { ok: true } | { ok: false; error: string }

function kindDisplayName(kind: MediaKind): string {
  return kind === 'audio' ? 'Voice message' : kind.charAt(0).toUpperCase() + kind.slice(1)
}

export function validateUploadFiles(files: readonly UploadFileMeta[]): UploadValidation {
  if (files.length === 0) return { ok: false, error: 'No files selected' }
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return { ok: false, error: `Upload at most ${MAX_FILES_PER_UPLOAD} files at a time` }
  }
  for (const file of files) {
    const kind = mediaKindFromMime(file.type)
    if (!kind || !isAllowedMediaMime(file.type)) {
      return { ok: false, error: `${file.name} is not a supported image, video or voice file` }
    }
    if (file.size <= 0) return { ok: false, error: `${file.name} is empty` }
    const cap = MEDIA_KIND_LIMITS[kind].maxBytes
    if (file.size > cap) {
      return { ok: false, error: `${file.name} is over the ${Math.round(cap / MB)} MB limit for ${kind}` }
    }
  }
  return { ok: true }
}

export function defaultAssetName(fileName: string, kind: MediaKind = 'image'): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim().slice(0, MAX_NAME_LENGTH)
  return base || kindDisplayName(kind)
}

export function buildStoragePath(userId: string, folderId: string, assetId: string, fileName: string, kind: MediaKind = 'image'): string {
  const safeName = fileName
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^\.+/, '')
  return `${userId}/${folderId}/${assetId}-${safeName || kind}`
}

/** Voice and video have no visual RAG signal, so the selector needs a description. */
export function needsDescription(mimeType: string, description: string | null | undefined): boolean {
  const kind = mediaKindFromMime(mimeType)
  if (kind !== 'audio' && kind !== 'video') return false
  return !(description ?? '').trim()
}
