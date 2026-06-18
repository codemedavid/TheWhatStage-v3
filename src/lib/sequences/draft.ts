// LLM draft wrappers for follow-up sequences. Kept separate from shared.ts
// (which does Supabase/crypto/RAG I/O) so the model-call layer stays trivially
// unit-testable — mirrors why ./draftPrompt (pure prompt assembly) is its own
// module. Two entry points:
//   - draftSequenceStep:  draft ONE touch (used as the per-step fallback path).
//   - draftSequenceBatch: draft the WHOLE sequence in ONE call (the default for
//     real sends + the test preview), so we spend 1 generation per lead instead
//     of one per step.

import { HfRouterLlm } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'
import { manilaNowBlock } from '@/lib/time/manilaNow'
import {
  buildFollowupDraftPrompt,
  buildSequenceBatchPrompt,
  type DraftChatMessage,
  type BatchStep,
} from './draftPrompt'

// Shared brain inputs passed to both draft wrappers. `contextTitle` is the
// project title the message relates to (may be null for a lead with no active
// project). `aiInstructions` are that PROJECT's authoritative customer facts
// (never another project's). `knowledge` is a pre-rendered KB block, '' when
// none. The stage* fields are the per-stage follow-up guidance/rules.
interface DraftBrainInput {
  leadName: string | null
  persona: string | null
  instructions: string | null
  doRules: string[]
  dontRules: string[]
  knowledge: string | null
  contextTitle: string | null
  aiInstructions: string | null
  stageInstructions?: string | null
  stageDoRules?: string[]
  stageDontRules?: string[]
  recentMessages: DraftChatMessage[]
}

function makeLlm(): HfRouterLlm {
  return new HfRouterLlm({ model: process.env.AGENT_DRAFT_MODEL ?? ragConfig.classifierModel })
}

// Draft one follow-up step. Assembles the full chatbot brain (persona +
// instructions + global/stage Do/Don't rules + knowledge) and grounds the touch
// in THIS project's AI instructions + this thread's conversation. The prompt
// assembly is a pure, unit-tested function (./draftPrompt); this wrapper only
// does the LLM call.
export async function draftSequenceStep(
  args: DraftBrainInput & { stepInstruction: string },
): Promise<string> {
  const { system, user } = buildFollowupDraftPrompt({
    nowBlock: manilaNowBlock(),
    ...args,
  })

  const draft = await makeLlm().complete(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { temperature: 0.6, maxTokens: 200 },
  )
  return draft.trim()
}

export interface BatchDraft {
  position: number
  text: string
}

// Draft the WHOLE sequence in one LLM call. Returns one {position, text} per
// step the model produced. Parsing is robust: markdown fences are stripped, a
// partial array yields a partial result, and any parse/LLM failure yields []
// so the caller falls back per step (never drops a touch). maxTokens scales with
// the step count so a long sequence isn't truncated mid-array.
export async function draftSequenceBatch(
  args: DraftBrainInput & { steps: BatchStep[] },
): Promise<BatchDraft[]> {
  const { steps, ...brain } = args
  if (steps.length === 0) return []

  const { system, user } = buildSequenceBatchPrompt({
    nowBlock: manilaNowBlock(),
    steps,
    ...brain,
  })

  let raw = ''
  try {
    raw = await makeLlm().complete(
      [{ role: 'system', content: system }, { role: 'user', content: user }],
      { temperature: 0.6, maxTokens: Math.min(1200, 150 * steps.length + 100) },
    )
  } catch (e) {
    console.warn('[sequence] batch draft failed', e instanceof Error ? e.message : String(e))
    return []
  }

  return parseBatchDrafts(raw)
}

// Parse the model's JSON array of {step|position, message|text} into clean
// {position, text} entries. Tolerates markdown fences and surrounding prose by
// extracting the first JSON array. Returns [] on any failure.
export function parseBatchDrafts(raw: string): BatchDraft[] {
  const json = extractJsonArray(raw)
  if (!json) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const out: BatchDraft[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const pos = rec.step ?? rec.position
    const msg = rec.message ?? rec.text
    if (typeof pos !== 'number' || typeof msg !== 'string') continue
    const text = msg.trim()
    if (!text) continue
    out.push({ position: pos, text })
  }
  return out
}

// Pull the first top-level JSON array out of a completion that may be wrapped in
// ```json fences or padded with prose. Returns null when no array is present.
function extractJsonArray(raw: string): string | null {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  return raw.slice(start, end + 1)
}
