// src/lib/followups/fire.ts
//
// Per-schedule fire handler. Invoked from the messenger worker via the
// `followup_send` job kind. We re-evaluate gates on every fire so a lead
// who completes a booking between schedule creation and the next touchpoint
// stops getting pinged. After a successful send the row is either advanced
// to the next pending offset or marked done.
//
// The schedule carries its own offsets_snapshot (captured at seed time);
// changes to the user's settings after seed do NOT affect in-flight schedules.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptToken } from '@/lib/facebook/crypto'
import { sendOutbound, resolveSendPolicy } from '@/lib/messenger/outbound'
import { isInsideWindow } from '@/lib/agent/classifyPolicy'
import { shouldSeed } from './gates'
import { generateFollowupMessage } from './generateMessage'
import { mintMediaAssetUrl, mintActionPageDeeplink } from './attachments'
import type { SnapshotEntry } from './settings'

function insideWindowKind(lastInboundAt: string | null): 'bot' | 'workflow_human_agent' {
  return isInsideWindow(lastInboundAt) ? 'bot' : 'workflow_human_agent'
}

interface ScheduleRow {
  id: string
  user_id: string
  lead_id: string
  thread_id: string
  page_id: string
  started_at: string
  next_offset_idx: number
  conversation_kind: 'generic' | 'real'
  status: string
  offsets_snapshot: SnapshotEntry[]
}

interface ThreadRow {
  id: string
  psid: string
  last_inbound_at: string | null
  full_name: string | null
}

export interface FollowupSendJob {
  id: string
  payload: { schedule_id: string } | null
}

export async function handleFollowupSend(
  admin: SupabaseClient,
  args: { scheduleId: string },
): Promise<void> {
  const { data: schedule } = await admin
    .from('lead_followup_schedules')
    .select('id, user_id, lead_id, thread_id, page_id, started_at, next_offset_idx, conversation_kind, status, offsets_snapshot')
    .eq('id', args.scheduleId)
    .maybeSingle<ScheduleRow>()

  if (!schedule) return
  if (schedule.status !== 'running' && schedule.status !== 'pending') return

  const snapshot = schedule.offsets_snapshot ?? []
  if (snapshot.length === 0) {
    await markDone(admin, schedule.id)
    return
  }

  const entry = snapshot[schedule.next_offset_idx]
  if (!entry) {
    await markDone(admin, schedule.id)
    return
  }

  const imageMediaAssetId = (entry as { image_media_asset_id?: string | null }).image_media_asset_id ?? null
  const actionPageId      = (entry as { action_page_id?: string | null }).action_page_id ?? null

  // Re-check gates: a lead who booked between scheduling and firing should
  // not receive the touchpoint.
  const gate = await shouldSeed(admin, {
    threadId: schedule.thread_id,
    leadId: schedule.lead_id,
  })
  if (!gate.ok) {
    await markDone(admin, schedule.id)
    return
  }

  // Load thread + page + chatbot personality + last 20 messages.
  const { data: thread } = await admin
    .from('messenger_threads')
    .select('id, psid, last_inbound_at, full_name')
    .eq('id', schedule.thread_id)
    .maybeSingle<ThreadRow>()
  if (!thread) {
    await markDone(admin, schedule.id)
    return
  }

  const { data: page } = await admin
    .from('facebook_pages')
    .select('id, page_access_token')
    .eq('id', schedule.page_id)
    .maybeSingle<{ id: string; page_access_token: string }>()
  if (!page) {
    await markFailed(admin, schedule.id, 'page missing')
    return
  }

  const { data: chatbot } = await admin
    .from('chatbot_configs')
    .select('persona, instructions')
    .eq('user_id', schedule.user_id)
    .maybeSingle<{ persona: string | null; instructions: string | null }>()

  const { data: leadRow } = await admin
    .from('leads')
    .select('name')
    .eq('id', schedule.lead_id)
    .maybeSingle<{ name: string | null }>()

  const personalityBlock = [chatbot?.persona, chatbot?.instructions]
    .filter((s) => typeof s === 'string' && s.trim())
    .join('\n\n')

  // For 'real' conversations, load the last 20 messages so the LLM can
  // reference them. For 'generic', skip the DB read — we don't use them.
  let recentMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  if (schedule.conversation_kind === 'real') {
    const { data: msgs } = await admin
      .from('messenger_messages')
      .select('direction, body, created_at')
      .eq('thread_id', schedule.thread_id)
      .order('created_at', { ascending: false })
      .limit(20)
    recentMessages = ((msgs ?? []) as Array<{ direction: string; body: string }>)
      .reverse()
      .filter((m) => m.body?.trim())
      .map((m) => ({
        role: m.direction === 'outbound' ? ('assistant' as const) : ('user' as const),
        content: m.body,
      }))
  }

  const leadName = leadRow?.name ?? thread.full_name ?? null

  const policy = await resolveSendPolicy(admin, thread.id, thread.last_inbound_at, insideWindowKind(thread.last_inbound_at))
  const canAttach = policy.mode === 'RESPONSE'

  let attachmentHint = ''
  if (canAttach) {
    const hintParts: string[] = []
    if (imageMediaAssetId) {
      const { data: asset } = await admin
        .from('media_assets')
        .select('name')
        .eq('id', imageMediaAssetId)
        .eq('user_id', schedule.user_id)
        .maybeSingle<{ name: string }>()
      if (asset?.name) hintParts.push(`a photo (${asset.name})`)
    }
    if (actionPageId) {
      const { data: pageRow } = await admin
        .from('action_pages')
        .select('title')
        .eq('id', actionPageId)
        .maybeSingle<{ title: string }>()
      if (pageRow?.title) hintParts.push(`a card linking to ${pageRow.title}`)
    }
    attachmentHint = hintParts.join(' and ')
  }

  const text = await generateFollowupMessage({
    kind: schedule.conversation_kind,
    slot: entry.slot,
    leadName,
    personalityBlock,
    recentMessages,
    instruction: entry.instruction ?? '',
    attachmentHint,
  })

  if (!text) {
    await markFailed(admin, schedule.id, 'empty message')
    return
  }

  // Inside 24h → 'bot' (plain RESPONSE). Outside → 'workflow_human_agent'
  // which uses HUMAN_AGENT tag on the send. Same pattern as reminders/fire.
  const insideWindow = isInsideWindow(thread.last_inbound_at)
  const sendKind = insideWindow ? 'bot' : 'workflow_human_agent'
  const pageToken = decryptToken(page.page_access_token)

  const result = await sendOutbound({
    admin,
    thread: { id: thread.id, psid: thread.psid, last_inbound_at: thread.last_inbound_at },
    pageToken,
    payload: { kind: 'text', text },
    kind: sendKind,
  })

  if (!result.sent) {
    const reason = (result as { sent: false; reason: string }).reason
    await markFailed(admin, schedule.id, `send_blocked:${reason}`)
    return
  }

  // Persist the outbound message so it shows up in the inbox and counts
  // toward conversation history. Unique violation on fb_message_id is fine.
  await admin
    .from('messenger_messages')
    .insert({
      thread_id: thread.id,
      user_id: schedule.user_id,
      direction: 'outbound',
      sender: 'bot',
      fb_message_id: result.messageId,
      body: text,
    })
    .then(({ error }) => {
      if (error && (error as { code?: string }).code !== '23505') {
        console.warn('[followups.fire] message insert failed', error.message)
      }
    })

  if (canAttach) {
    if (imageMediaAssetId) {
      const imageUrl = await mintMediaAssetUrl(admin, imageMediaAssetId, schedule.user_id)
      if (imageUrl) {
        try {
          await sendOutbound({
            admin,
            thread: { id: thread.id, psid: thread.psid, last_inbound_at: thread.last_inbound_at },
            pageToken,
            payload: { kind: 'image', imageUrl },
            kind: 'bot',
          })
        } catch (e) {
          console.warn('[followups.fire] image send failed', schedule.id, e instanceof Error ? e.message : String(e))
        }
      }
    }
    if (actionPageId) {
      const url = await mintActionPageDeeplink(admin, actionPageId, {
        psid: thread.psid,
        pageId: thread.page_id,
      })
      if (url) {
        try {
          await sendOutbound({
            admin,
            thread: { id: thread.id, psid: thread.psid, last_inbound_at: thread.last_inbound_at },
            pageToken,
            payload: { kind: 'button', text: 'Tap below to continue 👇', url, ctaLabel: 'View' },
            kind: 'bot',
          })
        } catch (e) {
          console.warn('[followups.fire] button send failed', schedule.id, e instanceof Error ? e.message : String(e))
        }
      }
    }
  } else if (imageMediaAssetId || actionPageId) {
    console.warn('[followups.fire] attachments skipped — outside 24h window', {
      scheduleId: schedule.id,
      slot: entry.slot,
      dropped_image: !!imageMediaAssetId,
      dropped_action_page: !!actionPageId,
    })
  }

  await advanceSchedule(admin, schedule)
}

