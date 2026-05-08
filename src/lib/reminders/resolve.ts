import { HfRouterLlm } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'
import { z } from 'zod'

export interface PendingReminder {
  id: string
  topic: string
}

const Schema = z.object({
  resolved_ids: z.array(z.string()),
})

function buildSystem(reminders: PendingReminder[]): string {
  const list = reminders
    .map((r, i) => `${i + 1}. id=${r.id} topic="${r.topic.replace(/"/g, "'")}"`)
    .join('\n')

  return `You decide whether a customer's new message resolves any pending follow-up topics.

A topic is RESOLVED when the new message indicates the customer no longer needs the follow-up because:
- They are now actively engaging on the same topic ("ok send the pricing now", "I'm here, what about that 3BR?", asking for what they originally wanted to be reminded about),
- They explicitly cancel ("nevermind", "no need to follow up", "I'm not interested anymore"),
- They confirm they got what they needed ("got it thanks", "all good now").

A topic is NOT resolved on small talk, vague greetings, or messages on an unrelated topic.

Pending follow-up topics:
${list}

Output ONLY this JSON:
{ "resolved_ids": string[] }
Include each id at most once. Use [] when nothing is resolved.`
}

export async function resolveTopics(
  inboundText: string,
  reminders: PendingReminder[],
  llm?: HfRouterLlm,
): Promise<string[]> {
  if (reminders.length === 0) return []
  const text = inboundText.trim()
  if (text.length < 2) return []

  const client = llm ?? new HfRouterLlm({ model: ragConfig.classifierModel })

  let raw: string
  try {
    raw = await client.complete(
      [
        { role: 'system', content: buildSystem(reminders) },
        { role: 'user', content: text.slice(0, 1500) },
      ],
      { responseFormat: 'json_object', temperature: 0, maxTokens: 200 },
    )
  } catch (e) {
    console.warn('[reminders.resolve] LLM call failed', e)
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  const result = Schema.safeParse(parsed)
  if (!result.success) return []

  const valid = new Set(reminders.map((r) => r.id))
  return result.data.resolved_ids.filter((id) => valid.has(id))
}
