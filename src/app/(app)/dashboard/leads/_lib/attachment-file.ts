// Helpers for classifying operator-uploaded attachments by type.
//
// iPadOS/iOS quirks this guards against:
//  1. A file <input> whose `accept` only lists the `audio/*` wildcard greys out
//     mp3/m4a/etc. in the Files picker. Listing explicit extensions re-enables
//     them, so ATTACHMENT_ACCEPT includes both the wildcard and the extensions.
//  2. Files chosen from the iPadOS Files app frequently arrive with an empty or
//     generic MIME type, so detection must fall back to the file extension.

export type AttachmentType = 'image' | 'video' | 'audio' | 'file'

const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'amr', 'aiff', 'aif', 'weba']
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', '3gp']
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'svg']

export const ATTACHMENT_ACCEPT = [
  'image/*',
  'video/mp4',
  'video/quicktime',
  'audio/*',
  'application/pdf',
  // Explicit audio extensions: iPadOS/iOS greys these out when only `audio/*` is
  // present, so list them to keep mp3/m4a/etc. selectable in the Files picker.
  ...AUDIO_EXTENSIONS.map((ext) => `.${ext}`),
].join(',')

type FileLike = { name: string; type: string }

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function isAudioFile(file: FileLike): boolean {
  if (file.type.startsWith('audio/')) return true
  // A concrete non-audio MIME is authoritative; only fall back to the extension
  // when the picker gave us nothing useful (empty / generic octet-stream).
  if (file.type.startsWith('image/') || file.type.startsWith('video/')) return false
  return AUDIO_EXTENSIONS.includes(extensionOf(file.name))
}

export function attachmentTypeFromFile(file: FileLike): AttachmentType {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'

  // MIME missing or generic (common on iPadOS Files picks) — use the extension.
  const ext = extensionOf(file.name)
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio'
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  return 'file'
}
