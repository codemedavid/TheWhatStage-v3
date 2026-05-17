import { z } from 'zod'

/**
 * Pure (non-server-only) Zod schema + types for form-field / qualification
 * blocks produced by the form-fields generator. Lives outside form-fields.ts
 * so that page-side parsers (result-schemas.ts) can validate persisted
 * generation_jobs.result rows without pulling the `server-only` runtime tag
 * — and so the generator and the parser cannot drift apart silently.
 */

export type FormFieldKind =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'number'
  | 'single_choice'

export const BlockSchema = z.object({
  id: z.string(),
  type: z.enum(['field', 'heading']),
  key: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  level: z.number().int().optional(),
  field_kind: z
    .enum(['short_text', 'long_text', 'email', 'phone', 'number', 'single_choice'])
    .optional(),
  required: z.boolean().optional(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  prompt: z.string().optional(),
})

export type SuggestedBlock = z.infer<typeof BlockSchema>
