import { HfRouterLlm } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'
import { sanitizeFollowup } from '@/lib/followups/sanitize'
import { manilaNowBlock, manilaNow, MANILA_TZ } from '@/lib/time/manilaNow'
import { roleForPosition, scheduledAtForPosition, SEQUENCE_LENGTH } from './sequence'

const LLM_TIMEOUT_MS = 8_000

export interface SequencePromptArgs {
  now: Date
  anchor: Date
  position: number // 0..6
  topic: string
  leadName: string | null
  personalityBlock: string
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
}

function manilaLong(d: Date): string {
  const n = manilaNow(d)
  const time = n.iso.slice(11)
  return `${n.dateLong}, ${time}`
}

function firstName(name: string | null): string {
  if (!name) return ''
  return name.trim().split(/\s+/)[0] ?? ''
}

export function buildSequencePrompt(args: SequencePromptArgs): { system: string; user: string } {
  if (!Number.isInteger(args.position) || args.position < 0 || args.position >= SEQUENCE_LENGTH) {
    throw new RangeError(`position must be 0..${SEQUENCE_LENGTH - 1}, got ${args.position}`)
  }
  const scheduledAt = scheduledAtForPosition(args.anchor, args.position)
  const personality = args.personalityBlock?.trim()
    ? `Personality / tone:\n${args.personalityBlock.trim()}\n\n`
    : ''
  const fn = firstName(args.leadName)
  const fnHint = fn ? `Use the customer's first name once: ${fn}.\n` : ''
  const role = roleForPosition(args.position)
  const rules =
    'Hard rules: one line only, max 200 characters, no dashes ("-", "—", "–"), no markdown, no emojis ' +
    'unless personality calls for them. Match the personality language (Tagalog, Taglish, or English). ' +
    'Sound human, never robotic. Reference the topic naturally. Never start with "Hello! I am..." or generic AI phrasing.'

  const system =
    `${manilaNowBlock(args.now)}\n\n` +
    `${personality}` +
    `The customer asked to be followed up at ${manilaLong(args.anchor)} (${MANILA_TZ}) about: "${args.topic}".\n` +
    `You are writing message #${args.position + 1} of ${SEQUENCE_LENGTH} in that scheduled follow-up sequence.\n` +
    `This message will be sent at ${manilaLong(scheduledAt)} (${MANILA_TZ}).\n\n` +
    `Position role: ${role}\n\n` +
    `${fnHint}${rules}`

  const transcript = args.recentMessages.length
    ? `Last messages in the conversation:\n` +
      args.recentMessages
        .slice(-20)
        .map((m) => (m.role === 'user' ? `Customer: ${m.content}` : `You earlier: ${m.content}`))
        .join('\n') +
      '\n\n'
    : ''
  const user = `${transcript}Write message #${args.position + 1} now. Do not repeat earlier phrasings.`

  return { system, user }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('llm_timeout')), ms)),
  ])
}

export async function generateSequenceMessage(args: SequencePromptArgs): Promise<string | null> {
  try {
    const llm = new HfRouterLlm({ model: ragConfig.classifierModel })
    const { system, user } = buildSequencePrompt(args)
    const raw = await withTimeout(
      llm.complete(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        { temperature: 0.6, maxTokens: 160 },
      ),
      LLM_TIMEOUT_MS,
    )
    const cleaned = sanitizeFollowup(raw)
    if (!cleaned) return null
    return cleaned
  } catch {
    return null
  }
}
