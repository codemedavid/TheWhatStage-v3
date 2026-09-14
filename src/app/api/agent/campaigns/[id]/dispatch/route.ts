import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { chunk } from '@/lib/agent/batch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Rows per INSERT. Keeps each request body small and, because we read the
// inserted ids back via `.select()`, each response under PostgREST max_rows.
const INSERT_CHUNK_SIZE = 500

interface DraftMessage {
  lead_id: string
  thread_id: string
  draft: string
  policy: string
  user_included: boolean
  user_edited?: boolean
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: campaignId } = await params

  const supabase = await createClient()
  const claims = await supabase.auth.getClaims()
  let userId: string | undefined = claims.data?.claims?.sub
  if (!userId) {
    const { data } = await supabase.auth.getUser()
    userId = data.user?.id
  }
  if (!userId) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  let messages: DraftMessage[] = []
  try {
    const body = await req.json() as { messages?: unknown }
    if (Array.isArray(body.messages)) {
      messages = body.messages
        .filter((m): m is DraftMessage =>
          m != null &&
          typeof m === 'object' &&
          typeof (m as DraftMessage).lead_id === 'string' &&
          typeof (m as DraftMessage).thread_id === 'string' &&
          typeof (m as DraftMessage).draft === 'string' &&
          typeof (m as DraftMessage).policy === 'string',
        )
    }
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  if (messages.length === 0) {
    return Response.json({ error: 'no messages to dispatch' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verify this campaign belongs to the authenticated user.
  const { data: campaign, error: camErr } = await admin
    .from('agent_campaigns')
    .select('id, status')
    .eq('id', campaignId)
    .eq('user_id', userId)
    .single<{ id: string; status: string }>()

  if (camErr || !campaign) {
    return Response.json({ error: 'campaign not found' }, { status: 404 })
  }

  if (!['previewing', 'failed'].includes(campaign.status)) {
    return Response.json({ error: `campaign is ${campaign.status} — cannot dispatch` }, { status: 409 })
  }

  // Atomically claim the campaign for dispatch. The status predicate in the
  // WHERE clause makes this a compare-and-set: two concurrent dispatch POSTs
  // (e.g. a double-clicked Send button that slips past the client guard) will
  // both pass the read above, but only ONE UPDATE matches a dispatchable
  // status — the other matches zero rows and bails here, so messages and jobs
  // are never inserted twice.
  const { data: claimed, error: claimErr } = await admin
    .from('agent_campaigns')
    .update({ status: 'dispatching', dispatched_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('user_id', userId)
    .in('status', ['previewing', 'failed'])
    .select('id')

  if (claimErr) {
    return Response.json({ error: `failed to claim campaign: ${claimErr.message}` }, { status: 500 })
  }
  if (!claimed || claimed.length === 0) {
    return Response.json({ error: 'campaign is already being dispatched' }, { status: 409 })
  }

  const failCampaign = async (message: string, status = 500) => {
    await admin.from('agent_campaigns').update({ status: 'failed' }).eq('id', campaignId)
    return Response.json({ error: message }, { status })
  }

  const includedMessages = messages.filter((m) => m.user_included !== false)

  // Insert campaign messages in chunks, reading the generated ids straight
  // back from each INSERT. (Re-querying `status = 'pending'` afterwards
  // silently capped the result at max_rows, so campaigns over 1000 leads
  // only ever enqueued the first 1000.)
  const inserted: Array<{ id: string; thread_id: string }> = []
  for (const batch of chunk(includedMessages, INSERT_CHUNK_SIZE)) {
    const rows = batch.map((m) => ({
      campaign_id: campaignId,
      lead_id: m.lead_id,
      thread_id: m.thread_id,
      draft_text: m.draft,
      policy_at_preview: m.policy,
      user_included: true,
      user_edited: m.user_edited ?? false,
      status: 'pending',
    }))
    const { data, error } = await admin
      .from('agent_campaign_messages')
      .insert(rows)
      .select('id, thread_id')
    if (error) return failCampaign(`failed to insert messages: ${error.message}`)
    inserted.push(...((data ?? []) as Array<{ id: string; thread_id: string }>))
  }

  // Enqueue one messenger_jobs row (kind='agent_campaign_send') per message.
  const scheduledAt = new Date().toISOString()
  for (const batch of chunk(inserted, INSERT_CHUNK_SIZE)) {
    const jobs = batch.map((msg) => ({
      thread_id: msg.thread_id,
      user_id: userId,
      kind: 'agent_campaign_send',
      payload: { campaign_message_id: msg.id },
      status: 'queued',
      scheduled_at: scheduledAt,
    }))
    const { error } = await admin.from('messenger_jobs').insert(jobs)
    if (error) return failCampaign(`failed to enqueue jobs: ${error.message}`)
  }

  // Mark sending. `total` is what the worker's completion check counts up to.
  // Nothing enqueued means nothing will ever bump the counters, so complete
  // immediately instead of leaving the campaign in 'sending'.
  const nothingToSend = inserted.length === 0
  await admin
    .from('agent_campaigns')
    .update({
      status: nothingToSend ? 'completed' : 'sending',
      total: inserted.length,
      ...(nothingToSend ? { completed_at: new Date().toISOString() } : {}),
    })
    .eq('id', campaignId)

  // Fire-and-forget trigger to the messenger worker.
  const workerUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/messenger/process`
    : null

  if (workerUrl && process.env.MESSENGER_WORKER_SECRET) {
    fetch(workerUrl, {
      method: 'POST',
      headers: { 'x-worker-secret': process.env.MESSENGER_WORKER_SECRET },
    }).catch((err) =>
      console.warn('[agent.dispatch] worker trigger failed (cron will recover)', err),
    )
  }

  return Response.json({ ok: true, campaign_id: campaignId, enqueued: inserted.length })
}
