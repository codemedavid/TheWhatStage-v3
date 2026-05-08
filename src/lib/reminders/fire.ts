import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptToken } from '@/lib/facebook/crypto'
import { sendOutbound } from '@/lib/messenger/outbound'
import { isInsideWindow } from '@/lib/agent/classifyPolicy'
import { HfRouterLlm } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'

interface ReminderRow {
  id: string
  user_id: string
  lead_id: string
  thread_id: string | null
  topic: string
  status: string
  auto_send: boolean
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

export interface FireResult {
  ok: boolean
  reason?: string
  messageId?: string | null
}

async function generateFollowUpText(topic: string, leadName: string | null): Promise<string> {
  const llm = new HfRouterLlm({ model: ragConfig.classifierModel })
  const system =
    'Write a single short, friendly Messenger follow-up message in the same language the topic is written in. ' +
    'Plain text only, no markdown, no emoji unless natural, max 240 characters. ' +
    'Tone: warm, conversational, professional. Mention the topic naturally. ' +
    'Do not invent facts or details not implied by the topic. End with a soft call to action (a question or invitation).'

  const namePart = leadName ? `Customer first name: ${leadName.split(' ')[0]}\n` : ''
  const userBlock = `${namePart}Topic to follow up on: ${topic}`

  try {
    const raw = await llm.complete(
      [
        { role: 'system', content: system },
        { role: 'user', content: userBlock },
      ],
      { temperature: 0.4, maxTokens: 200 },
    )
    const cleaned = raw.trim().replace(/^["']|["']$/g, '').slice(0, 600)
    if (cleaned.length === 0) throw new Error('empty')
    return cleaned
  } catch {
    const name = leadName ? `Hi ${leadName.split(' ')[0]}, ` : 'Hi! '
    return `${name}just following up on ${topic}. Let me know if you'd still like to chat about it!`
  }
}

/**
 * Fire a reminder synchronously: load it, generate copy, send via Messenger,
 * update status. Used by both the worker and the "Send now" dashboard action.
 */
export async function fireReminder(
  admin: SupabaseClient,
  reminderId: string,
): Promise<FireResult> {
  const { data: reminder } = await admin
    .from('lead_reminders')
    .select('id, user_id, lead_id, thread_id, topic, status, auto_send')
    .eq('id', reminderId)
    .maybeSingle<ReminderRow>()

  if (!reminder) return { ok: false, reason: 'reminder missing' }
  if (reminder.status !== 'pending' && reminder.status !== 'snoozed') {
    return { ok: false, reason: `status_${reminder.status}` }
  }
  if (!reminder.thread_id) {
    await markFailed(admin, reminder.id, 'no thread')
    return { ok: false, reason: 'no thread' }
  }

  const { data: thread } = await admin
    .from('messenger_threads')
    .select('id, psid, last_inbound_at, page_id')
    .eq('id', reminder.thread_id)
    .maybeSingle<ThreadRow>()
  if (!thread) {
    await markFailed(admin, reminder.id, 'thread missing')
    return { ok: false, reason: 'thread missing' }
  }

  const { data: page } = await admin
    .from('facebook_pages')
    .select('id, page_access_token')
    .eq('id', thread.page_id)
    .maybeSingle<PageRow>()
  if (!page) {
    await markFailed(admin, reminder.id, 'page missing')
    return { ok: false, reason: 'page missing' }
  }

  const { data: lead } = await admin
    .from('leads')
    .select('name')
    .eq('id', reminder.lead_id)
    .maybeSingle<{ name: string | null }>()

  const text = await generateFollowUpText(reminder.topic, lead?.name ?? null)

  const insideWindow = isInsideWindow(thread.last_inbound_at)
  const sendKind = insideWindow ? 'bot' : 'workflow_human_agent'
  const pageToken = decryptToken(page.page_access_token)

  const result = await sendOutbound({
    admin,
    thread: {
      id: thread.id,
      psid: thread.psid,
      last_inbound_at: thread.last_inbound_at,
    },
    pageToken,
    payload: { kind: 'text', text },
    kind: sendKind,
  })

  if (!result.sent) {
    const reason = (result as { sent: false; reason: string }).reason
    await admin
      .from('lead_reminders')
      .update({
        status: 'failed',
        fired_at: new Date().toISOString(),
        resolved_reason: null,
      })
      .eq('id', reminder.id)
    return { ok: false, reason }
  }

  await admin
    .from('lead_reminders')
    .update({
      status: 'sent',
      fired_at: new Date().toISOString(),
    })
    .eq('id', reminder.id)

  await admin
    .from('messenger_messages')
    .insert({
      thread_id: thread.id,
      user_id: reminder.user_id,
      direction: 'outbound',
      sender: 'bot',
      fb_message_id: result.messageId,
      body: text,
    })
    .then(({ error }) => {
      if (error && (error as { code?: string }).code !== '23505') {
        console.warn('[reminders.fire] message insert failed', error.message)
      }
    })

  return { ok: true, messageId: result.messageId ?? null }
}

async function markFailed(admin: SupabaseClient, id: string, _reason: string): Promise<void> {
  await admin
    .from('lead_reminders')
    .update({ status: 'failed', fired_at: new Date().toISOString() })
    .eq('id', id)
}

interface ReminderJob {
  id: string
  payload: { reminder_id: string } | null
}

export async function handleReminderFire(
  admin: SupabaseClient,
  job: ReminderJob,
): Promise<void> {
  const reminderId = job.payload?.reminder_id
  if (!reminderId) {
    await markJobDone(admin, job.id, 'skipped')
    return
  }
  const result = await fireReminder(admin, reminderId)
  await markJobDone(admin, job.id, result.ok ? 'done' : 'failed')
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
