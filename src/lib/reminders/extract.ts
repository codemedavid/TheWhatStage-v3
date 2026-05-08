import { HfRouterLlm } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'
import { z } from 'zod'

export const REMINDER_TZ = 'Asia/Manila'

export interface ExtractedReminder {
  scheduled_at: string // UTC ISO string
  topic: string
  confidence: 'low' | 'medium' | 'high'
}

const Schema = z.object({
  has_request: z.boolean(),
  when_local: z.string().nullable(), // "YYYY-MM-DD HH:mm" in Asia/Manila
  topic: z.string().nullable(),
  confidence: z.enum(['low', 'medium', 'high']).nullable(),
})

function nowInManila(): { iso: string; weekday: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: REMINDER_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'long',
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]))
  const iso = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
  return { iso, weekday: parts.weekday ?? '' }
}

// Convert "YYYY-MM-DD HH:mm" interpreted in Asia/Manila to a UTC ISO string.
// Manila has no DST and is fixed UTC+08:00, so we append the offset.
function manilaLocalToUtcIso(localStr: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(localStr.trim())
  if (!m) return null
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function buildSystem(now: { iso: string; weekday: string }): string {
  return `You detect when a customer has asked to be contacted again at a specific later time.

Today is ${now.weekday}, ${now.iso} in Asia/Manila timezone (UTC+08:00).

Output ONLY this JSON — no preamble, no markdown:
{
  "has_request": boolean,
  "when_local": string | null,
  "topic": string | null,
  "confidence": "low" | "medium" | "high" | null
}

Rules:
- has_request=true ONLY if the customer is clearly asking to be messaged or called back at a specific later time.
  Examples that ARE requests: "chat me back on May 12", "message me at 12pm", "follow up tomorrow", "send me the details next Monday morning", "I'll be free at 3pm, ping me then".
  Examples that are NOT requests: "maybe later", "I'll think about it", "talk soon", vague intent without a specific time.
- when_local must be in format "YYYY-MM-DD HH:mm" representing Asia/Manila local time. Resolve relative phrases against the current time above.
  - If only a date is given, default to 09:00.
  - If only a time is given for "later today" and that time has already passed, schedule for the same time the next day.
  - The result must be in the FUTURE relative to current time.
- topic: short phrase capturing WHY they want a follow-up ("send pricing", "confirm Friday viewing", "follow up on the proposal"). If no specific topic, use "general follow-up". Max 200 chars.
- confidence: high = unambiguous date+time+intent. medium = clear intent but some inference. low = uncertain.
- If has_request=false, set when_local, topic, confidence to null.`
}

export async function extractReminder(
  inboundText: string,
  llm?: HfRouterLlm,
): Promise<ExtractedReminder | null> {
  const text = inboundText.trim()
  if (text.length < 4) return null

  const client = llm ?? new HfRouterLlm({ model: ragConfig.classifierModel })
  const now = nowInManila()

  let raw: string
  try {
    raw = await client.complete(
      [
        { role: 'system', content: buildSystem(now) },
        { role: 'user', content: text.slice(0, 1500) },
      ],
      { responseFormat: 'json_object', temperature: 0, maxTokens: 200 },
    )
  } catch (e) {
    console.warn('[reminders.extract] LLM call failed', e)
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const result = Schema.safeParse(parsed)
  if (!result.success) return null
  const data = result.data
  if (!data.has_request || !data.when_local || !data.topic) return null

  const utc = manilaLocalToUtcIso(data.when_local)
  if (!utc) return null

  if (new Date(utc).getTime() <= Date.now() + 60_000) return null

  return {
    scheduled_at: utc,
    topic: data.topic.trim().slice(0, 500),
    confidence: data.confidence ?? 'medium',
  }
}
