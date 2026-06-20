// Shared project domain types. Lives under src/lib (not the dashboard route)
// so both the dashboard UI and the server-side AI paths (messenger worker,
// follow-up agent, sequence worker) can import without crossing route bounds.

export type ProjectStageKind = 'open' | 'won' | 'lost'

export type ProjectStageRow = {
  id: string
  name: string
  description: string | null
  position: number
  is_default: boolean
  kind: ProjectStageKind | null
  color: string | null
}

export type ProjectRow = {
  id: string
  user_id: string
  lead_id: string
  origin_submission_id: string | null
  stage_id: string
  title: string
  description: string | null
  value: number | null
  currency: string
  ai_instructions: string | null
  notes: string | null
  position: number
  created_at: string
  updated_at: string
}

// Minimal shape the AI paths need to align the model to a specific project.
export type ActiveProjectContext = {
  id: string
  title: string
  stage_name: string | null
  stage_kind: ProjectStageKind | null
  value: number | null
  currency: string
  ai_instructions: string | null
  // Per-stage AI guidance (from project_stage_sequences for the project's
  // current stage). Steers HOW the bot talks to an in-progress customer.
  stage_instructions: string | null
  stage_do_rules: string[]
  stage_dont_rules: string[]
}

export type ProjectSequenceStep = {
  id: string
  position: number
  delay_minutes: number
  instruction: string
  channel: 'messenger'
}

export type ProjectSequenceRunStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'cancelled'
  | 'failed'
