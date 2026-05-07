import { HfRouterLlm } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'
import { z } from 'zod'
import type { ParsedIntent } from './types'

const IntentSchema = z.object({
  audience: z.object({
    stage_name: z.string().nullable(),
    last_active_within_days: z.number().nullable(),
  }),
  instruction: z.string(),
  tone: z.enum(['friendly', 'casual', 'professional']),
  ambiguities: z.array(z.string()),
})

function buildSystem(stages: string[]): string {
  return `You convert sales follow-up commands into structured JSON.
Output ONLY this JSON schema — no preamble, no markdown, no extra keys:
{
  "audience": {
    "stage_name": string | null,
    "last_active_within_days": number | null
  },
  "instruction": string,
  "tone": "friendly" | "casual" | "professional",
  "ambiguities": string[]
}

Rules:
- stage_name: best case-insensitive match from the available stages list, or null if unspecified
- instruction: exactly what the user wants said, verbatim or closely paraphrased
- tone: infer from the command; default "friendly"
- ambiguities: short strings for each thing you're unsure about (empty array if confident)

Available pipeline stages: ${stages.length > 0 ? stages.join(', ') : '(none — user has not set up stages yet)'}`
}

export async function parseIntent(
  command: string,
  stages: string[],
  llm?: HfRouterLlm,
): Promise<ParsedIntent> {
  const client =
    llm ??
    new HfRouterLlm({
      model: process.env.AGENT_DRAFT_MODEL ?? ragConfig.classifierModel,
    })

  const raw = await client.complete(
    [
      { role: 'system', content: buildSystem(stages) },
      { role: 'user', content: command.trim().slice(0, 2000) },
    ],
    { responseFormat: 'json_object', temperature: 0, maxTokens: 512 },
  )

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`parseIntent: LLM returned non-JSON: ${raw.slice(0, 200)}`)
  }

  const result = IntentSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`parseIntent: schema mismatch — ${result.error.message}`)
  }
  return result.data
}
