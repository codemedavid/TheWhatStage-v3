import { HfRouterLlm } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'
import { manilaNowBlock } from '@/lib/time/manilaNow'
import { personalize } from './personalize'
import type { AudienceLead, BulkContext, ParsedIntent } from './types'

const DRAFT_TIMEOUT_MS = 8_000
const FALLBACK_TEMPLATE = (name: string | null) =>
  `Hi ${name ?? 'there'}, just checking in on you! 👋`

function buildDraftPrompt(
  lead: AudienceLead,
  intent: ParsedIntent,
  lastInbound: string | null,
  projectInstructions?: string | null,
): { system: string; user: string } {
  const toneMap: Record<string, string> = {
    friendly: 'warm and friendly',
    casual: 'casual and conversational',
    professional: 'professional and courteous',
  }
  const toneDesc = toneMap[intent.tone] ?? 'friendly'

  const contextBlock = lastInbound
    ? `Their last message to you: "${lastInbound.slice(0, 300)}"`
    : 'No previous conversation.'

  const projectBlock = projectInstructions?.trim()
    ? `Project context for this customer (follow strictly):\n${projectInstructions.trim()}\n\n`
    : ''

  const system = `${manilaNowBlock()}

${projectBlock}You are a sales assistant writing a short Messenger follow-up for ${lead.name ?? 'a lead'}.
Tone: ${toneDesc}.
Keep it under 3 sentences. Do NOT use emojis excessively. Sound human, not robotic.
Output ONLY the message text — no quotes, no preamble, no explanation.`

  // Merge tags are resolved BEFORE the model reads the instruction, so it
  // works from the real name instead of copying "[first_name]" into the draft.
  const user = `Instruction: ${personalize(intent.instruction, lead)}

Lead name: ${lead.name ?? 'unknown'}
Context: ${contextBlock}`

  return { system, user }
}

export async function generateDraft(
  lead: AudienceLead,
  intent: ParsedIntent,
  ctx: BulkContext,
  llm?: HfRouterLlm,
): Promise<string> {
  const client =
    llm ??
    new HfRouterLlm({
      model: process.env.AGENT_DRAFT_MODEL ?? ragConfig.classifierModel,
    })

  const lastInbound = ctx.lastInboundByThread.get(lead.thread_id) ?? null
  const projectInstructions = ctx.projectInstructionsByLead.get(lead.id) ?? null
  const { system, user } = buildDraftPrompt(lead, intent, lastInbound, projectInstructions)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS)

  try {
    const draft = await client.complete(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.6, maxTokens: 200 },
    )
    clearTimeout(timeout)
    // Backstop: a model that echoed a tag anyway must not leak it to a
    // customer. personalize() is idempotent, so this is a no-op otherwise.
    return personalize(draft.trim(), lead) || FALLBACK_TEMPLATE(lead.name)
  } catch (err) {
    clearTimeout(timeout)
    // On timeout or provider error, return a safe fallback so one failure
    // doesn't abort the entire fan-out.
    console.warn('[agent.draft] LLM call failed, using fallback', {
      leadId: lead.id,
      err: err instanceof Error ? err.message : String(err),
    })
    return FALLBACK_TEMPLATE(lead.name)
  }
}
