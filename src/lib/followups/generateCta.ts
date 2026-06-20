// src/lib/followups/generateCta.ts
//
// One LLM call that writes the call-to-action for an action-page button sent
// during a scheduled follow-up: a strong caption (shown above the button) and
// a punchy 2-3 word label (shown ON the button) tuned for click-through.
//
// Mirrors generateMessage.ts: HfRouterLlm with the classifier model, an 8s
// timeout, and a graceful fallback. On any failure (timeout, throw, non-JSON,
// empty fields) it falls back to a neutral caption and the page's configured
// cta_label so the follow-up button is never dropped.
//
// Unlike generateMessage, the caption is NOT run through sanitizeFollowup:
// Tagalog CTAs legitimately use hyphens ("I-claim", "mag-book") and emoji
// (👇), both of which sanitizeFollowup would strip.

import { HfRouterLlm } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'
import { manilaNowBlock } from '@/lib/time/manilaNow'

const LLM_TIMEOUT_MS = 8_000
const CAPTION_MAX = 200
// Messenger hard-caps button titles at 20 characters (see sendMessengerButton).
const LABEL_MAX = 20
const DEFAULT_CAPTION = 'Tap below to continue 👇'

export interface GenerateCtaArgs {
  /** Action page title — context only; never used verbatim as the label. */
  pageTitle: string
  /** The page's configured cta_label — used as the fallback button label. */
  ctaLabel: string
  /** The page's bot_send_instructions — context on why it's being sent. */
  instructions: string
  personalityBlock: string
  leadName: string | null
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Override the LLM timeout (tests). Defaults to 8s. */
  timeoutMs?: number
}

export interface ActionPageCta {
  /** Caption shown above the button (the card text). */
  caption: string
  /** 2-3 word label shown on the button itself. */
  label: string
}

function firstName(name: string | null): string {
  if (!name) return ''
  return name.trim().split(/\s+/)[0]
}

// Light clean for the caption: flatten to one line, strip surrounding quotes,
// cap length. Keeps hyphens and emoji (Tagalog CTAs need both).
function cleanCaption(input: unknown): string {
  if (typeof input !== 'string') return ''
  const oneLine = input.replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, '').trim()
  return oneLine.length > CAPTION_MAX ? oneLine.slice(0, CAPTION_MAX) : oneLine
}

function cleanLabel(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input.trim().replace(/^["']|["']$/g, '').trim().slice(0, LABEL_MAX)
}

// Tolerant JSON parse: handles a bare object or one wrapped in prose / code
// fences by extracting the first {...} span.
function parseCta(raw: string): { caption?: unknown; label?: unknown } | null {
  const tryParse = (s: string): { caption?: unknown; label?: unknown } | null => {
    try {
      const v = JSON.parse(s)
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  const direct = tryParse(raw.trim())
  if (direct) return direct
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) return tryParse(raw.slice(start, end + 1))
  return null
}

function buildSystemPrompt(args: GenerateCtaArgs): string {
  const personality = args.personalityBlock?.trim()
    ? `Personality / tone:\n${args.personalityBlock.trim()}\n\n`
    : ''
  const fnHint = firstName(args.leadName)
    ? `The customer's first name is ${firstName(args.leadName)}.\n`
    : ''
  const instr = args.instructions?.trim()
    ? `Why this is being sent: ${JSON.stringify(args.instructions.trim())}\n`
    : ''
  return (
    `${manilaNowBlock()}\n\n` +
    `${personality}` +
    `You are writing the call-to-action for a button that links a Messenger lead to "${args.pageTitle}".\n` +
    `${instr}${fnHint}\n` +
    'Return ONLY a JSON object: {"caption": string, "label": string}. No prose, no code fences.\n' +
    'caption rules: a strong, benefit-led one-line CTA in the SAME language as the customer ' +
    '(Tagalog/Taglish if they wrote Tagalog). Lead with the value, then nudge the tap. ' +
    'Max ~80 chars. Include a downward emoji like 👇. No page title, no URL.\n' +
    'label rules: a punchy 2-3 words (HARD max) in the SAME language, high-intent and first-person ' +
    'where natural ("Claim my slot", "Book na", "Get my quote"). At most one emoji. ' +
    'NEVER use the page title or a generic word like "Open", "Open form", or "View" as the label.'
  )
}

function buildUserPrompt(args: GenerateCtaArgs): string {
  if (args.recentMessages.length === 0) {
    return 'Write the caption and label now.'
  }
  const transcript = args.recentMessages
    .slice(-20)
    .map((m) => (m.role === 'user' ? `Customer: ${m.content}` : `You earlier: ${m.content}`))
    .join('\n')
  return `Last messages in the conversation:\n${transcript}\n\nWrite the caption and label now.`
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('llm_timeout')), ms)),
  ])
}

export { buildSystemPrompt as buildCtaSystemPromptForTest }

export async function generateActionPageCta(args: GenerateCtaArgs): Promise<ActionPageCta> {
  const fallbackLabel = args.ctaLabel?.trim() || 'View'
  const fallback: ActionPageCta = { caption: DEFAULT_CAPTION, label: fallbackLabel }
  try {
    const llm = new HfRouterLlm({ model: ragConfig.classifierModel })
    const raw = await withTimeout(
      llm.complete(
        [
          { role: 'system', content: buildSystemPrompt(args) },
          { role: 'user', content: buildUserPrompt(args) },
        ],
        { temperature: 0.6, maxTokens: 120 },
      ),
      args.timeoutMs ?? LLM_TIMEOUT_MS,
    )
    const parsed = parseCta(raw)
    if (!parsed) return fallback
    const caption = cleanCaption(parsed.caption) || DEFAULT_CAPTION
    const label = cleanLabel(parsed.label) || fallbackLabel
    return { caption, label }
  } catch {
    return fallback
  }
}
