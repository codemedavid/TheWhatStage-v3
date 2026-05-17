export const GENERATION_KINDS = [
  'knowledge',
  'faqs',
  'personality_seed',
  'form_fields',
  'bot_instructions',
] as const

export type GenerationKind = (typeof GENERATION_KINDS)[number]

export type GenerationStatus = 'queued' | 'running' | 'done' | 'failed'

export interface GenerationJob {
  id: string
  profile_id: string
  kind: GenerationKind
  status: GenerationStatus
  input_hash: string
  result: unknown
  error: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export function isGenerationKind(value: unknown): value is GenerationKind {
  return typeof value === 'string' && (GENERATION_KINDS as readonly string[]).includes(value)
}
