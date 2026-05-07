import { HfRouterLlm } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'
import type { AudienceLead, BulkContext, ParsedIntent } from './types'

const DRAFT_TIMEOUT_MS = 8_000
const FALLBACK_TEMPLATE = (name: string | null) =>
  `Hi ${name ?? 'there'}, just checking in on you! 👋`

function buildDraftPrompt(
  lead: AudienceLead,
  intent: ParsedIntent,
  lastInbound: string | null,
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

  const system = `You are a sales assistant writing a short Messenger follow-up for ${lead.name ?? 'a lead'}.
Tone: ${toneDesc}.
Keep it under 3 sentences. Do NOT use emojis excessively. Sound human, not robotic.
Output ONLY the message text — no quotes, no preamble, no explanation.`

  const user = `Instruction: ${intent.instruction}

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
  const { system, user } = buildDraftPrompt(lead, intent, lastInbound)

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
    return draft.trim() || FALLBACK_TEMPLATE(lead.name)
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
