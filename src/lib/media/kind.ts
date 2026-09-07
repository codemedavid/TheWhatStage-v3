import type { MessengerAttachmentType } from '@/lib/facebook/messenger'

// Media library asset kinds. Derived from mime_type — there is no separate
// column, so every consumer goes through mediaKindFromMime().
export type MediaKind = 'image' | 'video' | 'audio'

export const MEDIA_KINDS: readonly MediaKind[] = ['image', 'video', 'audio']

const MB = 1024 * 1024
// Messenger rejects attachments above 25 MB regardless of type.
export const MESSENGER_ATTACHMENT_MAX_BYTES = 25 * MB

// Formats are deliberately narrow: Messenger renders mp3/m4a/wav audio as a
// playable voice bubble and mp4/mov as inline video. Other containers (webm,
// ogg) arrive as a generic file download, which defeats the "voice message"
// feel — so they are rejected at upload even though the bucket allows them.
export const MEDIA_KIND_LIMITS: Record<MediaKind, { maxBytes: number; mimes: readonly string[]; accept: string }> = {
  image: {
    maxBytes: 10 * MB,
    mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    accept: 'image/jpeg,image/png,image/webp,image/gif',
  },
  video: {
    maxBytes: MESSENGER_ATTACHMENT_MAX_BYTES,
    mimes: ['video/mp4', 'video/quicktime'],
    accept: 'video/mp4,video/quicktime,.mp4,.mov',
  },
  audio: {
    maxBytes: MESSENGER_ATTACHMENT_MAX_BYTES,
    mimes: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav'],
    accept: 'audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,.mp3,.m4a,.wav',
  },
}

export function mediaKindFromMime(mime: string | null | undefined): MediaKind | null {
  if (!mime) return null
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return null
}

export function isAllowedMediaMime(mime: string | null | undefined): boolean {
  const kind = mediaKindFromMime(mime)
  if (!kind || !mime) return false
  return MEDIA_KIND_LIMITS[kind].mimes.includes(mime)
}

export function mediaKindLabel(kind: MediaKind): string {
  return kind === 'audio' ? 'voice message' : kind
}

export function messengerAttachmentTypeFor(mime: string): MessengerAttachmentType {
  const kind = mediaKindFromMime(mime)
  if (!kind) throw new Error(`messengerAttachmentTypeFor: unsupported mime "${mime}"`)
  return kind
}
