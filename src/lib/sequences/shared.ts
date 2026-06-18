// Source-agnostic core shared by the project-sequence worker
// (src/lib/projects/sequences/fire.ts) and the lead-sequence worker
// (src/lib/leads/sequences/fire.ts). Each worker owns its own run-state table;
// the genuinely identical parts — drafting a step via the follow-up agent,
// loading the thread/page/persona/history needed to send, sending through the
// shared Messenger outbound + policy path, and computing the next run — live
// here so the two workers never drift.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptToken } from '@/lib/facebook/crypto'
import { sendOutbound } from '@/lib/messenger/outbound'
import { isInsideWindow } from '@/lib/agent/classifyPolicy'
import { HfRouterLlm } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'
import { manilaNowBlock } from '@/lib/time/manilaNow'

// Re-exported so workers can import the whole sequence core from one module.
// Defined in advance.ts (no side-effectful imports) so it stays unit-testable.
export { nextSequenceState } from './advance'

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export interface SequenceThread {
  id: string
  psid: string
  last_inbound_at: string | null
  full_name: string | null
  page_id: string
}

export interface SequenceSendContext {
  thread: SequenceThread
  pageToken: string
  persona: string | null
  leadName: string | null
  recentMessages: ChatMessage[]
}

// Draft one follow-up step. Combines the chatbot persona, the customer/project
// AI instructions (when present), the step instruction, and recent history.
// `contextTitle` is the project title the message relates to (may be null for a
// lead with no active project).
export async function draftSequenceStep(args: {
  leadName: string | null
  persona: string | null
  contextTitle: string | null
  aiInstructions: string | null
  stepInstruction: string
  recentMessages: ChatMessage[]
}): Promise<string> {
  const { leadName, persona, contextTitle, aiInstructions, stepInstruction, recentMessages } = args
  const llm = new HfRouterLlm({ model: process.env.AGENT_DRAFT_MODEL ?? ragConfig.classifierModel })

  const personaBlock = persona?.trim() ? `${persona.trim()}\n\n` : ''
  const projectBlock = aiInstructions?.trim()
    ? `What you know about this customer${contextTitle ? ` / project "${contextTitle}"` : ''} (follow strictly):\n${aiInstructions.trim()}\n\n`
    : contextTitle
      ? `This message relates to the project "${contextTitle}".\n\n`
      : ''

  const system = `${manilaNowBlock()}

${personaBlock}${projectBlock}You are a sales assistant writing a short, proactive Messenger follow-up for ${leadName ?? 'a customer'}.
Keep it under 3 sentences. Sound human, not robotic. Do NOT use emojis excessively.
Output ONLY the message text — no quotes, no preamble, no explanation.`

  const convo = recentMessages.length > 0
    ? `Recent conversation:\n${recentMessages.map((m) => `${m.role === 'assistant' ? 'You' : 'Them'}: ${m.content}`).join('\n')}\n\n`
    : ''
  const user = `${convo}Follow up about: ${stepInstruction}`

  const draft = await llm.complete(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { temperature: 0.6, maxTokens: 200 },
  )
  return draft.trim()
}

// Load everything needed to send a sequence step on a thread: the thread, the
// decrypted page token, the chatbot persona, the lead name, and recent history.
// Returns a failure reason instead of throwing for the "expected" missing-row
// cases so the caller can mark the run failed with a useful message.
export async function loadSequenceSendContext(
  admin: SupabaseClient,
  args: { threadId: string; userId: string; leadId: string },
): Promise<{ ok: true; ctx: SequenceSendContext } | { ok: false; reason: string }> {
  const { data: thread } = await admin
    .from('messenger_threads')
    .select('id, psid, last_inbound_at, full_name, page_id')
    .eq('id', args.threadId)
    .maybeSingle<SequenceThread>()
  if (!thread) return { ok: false, reason: 'thread missing' }

  const { data: page } = await admin
    .from('facebook_pages')
    .select('id, page_access_token')
    .eq('id', thread.page_id)
    .maybeSingle<{ id: string; page_access_token: string }>()
  if (!page) return { ok: false, reason: 'page missing' }

  const [{ data: chatbot }, { data: leadRow }, { data: msgs }] = await Promise.all([
    admin.from('chatbot_configs').select('persona').eq('user_id', args.userId).maybeSingle<{ persona: string | null }>(),
    admin.from('leads').select('name').eq('id', args.leadId).maybeSingle<{ name: string | null }>(),
    admin.from('messenger_messages').select('direction, body, created_at')
      .eq('thread_id', thread.id).order('created_at', { ascending: false }).limit(12),
  ])

  const recentMessages: ChatMessage[] = ((msgs ?? []) as Array<{ direction: string; body: string }>)
    .reverse()
    .filter((m) => m.body?.trim())
    .map((m) => ({ role: m.direction === 'outbound' ? 'assistant' : 'user', content: m.body }))

  return {
    ok: true,
    ctx: {
      thread,
      pageToken: decryptToken(page.page_access_token),
      persona: chatbot?.persona ?? null,
      leadName: leadRow?.name ?? thread.full_name ?? null,
      recentMessages,
    },
  }
}

// Send a drafted step through the shared outbound + policy path (24h window,
// opt-out, OTN), then record it on the thread. Returns a failure reason when the
// policy blocks the send so the caller can mark the run failed.
export async function sendAndRecordStep(
  admin: SupabaseClient,
  args: { thread: SequenceThread; pageToken: string; text: string; userId: string },
): Promise<{ sent: true; messageId: string } | { sent: false; reason: string }> {
  const { thread, pageToken, text, userId } = args
  const sendKind = isInsideWindow(thread.last_inbound_at) ? 'bot' : 'workflow_human_agent'

  const result = await sendOutbound({
    admin,
    thread: { id: thread.id, psid: thread.psid, last_inbound_at: thread.last_inbound_at },
    pageToken,
    payload: { kind: 'text', text },
    kind: sendKind,
  })

  if (!result.sent) {
    return { sent: false, reason: (result as { sent: false; reason: string }).reason }
  }

  await admin.from('messenger_messages').insert({
    thread_id: thread.id,
    user_id: userId,
    direction: 'outbound',
    sender: 'bot',
    fb_message_id: result.messageId,
    body: text,
  }).then(({ error }) => {
    if (error && (error as { code?: string }).code !== '23505') {
      console.warn('[sequence] message insert failed', error.message)
    }
  })

  return { sent: true, messageId: result.messageId }
}
