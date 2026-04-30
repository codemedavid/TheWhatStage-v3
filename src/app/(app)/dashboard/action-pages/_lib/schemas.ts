import { z } from 'zod'
import { ACTION_PAGE_KINDS } from '@/lib/action-pages/kinds'

export const ActionPageStatus = z.enum(['draft', 'published', 'archived'])
export const ActionPageKindSchema = z.enum(ACTION_PAGE_KINDS)

const slug = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes only')

export const PipelineRule = z.object({
  outcome: z.string().min(1).max(40),
  to_stage_id: z.string().uuid().nullable(),
  reason: z.string().max(200).optional(),
})
export type PipelineRule = z.infer<typeof PipelineRule>

export const CreateActionPageInput = z.object({
  kind: ActionPageKindSchema,
  title: z.string().min(1).max(120),
})

export const UpdateActionPageInput = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  slug: slug,
  status: ActionPageStatus,
  pipeline_rules: z.array(PipelineRule).max(20),
  notification_template: z
    .object({
      text: z.string().max(640).optional(),
    })
    .nullable()
    .optional(),
  // Kind-specific config blob — opaque to the base, validated by each kind editor.
  config: z.record(z.string(), z.unknown()).optional(),
})

export const DeleteActionPageInput = z.object({ id: z.string().uuid() })
