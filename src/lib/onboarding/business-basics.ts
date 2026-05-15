import { z } from 'zod'

export const BUSINESS_TYPES = ['service', 'ecom', 'digital', 'realestate'] as const
export type BusinessType = (typeof BUSINESS_TYPES)[number]

export const TONE_PRESETS = ['friendly', 'professional', 'playful', 'calm'] as const
export type TonePreset = (typeof TONE_PRESETS)[number]

const trimmedNonEmpty = (max: number) =>
  z
    .string()
    .trim()
    .min(1, 'Required')
    .max(max, `Must be ${max} characters or fewer`)

export const BusinessBasicsSchema = z.object({
  name: trimmedNonEmpty(120),
  offer: trimmedNonEmpty(500),
  business_type: z.enum(BUSINESS_TYPES),
  audience: trimmedNonEmpty(500),
  pain: trimmedNonEmpty(500),
  tone: z.enum(TONE_PRESETS),
})

export type BusinessBasics = z.infer<typeof BusinessBasicsSchema>
