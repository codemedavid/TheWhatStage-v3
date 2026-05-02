import { z } from 'zod'

export const CampaignStatus = z.enum(['draft', 'active', 'paused', 'archived'])
export type CampaignStatus = z.infer<typeof CampaignStatus>

export const AssignmentMode = z.enum(['manual', 'random'])
export type AssignmentMode = z.infer<typeof AssignmentMode>

export const PersonalityMode = z.enum(['chatbot', 'custom'])
export type PersonalityMode = z.infer<typeof PersonalityMode>

export const Requirement = z.object({
  key: z.string().min(1).max(40).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(80),
  question: z.string().min(1).max(500),
  lead_field_key: z.string().min(1).max(40).regex(/^[a-z][a-z0-9_]*$/),
  required: z.boolean(),
})
export type Requirement = z.infer<typeof Requirement>

export const FunnelRule = z.object({
  kind: z.enum(['do', 'dont']),
  text: z.string().min(1).max(280),
})
export type FunnelRule = z.infer<typeof FunnelRule>


export const CreateCampaignInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
})

export const UpdateCampaignInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  enabled: z.boolean(),
  status: CampaignStatus,
  assignment_mode: AssignmentMode,
  weight: z.number().int().min(0).max(100),
  personality_mode: PersonalityMode,
  persona: z.string().max(4000),
  do_rules: z.array(z.string().min(1).max(280)).max(20),
  dont_rules: z.array(z.string().min(1).max(280)).max(20),
  goal_action_page_id: z.string().uuid().nullable(),
})

export const ToggleCampaignEnabledInput = z.object({
  id: z.string().uuid(),
  enabled: z.boolean(),
})

export const DeleteCampaignInput = z.object({ id: z.string().uuid() })

export const CreateFunnelInput = z.object({
  campaign_id: z.string().uuid(),
  name: z.string().min(1).max(120),
})

export const UpdateFunnelInput = z.object({
  id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  requirements: z.array(Requirement).max(20),
  rules: z.array(FunnelRule).max(20),
  instruction: z.string().max(4000),
  action_page_id: z.string().uuid().nullable(),
  next_funnel_id: z.string().uuid().nullable(),
})

export const DeleteFunnelInput = z.object({
  id: z.string().uuid(),
  campaign_id: z.string().uuid(),
})

export const ReorderFunnelsInput = z.object({
  campaign_id: z.string().uuid(),
  ordered_ids: z.array(z.string().uuid()).min(1).max(40),
})
