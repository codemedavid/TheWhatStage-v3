'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/facebook/crypto'
import { sendMessengerText } from '@/lib/facebook/messenger'

export interface ConversationMessage {
  id: string
  direction: 'inbound' | 'outbound'
  sender: 'user' | 'bot' | 'operator'
  body: string
  created_at: string
  error: string | null
}

export interface ConversationComment {
  id: string
  fb_comment_id: string
  message: string
  commenter_name: string | null
  classification: 'good' | 'question' | 'spam' | 'abusive' | 'needs_no_action'
  confidence: 'low' | 'medium' | 'high'
  moderation_action: 'none' | 'public_reply' | 'private_reply' | 'hide' | 'delete'
  graph_status: 'pending' | 'sent' | 'hidden' | 'deleted' | 'failed' | 'skipped'
  created_at: string
}

export interface ConversationStageEvent {
  id: string
  from_stage_name: string | null
  to_stage_name: string | null
  source: 'ai' | 'user'
  reason: string | null
  confidence: 'low' | 'medium' | 'high' | null
  created_at: string
  can_undo: boolean
}

export interface ConversationData {
  thread: {
    id: string
    psid: string
    full_name: string | null
    picture_url: string | null
    auto_reply_enabled: boolean
    last_message_at: string | null
    page_name: string | null
  }
  messages: ConversationMessage[]
  stageEvents: ConversationStageEvent[]
  comments: ConversationComment[]
}

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

/**
 * Load the (single) messenger thread linked to this lead, plus the most
 * recent messages. Returns null when the lead has no Messenger thread yet.
 */
export async function loadConversation(
  leadId: string,
): Promise<ConversationData | null> {
  const { supabase } = await requireUser()

  const { data: thread } = await supabase
    .from('messenger_threads')
    .select(
      'id, psid, full_name, picture_url, auto_reply_enabled, last_message_at, page_id, facebook_pages(name)',
    )
    .eq('lead_id', leadId)
    .maybeSingle()
  if (!thread) return null

  const { data: messages, error: msgErr } = await supabase
    .from('messenger_messages')
    .select('id, direction, sender, body, created_at, error')
    .eq('thread_id', thread.id)
    .order('created_at', { ascending: true })
    .limit(200)
  if (msgErr) throw new Error(`loadConversation: ${msgErr.message}`)

  const pageName =
    (Array.isArray(thread.facebook_pages)
      ? thread.facebook_pages[0]?.name
      : (thread.facebook_pages as { name?: string } | null)?.name) ?? null

  const [{ data: events }, { data: stages }, { data: comments, error: commentErr }] =
    await Promise.all([
      supabase
        .from('lead_stage_events')
        .select('id, from_stage_id, to_stage_id, source, reason, confidence, created_at')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: true })
        .limit(200),
      supabase.from('pipeline_stages').select('id, name'),
      supabase
        .from('facebook_lead_comments')
        .select(
          'id, fb_comment_id, message, commenter_name, classification, confidence, moderation_action, graph_status, created_at',
        )
        .eq('lead_id', leadId)
        .order('created_at', { ascending: true })
        .limit(200),
    ])
  if (commentErr) throw new Error(`loadConversation comments: ${commentErr.message}`)
  const stageName = new Map((stages ?? []).map((s) => [s.id as string, s.name as string]))
  // Only the most recent AI event is undoable (avoids tangled chains).
  let lastAiId: string | null = null
  for (const e of events ?? []) {
    if (e.source === 'ai') lastAiId = e.id as string
  }
  const stageEvents: ConversationStageEvent[] = (events ?? []).map((e) => ({
    id: e.id as string,
    from_stage_name: e.from_stage_id ? (stageName.get(e.from_stage_id as string) ?? null) : null,
    to_stage_name: e.to_stage_id ? (stageName.get(e.to_stage_id as string) ?? null) : null,
    source: e.source as 'ai' | 'user',
    reason: (e.reason as string | null) ?? null,
    confidence: (e.confidence as ConversationStageEvent['confidence']) ?? null,
    created_at: e.created_at as string,
    can_undo: e.source === 'ai' && e.id === lastAiId,
  }))

  return {
    thread: {
      id: thread.id,
      psid: thread.psid,
      full_name: thread.full_name,
      picture_url: thread.picture_url,
      auto_reply_enabled: thread.auto_reply_enabled,
      last_message_at: thread.last_message_at,
      page_name: pageName,
    },
    messages: (messages ?? []) as ConversationMessage[],
    stageEvents,
    comments: (comments ?? []) as ConversationComment[],
  }
}

export interface LatestStageRationale {
  stage_name: string | null
  source: 'ai' | 'user'
  reason: string | null
  confidence: 'low' | 'medium' | 'high' | null
  created_at: string
}

/**
 * Most recent stage transition for a lead — surfaces "why is this lead in
 * this stage" in the drawer. Returns null when the lead has never been moved
 * (no events) or when the latest event has no destination stage.
 */
