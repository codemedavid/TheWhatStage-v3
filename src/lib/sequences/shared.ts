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
import { getChatbotConfig } from '@/lib/chatbot/config'
import { createEmbedder } from '@/lib/rag/factory'
import { retrieve } from '@/lib/rag/retriever'

// Re-exported so workers can import the whole sequence core from one module.
// Defined in advance.ts (no side-effectful imports) so it stays unit-testable.
export { nextSequenceState } from './advance'
// LLM draft wrappers live in ./draft (no Supabase/crypto/RAG imports) so they
// stay unit-testable; re-exported here so workers keep one import surface.
export { draftSequenceStep, draftSequenceBatch, type BatchDraft } from './draft'

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
  // Full chatbot brain so a follow-up obeys the same voice + policy as the live
  // reply (previously only `persona` was loaded — rules and instructions were
  // silently dropped from every touch).
  persona: string | null
  instructions: string | null
  doRules: string[]
  dontRules: string[]
  leadName: string | null
  recentMessages: ChatMessage[]
}

// Best-effort knowledge-base retrieval for a follow-up touch, mirroring what the
// live chatbot pulls in. Runs with the service-role admin client (no auth
// context) so it uses the `_service` hybrid-search RPC. Returns a rendered
// context block, or '' on no results / any error — knowledge must never block or
// fail a touch.
export async function retrieveKnowledge(
  admin: SupabaseClient,
  userId: string,
  query: string,
): Promise<string> {
  const q = query.trim()
  if (!q) return ''
  try {
    const embedder = createEmbedder()
    const ctx = await retrieve(
      { client: admin, embedder, rpcName: 'match_knowledge_hybrid_service' },
      { userId, query: q },
    )
    const chunks = [...ctx.buckets.useful, ...ctx.buckets.ambiguous]
    if (chunks.length === 0) return ''
    return chunks.map((c, i) => `[${i + 1}] ${c.content.trim()}`).join('\n\n')
  } catch (e) {
    console.warn('[sequence] knowledge retrieval failed', e instanceof Error ? e.message : String(e))
    return ''
  }
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

  const [config, { data: leadRow }, { data: msgs }] = await Promise.all([
    // Full chatbot config — so the touch honours the operator's instructions and
    // Do/Don't rules, not just the persona.
    getChatbotConfig(admin, args.userId),
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
      persona: config.persona ?? null,
      instructions: config.instructions ?? null,
      doRules: config.doRules ?? [],
      dontRules: config.dontRules ?? [],
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
