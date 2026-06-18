import { z } from 'zod'
import { SequenceStepInput } from '../../projects/_lib/schemas'

// Lead-scoped follow-up sequence input. Reuses the project sequence step shape
// (delay_minutes + instruction + messenger channel); anchored to lead_id.
export const LeadSequenceInput = z.object({
  lead_id: z.string().uuid(),
  enabled: z.boolean().default(true),
  steps: z.array(SequenceStepInput).max(20),
})
export type LeadSequenceInput = z.infer<typeof LeadSequenceInput>
