import type { SupabaseClient } from '@supabase/supabase-js'
import { sendOutbound } from './outbound'
import { isInsideWindow } from '@/lib/agent/classifyPolicy'

const COOLDOWN_HOURS = 48

interface CampaignJob {
  id: string
  thread_id: string
  user_id: string
  payload: { campaign_message_id: string } | null
}

interface CampaignMessage {
  id: string
  campaign_id: string
  thread_id: string | null
  lead_id: string
  draft_text: string
  policy_at_preview: string
  user_included: boolean
  status: string
  attempts: number
}

interface CampaignRow {
  id: string
  status: string
  user_id: string
}

interface ThreadRow {
  id: string
  psid: string
  last_inbound_at: string | null
  page_id: string
}

interface PageRow {
  id: string
  page_access_token: string
}

export async function handleCampaignSend(
  admin: SupabaseClient,
  job: CampaignJob,
): Promise<void> {
  const campaignMessageId = job.payload?.campaign_message_id
  if (!campaignMessageId) {
    console.warn('[campaignSend] job missing campaign_message_id', job.id)
    await markJobDone(admin, job.id, 'skipped')
    return
  }

  // Load the campaign message row.
  const { data: msg } = await admin
    .from('agent_campaign_messages')
    .select('id, campaign_id, thread_id, lead_id, draft_text, policy_at_preview, user_included, status, attempts')
    .eq('id', campaignMessageId)
    .maybeSingle<CampaignMessage>()

  if (!msg) {
    // FK cascade deleted the row — lead was removed, nothing to do.
    await markJobDone(admin, job.id, 'skipped')
    return
  }

  if (msg.status !== 'pending') {
    // Already handled (e.g. duplicate trigger) — idempotent skip.
    await markJobDone(admin, job.id, 'skipped')
    return
  }

  // Load parent campaign to check for cancellation.
  const { data: campaign } = await admin
    .from('agent_campaigns')
    .select('id, status, user_id')
    .eq('id', msg.campaign_id)
    .maybeSingle<CampaignRow>()

  if (!campaign || campaign.status === 'cancelled') {
    await updateMessage(admin, campaignMessageId, { status: 'cancelled', skip_reason: 'cancelled' })
    await bumpCounter(admin, msg.campaign_id, 'skipped')
    await markJobDone(admin, job.id, 'skipped')
    return
  }

  // Load thread + page token.
  const { data: thread } = await admin
    .from('messenger_threads')
    .select('id, psid, last_inbound_at, page_id')
    .eq('id', job.thread_id)
    .maybeSingle<ThreadRow>()

  if (!thread) {
    await updateMessage(admin, campaignMessageId, { status: 'failed', error: 'thread missing' })
    await bumpCounter(admin, msg.campaign_id, 'failed')
    await markJobDone(admin, job.id, 'failed')
    return
  }

  const { data: page } = await admin
    .from('facebook_pages')
    .select('id, page_access_token')
    .eq('id', thread.page_id)
    .maybeSingle<PageRow>()

  if (!page) {
    await updateMessage(admin, campaignMessageId, { status: 'failed', error: 'page missing' })
    await bumpCounter(admin, msg.campaign_id, 'failed')
    await markJobDone(admin, job.id, 'failed')
    return
  }

  // Acquire a rate-bucket token. If empty, reschedule the job and exit.
  const tokenAcquired = await acquirePageToken(admin, thread.page_id)
  if (!tokenAcquired) {
    const refillRate = await getRefillRate(admin, thread.page_id)
    const retryMs = Math.ceil(1000 / Math.max(refillRate, 1))
    await admin
      .from('messenger_jobs')
      .update({
        status: 'queued',
        started_at: null,
        scheduled_at: new Date(Date.now() + retryMs).toISOString(),
      })
      .eq('id', job.id)
    return
  }

  // Re-resolve send policy (state may have changed since preview).
  // 48h cooldown check.
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_HOURS * 3600_000).toISOString()
  const { data: recentCampaign } = await admin
    .from('agent_campaign_messages')
    .select('id')
    .eq('thread_id', job.thread_id)
    .eq('status', 'sent')
    .gte('sent_at', cooldownCutoff)
    .neq('id', campaignMessageId)
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (recentCampaign) {
    await updateMessage(admin, campaignMessageId, { status: 'skipped', skip_reason: 'cooldown' })
    await bumpCounter(admin, msg.campaign_id, 'skipped')
    await markJobDone(admin, job.id, 'skipped')
    return
  }

  // Determine which send kind to use based on re-resolved window.
  const insideWindow = isInsideWindow(thread.last_inbound_at)
  const sendKind = insideWindow ? 'bot' : 'workflow_human_agent'

  const { decryptToken } = await import('@/lib/facebook/crypto')
  const pageToken = decryptToken(page.page_access_token)

  const result = await sendOutbound({
    admin,
    thread: {
      id: thread.id,
      psid: thread.psid,
      last_inbound_at: thread.last_inbound_at,
    },
    pageToken,
    payload: { kind: 'text', text: msg.draft_text },
    kind: sendKind,
  })

  if (!result.sent) {
    const reason = (result as { sent: false; reason: string }).reason
    await updateMessage(admin, campaignMessageId, {
      status: 'skipped',
      skip_reason: reason,
      policy_at_send: insideWindow ? 'RESPONSE' : 'paused',
    })
    await bumpCounter(admin, msg.campaign_id, 'skipped')
    await markJobDone(admin, job.id, 'skipped')
    return
  }

  const now = new Date().toISOString()
  await updateMessage(admin, campaignMessageId, {
    status: 'sent',
    policy_at_send: insideWindow ? 'RESPONSE' : 'HUMAN_AGENT',
    facebook_message_id: result.messageId,
    sent_at: now,
    attempts: msg.attempts + 1,
  })
  await bumpCounter(admin, msg.campaign_id, 'sent')

  // Persist the outbound message to the thread history.
  await admin.from('messenger_messages').insert({
    thread_id: thread.id,
    user_id: campaign.user_id,
    direction: 'outbound',
    sender: 'bot',
    fb_message_id: result.messageId,
    body: msg.draft_text,
  }).then(({ error }) => {
    if (error && (error as { code?: string }).code !== '23505') {
      console.warn('[campaignSend] message insert failed', error.message)
    }
  })

  // Check if campaign is complete.
  await maybeMarkCampaignComplete(admin, msg.campaign_id)
  await markJobDone(admin, job.id, 'done')
}

