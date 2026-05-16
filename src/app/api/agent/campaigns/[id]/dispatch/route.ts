import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

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

  // Mark dispatching.
  await admin
    .from('agent_campaigns')
    .update({ status: 'dispatching', dispatched_at: new Date().toISOString() })
    .eq('id', campaignId)

  // Upsert agent_campaign_messages for all included rows.
  const includedMessages = messages.filter((m) => m.user_included !== false)

  if (includedMessages.length > 0) {
    const messageRows = includedMessages.map((m) => ({
      campaign_id: campaignId,
      lead_id: m.lead_id,
      thread_id: m.thread_id,
      draft_text: m.draft,
      policy_at_preview: m.policy,
      user_included: true,
      user_edited: m.user_edited ?? false,
      status: 'pending',
    }))

    const { error: insertErr } = await admin
      .from('agent_campaign_messages')
      .insert(messageRows)

    if (insertErr) {
      await admin
        .from('agent_campaigns')
        .update({ status: 'failed' })
        .eq('id', campaignId)
      return Response.json({ error: `failed to insert messages: ${insertErr.message}` }, { status: 500 })
    }
  }

  // Fetch the inserted message IDs for job creation.
  const { data: insertedMsgs } = await admin
    .from('agent_campaign_messages')
    .select('id, thread_id')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')

  // Bulk insert messenger_jobs with kind='agent_campaign_send'.
  if (insertedMsgs && insertedMsgs.length > 0) {
    const jobs = insertedMsgs.map((msg) => ({
      thread_id: msg.thread_id as string,
      user_id: userId,
      kind: 'agent_campaign_send',
      payload: { campaign_message_id: msg.id as string },
      status: 'queued',
      scheduled_at: new Date().toISOString(),
    }))

    const { error: jobErr } = await admin.from('messenger_jobs').insert(jobs)
    if (jobErr) {
      await admin
        .from('agent_campaigns')
        .update({ status: 'failed' })
        .eq('id', campaignId)
      return Response.json({ error: `failed to enqueue jobs: ${jobErr.message}` }, { status: 500 })
    }
  }

  // Mark sending.
  await admin
    .from('agent_campaigns')
    .update({
      status: 'sending',
      total: includedMessages.length,
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

  return Response.json({ ok: true, campaign_id: campaignId, enqueued: includedMessages.length })
}
