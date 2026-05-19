// src/lib/followups/generateMessage.ts
//
// One LLM call per follow-up. Hard rules baked into the system prompt:
//   one line, ≤200 chars, no dashes, no markdown, match personality.
// Offset 0 is always a light check-in (per spec) — short-circuit to the
// fallback line so we don't pay for a model call on a fixed message.
// Generic-kind messages don't include the message history. Real-kind
// messages pass the last 20 turns so the LLM can reference what was said.
// 8s LLM timeout; on failure or empty response, fall back to a curated
// per-offset pool so the user never sees a dropped touchpoint.

import { HfRouterLlm } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'
import { manilaNowBlock } from '@/lib/time/manilaNow'
import { sanitizeFollowup } from './sanitize'
import { OFFSETS_MS, type ConversationKind } from './config'

const LLM_TIMEOUT_MS = 8_000

export interface GenerateArgs {
  kind: ConversationKind
  slot: number
  leadName: string | null
  personalityBlock: string
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
}

// Per-offset fallback pool. Indices 0..6 line up with OFFSETS_MS. Each pool
// has at least one Taglish line that uses the lead's first name. Strings here
// are pre-sanitized: no dashes, one line.
const FALLBACK_POOL: Record<ConversationKind, string[]> = {
  generic: [
    'Hi {name}, interested pa po kayo?',
    'Hi {name}, may follow up lang po, anything I can help with?',
    'Hi {name}, balik lang po ako, anong sa tingin niyo?',
    'Hi {name}, gusto niyo pa po ba ituloy?',
    'Hi {name}, available pa po kayo to chat?',
    'Hi {name}, last check po, may itatanong pa po ba kayo?',
    'Hi {name}, balik na lang po kayo anytime kung interested.',
  ],
  real: [
    'Hi {name}, interested pa po kayo?',
    'Hi {name}, anything pa po na gusto niyong i clarify?',
    'Hi {name}, balikan lang po, ano sa tingin niyo so far?',
    'Hi {name}, naisip niyo na po ba ituloy?',
    'Hi {name}, sabihan niyo lang po kung kailangan pa ng info.',
    'Hi {name}, follow up po, gusto niyo pa po ba i pursue?',
    'Hi {name}, kahit anong oras po pwede tayo ulit mag usap.',
  ],
}

function firstName(name: string | null): string {
  if (!name) return ''
  return name.trim().split(/\s+/)[0]
}

function fallback(kind: ConversationKind, slot: number, leadName: string | null): string {
  const safeSlot = Math.max(0, Math.min(OFFSETS_MS.length - 1, slot))
  const line = FALLBACK_POOL[kind][safeSlot]
  const fn = firstName(leadName)
  return sanitizeFollowup(line.replace('{name}', fn || 'there'))
}

function buildSystemPrompt(args: GenerateArgs): string {
  const rules =
    'Hard rules: one line only, max 200 characters, no dashes ("-", "—", "–"), no markdown, no emojis ' +
    'unless the personality calls for them. Match the personality language (Tagalog, Taglish, or English). ' +
    'Sound human, never robotic. Never start with "Hello! I am..." or generic AI phrasing.'
  const personality = args.personalityBlock?.trim()
    ? `Personality / tone:\n${args.personalityBlock.trim()}\n\n`
    : ''
  const fnHint = firstName(args.leadName) ? `Use the customer's first name once: ${firstName(args.leadName)}.\n` : ''
  const prefix = `${manilaNowBlock()}\n\n`

  if (args.kind === 'generic') {
    return (
      prefix +
      `${personality}` +
      `You are writing follow-up message #${args.slot + 1} of 7 to a Messenger lead who replied earlier ` +
      `but has gone quiet. The previous exchange had less than 4 messages from the lead, so DO NOT pretend ` +
      `to remember specifics. Write a warm, light check-in that nudges them to reply. ` +
      `${fnHint}${rules}`
    )
  }
  return (
    prefix +
    `${personality}` +
    `You are writing follow-up message #${args.slot + 1} of 7 to a Messenger lead who has gone quiet ` +
    `after a real back-and-forth. Reference what was already discussed naturally and propose a concrete ` +
    `next step or ask one focused question. ${fnHint}${rules}`
  )
}

function buildUserPrompt(args: GenerateArgs): string {
  if (args.kind === 'generic' || args.recentMessages.length === 0) {
    return `Write follow-up #${args.slot + 1} now. Do not repeat earlier phrasings.`
  }
  const transcript = args.recentMessages
    .slice(-20)
    .map((m) => (m.role === 'user' ? `Customer: ${m.content}` : `You earlier: ${m.content}`))
    .join('\n')
  return `Last messages in the conversation:\n${transcript}\n\nWrite follow-up #${args.slot + 1} now.`
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('llm_timeout')), ms)),
  ])
}

export async function generateFollowupMessage(args: GenerateArgs): Promise<string> {
  if (args.slot === 0) {
    return fallback(args.kind, 0, args.leadName)
  }
  try {
    const llm = new HfRouterLlm({ model: ragConfig.classifierModel })
    const raw = await withTimeout(
      llm.complete(
        [
          { role: 'system', content: buildSystemPrompt(args) },
          { role: 'user', content: buildUserPrompt(args) },
        ],
        { temperature: 0.6, maxTokens: 160 },
      ),
      LLM_TIMEOUT_MS,
    )
    const cleaned = sanitizeFollowup(raw)
    if (!cleaned) throw new Error('empty')
    return cleaned
  } catch {
    return fallback(args.kind, args.slot, args.leadName)
  }
}