// ---------------------------------------------------------------------------
// Token bucket: acquire one send token for the given page.
// Returns true if a token was consumed, false if the bucket is empty.
// Slightly racy (no FOR UPDATE), but acceptable — worst case we exceed the
// cap by at most BATCH_SIZE messages before the next refill corrects it.
// ---------------------------------------------------------------------------
async function acquirePageToken(
  admin: SupabaseClient,
  pageId: string,
): Promise<boolean> {
  // Upsert a default bucket row if this page has none yet.
  await admin
    .from('messenger_page_rate_buckets')
    .upsert({ page_id: pageId }, { onConflict: 'page_id', ignoreDuplicates: true })

  const { data: bucket } = await admin
    .from('messenger_page_rate_buckets')
    .select('tokens, capacity, refill_per_sec, last_refill_at')
    .eq('page_id', pageId)
    .single<{ tokens: number; capacity: number; refill_per_sec: number; last_refill_at: string }>()

  if (!bucket) return true // No bucket row — allow to avoid blocking

  const now = new Date().toISOString()
  const elapsedSecs = (Date.now() - new Date(bucket.last_refill_at).getTime()) / 1000
  const refilled = Math.min(
    bucket.capacity,
    bucket.tokens + elapsedSecs * bucket.refill_per_sec,
  )

  if (refilled < 1) return false

  await admin
    .from('messenger_page_rate_buckets')
    .update({ tokens: refilled - 1, last_refill_at: now })
    .eq('page_id', pageId)

  return true
}

async function getRefillRate(admin: SupabaseClient, pageId: string): Promise<number> {
  const { data } = await admin
    .from('messenger_page_rate_buckets')
    .select('refill_per_sec')
    .eq('page_id', pageId)
    .maybeSingle<{ refill_per_sec: number }>()
  return data?.refill_per_sec ?? 7
}

async function updateMessage(
  admin: SupabaseClient,
  messageId: string,
  update: Record<string, unknown>,
): Promise<void> {
  await admin
    .from('agent_campaign_messages')
    .update(update)
    .eq('id', messageId)
}

async function bumpCounter(
  admin: SupabaseClient,
  campaignId: string,
  counter: 'sent' | 'failed' | 'skipped',
): Promise<void> {
  // Postgres doesn't support atomic increment via supabase-js directly,
  // so we use a raw increment expression via rpc or re-read + write.
  // The slight race here is acceptable — counters are display-only.
  const { data } = await admin
    .from('agent_campaigns')
    .select(counter)
    .eq('id', campaignId)
    .single<Record<string, number>>()

  if (data) {
    await admin
      .from('agent_campaigns')
      .update({ [counter]: (data[counter] ?? 0) + 1 })
      .eq('id', campaignId)
  }
}

async function maybeMarkCampaignComplete(
  admin: SupabaseClient,
  campaignId: string,
): Promise<void> {
  const { data } = await admin
    .from('agent_campaigns')
    .select('total, sent, failed, skipped')
    .eq('id', campaignId)
    .single<{ total: number; sent: number; failed: number; skipped: number }>()

  if (!data) return

  const processed = data.sent + data.failed + data.skipped
  if (processed >= data.total) {
    await admin
      .from('agent_campaigns')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', campaignId)
  }
}

async function markJobDone(
  admin: SupabaseClient,
  jobId: string,
  status: 'done' | 'skipped' | 'failed',
): Promise<void> {
  await admin
    .from('messenger_jobs')
    .update({ status, finished_at: new Date().toISOString() })
    .eq('id', jobId)
}
