// Browser-side operator attachment upload.
//
// Why this exists: the previous flow POSTed the file to our own Next route
// (`/api/messenger/operator-upload`), which on Vercel runs as a serverless
// function with a ~4.5 MB request-body cap. A trimmed voice clip re-encoded to
// uncompressed WAV easily exceeds that, so Meta/our 25 MB ceiling was never the
// real limit — the platform rejected the body with a 413 first ("trim to a
// shorter selection"), which reads to operators as an audio duration limit.
//
// This module uploads the bytes straight from the browser to ImageKit using a
// short-lived signature minted by `/api/messenger/imagekit-auth`. The file never
// transits our function, so the true limit becomes our own 25 MB check below.

import { attachmentTypeFromFile, type AttachmentType } from './attachment-file'

/** Mirrors the server's historical cap; now enforced client-side before upload. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

const IMAGEKIT_UPLOAD_URL = 'https://upload.imagekit.io/api/v1/files/upload'
const AUTH_ENDPOINT = '/api/messenger/imagekit-auth'

export type ValidationResult =
  | { ok: true; attachmentType: AttachmentType }
  | { ok: false; error: string }

export type UploadOk = { url: string; attachmentType: AttachmentType; name: string }
export type UploadResult = UploadOk | { error: string }

interface ImageKitAuth {
  token: string
  expire: number
  signature: string
  publicKey: string
  folder: string
}

function isPdf(file: { name: string; type: string }): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

/** Sanitize a filename the same way the old server route did. */
function safeFileName(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'upload'
}

/**
 * Validate size and type before spending an upload. The allowlist is enforced
 * via {@link attachmentTypeFromFile} (extension-aware, so iPadOS picks with an
 * empty MIME still classify); the only `file` type we accept is PDF — any other
 * value that falls through to `file` is an unsupported type.
 */
export function validateOperatorFile(file: { name: string; type: string; size: number }): ValidationResult {
  if (file.size === 0) return { ok: false, error: 'File is empty' }
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: 'File exceeds 25 MB limit' }

  const attachmentType = attachmentTypeFromFile(file)
  if (attachmentType === 'file' && !isPdf(file)) {
    return { ok: false, error: `Unsupported file type: ${file.type || 'unknown'}` }
  }
  return { ok: true, attachmentType }
}

/**
 * Upload a single operator attachment directly to ImageKit and return the
 * permanent URL Meta can fetch. Never throws — all failures map to
 * `{ error }` so callers surface a clear, actionable message.
 */
export async function uploadOperatorAttachment(file: File): Promise<UploadResult> {
  const validation = validateOperatorFile(file)
  if (!validation.ok) return { error: validation.error }

  // 1. Mint a short-lived, operator-scoped upload signature from our server.
  let auth: ImageKitAuth
  try {
    const res = await fetch(AUTH_ENDPOINT)
    if (!res.ok) return { error: `Upload auth failed (${res.status})` }
    auth = (await res.json()) as ImageKitAuth
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Upload auth failed' }
  }

  // 2. Send the bytes straight to ImageKit — bypassing our serverless body cap.
  const form = new FormData()
  form.append('file', file)
  form.append('fileName', safeFileName(file.name))
  form.append('publicKey', auth.publicKey)
  form.append('signature', auth.signature)
  form.append('expire', String(auth.expire))
  form.append('token', auth.token)
  form.append('useUniqueFileName', 'true')
  if (auth.folder) form.append('folder', auth.folder)

  try {
    const res = await fetch(IMAGEKIT_UPLOAD_URL, { method: 'POST', body: form })
    const json = (await res.json()) as { url?: string; message?: string }
    if (!res.ok) {
      return { error: json?.message || `Upload failed (${res.status})` }
    }
    if (!json.url) return { error: 'Upload failed: no URL returned' }
    return {
      url: json.url,
      attachmentType: validation.attachmentType,
      name: file.name.slice(0, 200),
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Upload failed' }
  }
}
