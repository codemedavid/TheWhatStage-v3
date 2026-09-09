import type { SupabaseClient } from '@supabase/supabase-js'
import { loadSendableAssets, sendMediaAssets } from '@/lib/media/send'

export interface CampaignMediaResult {
  sent: number
  skipped: number
  reason: 'outside_window' | 'media_failed' | null
}

// Campaign attachments (image / video / voice from the library) go out right
// after the per-lead text. They only ride the 24h RESPONSE window: the
// HUMAN_AGENT text path is fine for text, but stacking media on it is not
// something we want a bot doing unattended. Never throws — the text already
// landed, so a media hiccup must not flip the campaign message to failed.
export async function sendCampaignMedia(
  admin: SupabaseClient,
  args: {
    campaign: { id: string; user_id: string; media_asset_ids: string[] | null | undefined }
    thread: { id: string; psid: string; last_inbound_at: string | null }
    pageToken: string
    insideWindow: boolean
  },
): Promise<CampaignMediaResult> {
  const ids = args.campaign.media_asset_ids ?? []
  if (ids.length === 0) return { sent: 0, skipped: 0, reason: null }
  if (!args.insideWindow) {
    console.warn('[campaignSend] media skipped — outside 24h window', { campaignId: args.campaign.id, threadId: args.thread.id, count: ids.length })
    return { sent: 0, skipped: ids.length, reason: 'outside_window' }
  }
  try {
    const assets = await loadSendableAssets(admin, args.campaign.user_id, ids)
    const result = await sendMediaAssets({
      admin,
      thread: { ...args.thread, user_id: args.campaign.user_id },
      pageToken: args.pageToken,
      assets,
      kind: 'bot',
      sender: 'bot',
      logTag: 'campaignSend',
    })
    return { sent: result.sent.length, skipped: result.skipped.length, reason: null }
  } catch (e) {
    console.warn('[campaignSend] media failed', { campaignId: args.campaign.id, err: e instanceof Error ? e.message : String(e) })
    return { sent: 0, skipped: ids.length, reason: 'media_failed' }
  }
}
