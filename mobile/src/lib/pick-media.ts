import * as ImagePicker from 'expo-image-picker'
import { File } from 'expo-file-system'

// Wraps expo-image-picker so the rest of the app never deals with permission
// dialogs or the picker's nullable metadata. Everything it returns is ready for
// /api/mobile/media/upload-intent, which re-validates it server-side anyway.

/** Upload-ready description of one file the operator chose. */
export interface PickedMedia {
  uri: string
  name: string
  mimeType: string
  size: number
}

export type PickSource = 'library' | 'camera'

/** Mirrors the dashboard picker: photos and video, no audio from the roll. */
const MEDIA_TYPES: ImagePicker.MediaType[] = ['images', 'videos']
const SELECTION_LIMIT = 10
/**
 * Any value below 1 makes iOS re-encode to JPEG, which is what turns an iPhone
 * HEIC into something `media_assets_mime_type_check` accepts. Do not raise it
 * to 1 without handling HEIC another way.
 */
const IMAGE_QUALITY = 0.9

const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
}

function extensionOf(value: string): string {
  const match = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(value)
  return match ? match[1].toLowerCase() : ''
}

function fallbackName(asset: ImagePicker.ImagePickerAsset): string {
  const ext = extensionOf(asset.uri) || (asset.type === 'video' ? 'mp4' : 'jpg')
  return `${asset.type === 'video' ? 'video' : 'photo'}-${Date.now()}.${ext}`
}

/**
 * The picker leaves `mimeType` and `fileSize` null on some Android paths, so
 * the file on disk is the source of truth and the asset only fills the gaps.
 *
 * A file we cannot type is passed along as octet-stream rather than dropped:
 * the upload route rejects it by name ("X is not a supported image…"), which
 * an operator can act on, whereas a silently missing file looks like a bug.
 */
function describe(asset: ImagePicker.ImagePickerAsset): PickedMedia {
  const name = asset.fileName?.trim() || fallbackName(asset)
  let size = asset.fileSize ?? 0
  let mimeType = asset.mimeType ?? ''
  try {
    const file = new File(asset.uri)
    if (file.size > 0) size = file.size
    if (file.type) mimeType = file.type
  } catch {
    // An unreadable URI still has the picker's metadata; the upload itself
    // fails loudly further down if the file really is gone.
  }
  if (!mimeType) mimeType = EXTENSION_MIME[extensionOf(name)] ?? 'application/octet-stream'
  return { uri: asset.uri, name, mimeType, size }
}

export class MediaPermissionError extends Error {}

async function ensurePermission(source: PickSource): Promise<void> {
  const result =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (result.granted) return
  throw new MediaPermissionError(
    source === 'camera'
      ? 'Allow camera access in Settings to take a photo.'
      : 'Allow photo access in Settings to upload from your library.',
  )
}

/**
 * Opens the camera roll or the camera. Returns an empty array when the operator
 * backs out, and throws MediaPermissionError when access was denied.
 */
export async function pickMedia(source: PickSource): Promise<PickedMedia[]> {
  await ensurePermission(source)
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: MEDIA_TYPES, quality: IMAGE_QUALITY })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: MEDIA_TYPES,
          quality: IMAGE_QUALITY,
          allowsMultipleSelection: true,
          selectionLimit: SELECTION_LIMIT,
        })
  if (result.canceled) return []
  return result.assets.map(describe)
}
