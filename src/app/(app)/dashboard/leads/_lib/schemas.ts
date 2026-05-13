import { z } from 'zod'

export const StageInput = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(500).optional().nullable(),
  kind: z.enum(['entry','qualifying','nurture','decision','won','lost','dormant','objection']).optional(),
  entry_signals: z.array(z.string().min(1).max(240)).max(20).optional(),
  exit_signals: z.array(z.string().min(1).max(240)).max(20).optional(),
  required_fields: z.array(z.string().min(1).max(80)).max(20).optional(),
})
export type StageInput = z.infer<typeof StageInput>

export const FieldDefInput = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().min(1).max(60),
  type: z.enum(['text', 'number', 'date', 'select']),
  options: z.array(z.string().min(1)).optional().nullable(),
})
export type FieldDefInput = z.infer<typeof FieldDefInput>

export const LeadInput = z.object({
  stage_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().max(40).optional().nullable(),
  company: z.string().max(120).optional().nullable(),
  job_title: z.string().max(120).optional().nullable(),
  source: z.string().max(60).optional().nullable(),
  estimated_value: z.number().nonnegative().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  custom_fields: z.record(z.string(), z.unknown()).default({}),
  campaign_id: z.string().uuid().nullable().optional(),
})
export type LeadInput = z.infer<typeof LeadInput>

export const BulkUpdateInput = LeadInput.partial().omit({ stage_id: true })
export type BulkUpdateInput = z.infer<typeof BulkUpdateInput>

export const LeadsQuery = z.object({
  view: z.enum(['kanban', 'table']).default('kanban'),
  stage: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  q: z.string().trim().max(120).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sort: z.enum(['recent', 'oldest', 'name_asc', 'value_desc']).default('recent'),
})
export type LeadsQuery = z.infer<typeof LeadsQuery>

export const PAGE_SIZE = 25
