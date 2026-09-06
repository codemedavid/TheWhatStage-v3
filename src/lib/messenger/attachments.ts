import type { SupabaseClient } from '@supabase/supabase-js'

export interface ConversationAttachment {
  type: 'image' | 'video' | 'audio' | 'file' | 'action_page'
  /** Display URL — freshly signed for storage-backed media, null if unavailable. */
  url: string | null
  name: string | null
}

export interface ConversationMessage {
  id: string
  direction: 'inbound' | 'outbound'
  sender: 'user' | 'bot' | 'operator'
  body: string
  created_at: string
  error: string | null
  attachments: ConversationAttachment[]
}

export interface RawMessageRow {
  id: string
  direction: 'inbound' | 'outbound'
  sender: 'user' | 'bot' | 'operator'
  body: string
  created_at: string
  error: string | null
  attachments: unknown
}

// Stored attachment shapes: outbound operator rows persist re-signable
// `storage_path`/`media_asset_id` plus direct `url`s for external/action-page
// sends; inbound Meta rows use `{ type, payload: { url } }`.
type StoredAttachment = {
  type?: string
  url?: string
  storage_path?: string
  name?: string
  payload?: { url?: string }
}

export const MEDIA_ASSETS_BUCKET = 'media-assets'
const DISPLAY_URL_TTL_SECONDS = 60 * 60

export function normalizeAttachmentType(raw: string | undefined): ConversationAttachment['type'] {
  switch (raw) {
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
    case 'action_page':
      return raw
    default:
      return 'file'
  }
}

function storedAttachments(row: { attachments: unknown }): StoredAttachment[] {
  return Array.isArray(row.attachments) ? (row.attachments as StoredAttachment[]) : []
}

// Pure: pick the display URL for one stored attachment given already-signed
// storage paths.
export function attachmentDisplayUrl(a: StoredAttachment, signedByPath: ReadonlyMap<string, string>): string | null {
  return (a.storage_path && signedByPath.get(a.storage_path)) || a.url || a.payload?.url || null
}

/**
 * Normalize the heterogeneous `attachments` jsonb into display-ready entries.
 * Storage-backed entries are re-signed in a single batched pass (signed URLs
 * expire, so only the path is persisted).
 */
export async function resolveMessageAttachments(
  supabase: SupabaseClient,
  rows: RawMessageRow[],
): Promise<ConversationMessage[]> {
  const storagePaths = new Set<string>()
  for (const row of rows) {
    for (const a of storedAttachments(row)) {
      if (typeof a.storage_path === 'string' && a.storage_path) storagePaths.add(a.storage_path)
    }
  }

  const signedByPath = new Map<string, string>()
  await Promise.all(
    [...storagePaths].map(async (path) => {
      const { data } = await supabase.storage
        .from(MEDIA_ASSETS_BUCKET)
        .createSignedUrl(path, DISPLAY_URL_TTL_SECONDS)
      if (data?.signedUrl) signedByPath.set(path, data.signedUrl)
    }),
  )

  return rows.map((row) => ({
    id: row.id,
    direction: row.direction,
    sender: row.sender,
    body: row.body,
    created_at: row.created_at,
    error: row.error,
    attachments: storedAttachments(row).map((a) => ({
      type: normalizeAttachmentType(a.type),
      url: attachmentDisplayUrl(a, signedByPath),
      name: a.name ?? null,
    })),
  }))
}