export async function loadLeadComments(leadId: string): Promise<ConversationComment[]> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase
    .from('facebook_lead_comments')
    .select(
      'id, fb_comment_id, message, commenter_name, classification, confidence, moderation_action, graph_status, created_at',
    )
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`loadLeadComments: ${error.message}`)
  return (data ?? []) as ConversationComment[]
}

export async function loadLatestStageRationale(
  leadId: string,
): Promise<LatestStageRationale | null> {
  const { supabase } = await requireUser()

  const { data: event } = await supabase
    .from('lead_stage_events')
    .select('to_stage_id, source, reason, confidence, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{
      to_stage_id: string | null
      source: 'ai' | 'user'
      reason: string | null
      confidence: 'low' | 'medium' | 'high' | null
      created_at: string
    }>()
  if (!event || !event.to_stage_id) return null

  const { data: stage } = await supabase
    .from('pipeline_stages')
    .select('name')
    .eq('id', event.to_stage_id)
    .maybeSingle<{ name: string }>()

  return {
    stage_name: stage?.name ?? null,
    source: event.source,
    reason: event.reason,
    confidence: event.confidence,
    created_at: event.created_at,
  }
}

export async function undoStageEvent(eventId: string): Promise<void> {
  const { supabase, userId } = await requireUser()

  const { data: event, error: evErr } = await supabase
    .from('lead_stage_events')
    .select('id, lead_id, from_stage_id, to_stage_id, thread_id')
    .eq('id', eventId)
    .maybeSingle<{
      id: string
      lead_id: string
      from_stage_id: string | null
      to_stage_id: string | null
      thread_id: string | null
    }>()
  if (evErr) throw new Error(`undoStageEvent: ${evErr.message}`)
  if (!event || !event.from_stage_id) throw new Error('undoStageEvent: nothing to undo')

  // Recompute position at the bottom of the destination (from) stage.
  const { data: maxRow } = await supabase
    .from('leads')
    .select('position')
    .eq('user_id', userId)
    .eq('stage_id', event.from_stage_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle<{ position: number }>()
  const nextPosition = (maxRow?.position ?? -1) + 1

  const { error: updErr } = await supabase
    .from('leads')
    .update({ stage_id: event.from_stage_id, position: nextPosition })
    .eq('id', event.lead_id)
  if (updErr) throw new Error(`undoStageEvent: ${updErr.message}`)

  await supabase.from('lead_stage_events').insert({
    lead_id: event.lead_id,
    user_id: userId,
    from_stage_id: event.to_stage_id,
    to_stage_id: event.from_stage_id,
    source: 'user',
    reason: 'Undid AI stage change',
    thread_id: event.thread_id,
  })

  revalidatePath('/dashboard/leads', 'layout')
}

export async function setAutoReply(leadId: string, enabled: boolean): Promise<void> {
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from('messenger_threads')
    .update({ auto_reply_enabled: enabled })
    .eq('lead_id', leadId)
  if (error) throw new Error(`setAutoReply: ${error.message}`)
  revalidatePath('/dashboard/leads', 'layout')
}

export async function replyAsOperator(leadId: string, text: string): Promise<void> {
  const body = text.trim()
  if (!body) return
  const { supabase, userId } = await requireUser()

  const { data: thread, error: threadErr } = await supabase
    .from('messenger_threads')
    .select('id, psid, page_id, facebook_pages(page_access_token)')
    .eq('lead_id', leadId)
    .maybeSingle()
  if (threadErr) throw new Error(`replyAsOperator: ${threadErr.message}`)
  if (!thread) throw new Error('replyAsOperator: no Messenger thread for lead')

  const pageRow = Array.isArray(thread.facebook_pages)
    ? thread.facebook_pages[0]
    : (thread.facebook_pages as { page_access_token?: string } | null)
  if (!pageRow?.page_access_token) {
    throw new Error('replyAsOperator: missing page access token')
  }
  const pageToken = decryptToken(pageRow.page_access_token)

  let sentId: string | null = null
  let sendError: string | null = null
  try {
    const sent = await sendMessengerText({
      pageAccessToken: pageToken,
      recipientPsid: thread.psid,
      text: body,
    })
    sentId = sent.message_id
  } catch (e) {
    sendError = e instanceof Error ? e.message : String(e)
  }

  await supabase.from('messenger_messages').insert({
    thread_id: thread.id,
    user_id: userId,
    direction: 'outbound',
    sender: 'operator',
    fb_message_id: sentId,
    body,
    error: sendError,
  })

  if (!sendError) {
    await supabase
      .from('messenger_threads')
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: body.slice(0, 200),
      })
      .eq('id', thread.id)
  }

  if (sendError) throw new Error(`replyAsOperator: ${sendError}`)
  revalidatePath('/dashboard/leads', 'layout')
}
