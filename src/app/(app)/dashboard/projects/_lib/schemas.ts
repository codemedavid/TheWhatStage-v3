import { z } from 'zod'

export const ProjectStageKind = z.enum(['open', 'won', 'lost'])

export const ProjectStageInput = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(500).optional().nullable(),
  kind: ProjectStageKind.optional(),
  color: z.string().max(32).optional().nullable(),
})
export type ProjectStageInput = z.infer<typeof ProjectStageInput>

export const ProjectInput = z.object({
  lead_id: z.string().uuid(),
  stage_id: z.string().uuid(),
  origin_submission_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(160),
  description: z.string().max(4000).optional().nullable(),
  value: z.number().nonnegative().optional().nullable(),
  // Resolved server-side from business_profiles.default_currency when omitted.
  currency: z.string().length(3).optional(),
  ai_instructions: z.string().max(4000).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
})
export type ProjectInput = z.infer<typeof ProjectInput>

// Drawer edits. stage_id is handled via moveProject; lead_id is immutable.
export const ProjectUpdateInput = ProjectInput.partial().omit({
  lead_id: true,
  stage_id: true,
})
export type ProjectUpdateInput = z.infer<typeof ProjectUpdateInput>

export const SequenceStepInput = z.object({
  delay_minutes: z.number().int().min(0).max(525600),
  instruction: z.string().min(1).max(2000),
  // Sent verbatim when the AI draft for this step is empty or errors, so a
  // follow-up touch is never silently dropped. Blank => engine uses a default.
  fallback_message: z.string().max(2000).optional().nullable(),
  channel: z.literal('messenger').default('messenger'),
})
export type SequenceStepInput = z.infer<typeof SequenceStepInput>

export const SequenceInput = z.object({
  stage_id: z.string().uuid(),
  enabled: z.boolean().default(true),
  // Per-stage AI guidance: how to communicate / follow up while a card sits in
  // this stage. Stage-wide (applies to every card), layered on top of the
  // global chatbot brain. Keep generic — customer specifics live on each card.
  stage_instructions: z.string().max(2000).optional().nullable(),
  do_rules: z.array(z.string().min(1).max(280)).max(20).default([]),
  dont_rules: z.array(z.string().min(1).max(280)).max(20).default([]),
  steps: z.array(SequenceStepInput).max(20),
})
export type SequenceInput = z.infer<typeof SequenceInput>

// Generate a no-send preview of a stage's follow-up sequence for ONE project
// (lead), drafted from the in-editor config so an operator can test before
// saving. Steps are the unsaved editor state; project_id picks whose facts +
// conversation ground the draft.
export const SequencePreviewInput = z.object({
  stage_id: z.string().uuid(),
  project_id: z.string().uuid(),
  stage_instructions: z.string().max(2000).optional().nullable(),
  do_rules: z.array(z.string().min(1).max(280)).max(20).default([]),
  dont_rules: z.array(z.string().min(1).max(280)).max(20).default([]),
  steps: z.array(SequenceStepInput).min(1).max(20),
})
export type SequencePreviewInput = z.infer<typeof SequencePreviewInput>

export const ProjectsQuery = z.object({
  view: z.enum(['kanban', 'table']).default('kanban'),
  stage: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().trim().max(120).optional(),
  // Quick date-range preset, matched on each project's last activity
  // (`updated_at`). Unlike leads (which default to `today`), projects are
  // long-lived pipeline items, so the board defaults to `all` to avoid hiding
  // existing work on load. `custom` means the explicit `from`/`to` bounds take
  // over; `all` clears the date filter entirely.
  range: z.enum(['today', 'week', 'month', 'all', 'custom']).default('all'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sort: z.enum(['recent', 'oldest', 'title_asc', 'value_desc']).default('recent'),
})
export type ProjectsQuery = z.infer<typeof ProjectsQuery>

export const PAGE_SIZE = 25
