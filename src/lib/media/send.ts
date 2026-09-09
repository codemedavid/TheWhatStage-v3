import type { SupabaseClient } from '@supabase/supabase-js'
import { sendOutbound, type OutboundPayload, type SendKind } from '@/lib/messenger/outbound'
import { MEDIA_ASSETS_BUCKET } from '@/lib/messenger/attachments'
import { mediaKindFromMime } from './kind'

// Shared "send library assets to a thread" path used by the chatbot,
// auto follow-ups, sequences, workflows and agent campaigns. It mints a
// short-lived signed URL, dispatches by kind through sendOutbound (so channel
// policy still applies), and persists the inbox row with the re-signable
// attachment shape the timeline already understands.

const SIGNED_URL_TTL_SECONDS = 60 * 60
const UNIQUE_VIOLATION = '23505'

export interface SendableMediaAsset {
  id: string
  name: string
  slug: string
  storagePath: string
  mimeType: string
}

export interface SendMediaThread {
  id: string
  psid: string
  last_inbound_at: string | null
  user_id: string
}

export interface SendMediaResult {
  sent: Array<{ assetId: string; messageId: string }>
  skipped: Array<{ assetId: string; reason: string }>
}

interface SendableAssetRow {
  id: string
  name: string
  slug: string
  storage_path: string
  mime_type: string
  is_archived: boolean
}

export function buildMediaPayload(mimeType: string, url: string): OutboundPayload {
  const kind = mediaKindFromMime(mimeType)
  if (!kind) throw new Error(`buildMediaPayload: unsupported mime "${mimeType}"`)
  return kind === 'image' ? { kind: 'image', imageUrl: url } : { kind, url }
}

export function mediaMessageBody(asset: Pick<SendableMediaAsset, 'name' | 'mimeType'>): string {
  return `[${mediaKindFromMime(asset.mimeType) ?? 'file'}] ${asset.name}`
}

/** Load user-owned, non-archived assets by id, preserving the requested order. */
export async function loadSendableAssets(
  admin: SupabaseClient,
  userId: string,
  assetIds: readonly string[],
): Promise<SendableMediaAsset[]> {
  if (assetIds.length === 0) return []
  const { data, error } = await admin
    .from('media_assets')
    .select('id, name, slug, storage_path, mime_type, is_archived')
    .eq('user_id', userId)
    .in('id', [...assetIds])
  if (error) throw new Error(`loadSendableAssets: ${error.message}`)

  const byId = new Map<string, SendableAssetRow>()
  for (const row of (data ?? []) as SendableAssetRow[]) {
    if (!row.is_archived) byId.set(row.id, row)
  }
  return assetIds.flatMap((id) => {
    const row = byId.get(id)
    return row
      ? [{ id: row.id, name: row.name, slug: row.slug, storagePath: row.storage_path, mimeType: row.mime_type }]
      : []
  })
}

async function signAll(
  admin: SupabaseClient,
  assets: readonly SendableMediaAsset[],
): Promise<Array<{ asset: SendableMediaAsset; url: string | null }>> {
  return Promise.all(
    assets.map(async (asset) => {
      const { data, error } = await admin.storage
        .from(MEDIA_ASSETS_BUCKET)
        .createSignedUrl(asset.storagePath, SIGNED_URL_TTL_SECONDS)
      return { asset, url: error ? null : (data?.signedUrl ?? null) }
    }),
  )
}

async function persistInboxRow(
  admin: SupabaseClient,
  args: { thread: SendMediaThread; asset: SendableMediaAsset; messageId: string; sender: 'bot' | 'operator'; logTag: string },
): Promise<void> {
  const { thread, asset, messageId, sender, logTag } = args
  const { error } = await admin.from('messenger_messages').insert({
    thread_id: thread.id,
    user_id: thread.user_id,
    direction: 'outbound',
    sender,
    fb_message_id: messageId,
    media_asset_id: asset.id,
    body: mediaMessageBody(asset),
    attachments: [{ type: mediaKindFromMime(asset.mimeType), media_asset_id: asset.id, storage_path: asset.storagePath }],
  })
  if (error && (error as { code?: string }).code !== UNIQUE_VIOLATION) {
    console.warn(`[${logTag}] media inbox row insert failed`, { assetId: asset.id, err: error.message })
  }
}

export async function sendMediaAssets(args: {
  admin: SupabaseClient
  thread: SendMediaThread
  pageToken: string
  assets: readonly SendableMediaAsset[]
  kind: SendKind
  sender: 'bot' | 'operator'
  logTag: string
}): Promise<SendMediaResult> {
  const { admin, thread, pageToken, assets, kind, sender, logTag } = args
  if (assets.length === 0) return { sent: [], skipped: [] }

  // Sign up front, in parallel, so the bubbles land back-to-back.
  const signed = await signAll(admin, assets)
  const sent: SendMediaResult['sent'] = []
  const skipped: SendMediaResult['skipped'] = []

  for (let i = 0; i < signed.length; i++) {
    const { asset, url } = signed[i]
    if (!url) {
      console.error(`[${logTag}] media sign failed`, { assetId: asset.id, slug: asset.slug })
      skipped.push({ assetId: asset.id, reason: 'sign_failed' })
      continue
    }
    try {
      const result = await sendOutbound({
        admin,
        thread: { id: thread.id, psid: thread.psid, last_inbound_at: thread.last_inbound_at },
        pageToken,
        payload: buildMediaPayload(asset.mimeType, url),
        kind,
      })
      if (!result.sent) {
        // A policy block applies to the whole thread — no point trying the rest.
        const reason = `send_blocked:${result.reason}`
        for (const rest of signed.slice(i)) skipped.push({ assetId: rest.asset.id, reason })
        console.warn(`[${logTag}] media send blocked`, { threadId: thread.id, reason: result.reason })
        return { sent, skipped }
      }
      sent.push({ assetId: asset.id, messageId: result.messageId })
      await persistInboxRow(admin, { thread, asset, messageId: result.messageId, sender, logTag })
    } catch (e) {
      console.warn(`[${logTag}] media send failed`, {
        assetId: asset.id,
        err: e instanceof Error ? e.message : String(e),
      })
      skipped.push({ assetId: asset.id, reason: 'send_failed' })
    }
  }
  return { sent, skipped }
}
