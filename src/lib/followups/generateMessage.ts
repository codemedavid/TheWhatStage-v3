// src/lib/followups/generateMessage.ts
//
// One LLM call per follow-up. Hard rules baked into the system prompt:
//   one line, ≤200 chars, no dashes, no markdown, match personality.
// Slot 0 short-circuits to the fallback pool ONLY when no per-touchpoint
// instruction is set — when the user provides a guide for slot 0 we honor
// it and pay for the LLM call. Generic-kind messages don't include the
// message history. Real-kind messages pass the last 20 turns so the LLM
// can reference what was said. 8s LLM timeout; on failure or empty response,
// fall back to a curated per-offset pool so the user never sees a dropped
// touchpoint.

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
  instruction: string
  attachmentHint?: string
}

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

// Manual mode (default): send the user-authored message verbatim after
// interpolating `{name}` and running the same sanitize as AI output (strip
// dashes, flatten to one line, cap length). No LLM call, so zero AI cost.
// A blank message — or one that sanitizes to empty — falls back to the curated
// per-offset pool so a touchpoint is never dropped.
export function resolveManualMessage(
  message: string,
  kind: ConversationKind,
  slot: number,
  leadName: string | null,
): string {
  const trimmed = (message ?? '').trim()
  if (!trimmed) return fallback(kind, slot, leadName)
  const fn = firstName(leadName)
  const interpolated = trimmed.replace(/\{name\}/g, fn || 'there')
  const cleaned = sanitizeFollowup(interpolated)
  return cleaned || fallback(kind, slot, leadName)
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

  // JSON.stringify escapes embedded quotes/newlines so user text can't break prompt structure.
  const trimmedInstr = (args.instruction ?? '').trim()
  const guide = trimmedInstr
    ? `Touchpoint guide for THIS message (#${args.slot + 1} of 7):\n` +
      `${JSON.stringify(trimmedInstr)}\n` +
      `Follow this guide. Keep the personality and language rules.\n\n`
    : ''

  const trimmedHint = (args.attachmentHint ?? '').trim()
  const attachmentBlock = trimmedHint
    ? `This message will be followed by: ${trimmedHint}.\n` +
      `Reference it naturally if it fits; do not paste a URL.\n\n`
    : ''

  if (args.kind === 'generic') {
    return (
      prefix +
      `${personality}` +
      `${guide}` +
      `${attachmentBlock}` +
      `You are writing follow-up message #${args.slot + 1} of 7 to a Messenger lead who replied earlier ` +
      `but has gone quiet. The previous exchange had less than 4 messages from the lead, so DO NOT pretend ` +
      `to remember specifics. Write a warm, light check-in that nudges them to reply. ` +
      `${fnHint}${rules}`
    )
  }
  return (
    prefix +
    `${personality}` +
    `${guide}` +
    `${attachmentBlock}` +
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

export { buildSystemPrompt as buildSystemPromptForTest }

export async function generateFollowupMessage(args: GenerateArgs): Promise<string> {
  const hasInstruction = (args.instruction ?? '').trim().length > 0
  if (!hasInstruction && args.slot === 0) {
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