async function advanceSchedule(admin: SupabaseClient, schedule: ScheduleRow): Promise<void> {
  const snapshot = schedule.offsets_snapshot
  if (schedule.next_offset_idx >= snapshot.length - 1) {
    await markDone(admin, schedule.id)
    return
  }
  const nextIdx = schedule.next_offset_idx + 1
  const nextRunAt = new Date(
    Date.parse(schedule.started_at) + snapshot[nextIdx].offset_ms,
  ).toISOString()
  await admin
    .from('lead_followup_schedules')
    .update({
      next_offset_idx: nextIdx,
      next_run_at: nextRunAt,
      status: 'pending',
      job_id: null,
    })
    .eq('id', schedule.id)
}

async function markDone(admin: SupabaseClient, id: string): Promise<void> {
  await admin.from('lead_followup_schedules').update({ status: 'done' }).eq('id', id)
}

async function markFailed(admin: SupabaseClient, id: string, reason: string): Promise<void> {
  await admin
    .from('lead_followup_schedules')
    .update({ status: 'failed', last_error: reason.slice(0, 500) })
    .eq('id', id)
}

// Worker entry point — called from `messenger/process` route's `runJob`
// branch when `job.kind === 'followup_send'`.
export async function handleFollowupSendJob(
  admin: SupabaseClient,
  job: FollowupSendJob,
): Promise<void> {
  const scheduleId = job.payload?.schedule_id
  if (!scheduleId) {
    await admin
      .from('messenger_jobs')
      .update({ status: 'skipped', finished_at: new Date().toISOString() })
      .eq('id', job.id)
    return
  }
  try {
    await handleFollowupSend(admin, { scheduleId })
    await admin
      .from('messenger_jobs')
      .update({ status: 'done', finished_at: new Date().toISOString() })
      .eq('id', job.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[followups.fire] handler threw', job.id, msg)
    await admin
      .from('messenger_jobs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        last_error: msg.slice(0, 1000),
      })
      .eq('id', job.id)
  }
}
