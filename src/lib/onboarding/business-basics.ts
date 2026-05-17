import { z } from 'zod'

export const BUSINESS_TYPES = ['service', 'ecom', 'digital', 'realestate'] as const
export type BusinessType = (typeof BUSINESS_TYPES)[number]

export const TONE_PRESETS = ['friendly', 'professional', 'playful', 'calm'] as const
export type TonePreset = (typeof TONE_PRESETS)[number]

// Field-level floors block the dogfood-flagged "xx" / "a" / "b" inputs from
// being templated into customer-facing knowledge/FAQs. Real one-liners about
// what a business sells are practically always >= 10 chars.
const meaningful = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, label)
    .max(max, `Must be ${max} characters or fewer`)
    // Reject `xxxx`, `aaaaaa`, `------` — anything below 3 distinct chars is
    // almost certainly placeholder noise rather than a real answer.
    .refine((s) => new Set(s.toLowerCase().replace(/\s+/g, '')).size >= 3, {
      message: 'Please give a real answer (a few words is fine).',
    })

export const BusinessBasicsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Business name needs at least 2 characters')
    .max(120, 'Must be 120 characters or fewer'),
  offer: meaningful(10, 500, 'Describe your offer in a sentence (at least 10 characters).'),
  business_type: z.enum(BUSINESS_TYPES),
  audience: meaningful(8, 500, 'Tell us who this is for (at least 8 characters).'),
  pain: meaningful(8, 500, 'Tell us the problem you solve (at least 8 characters).'),
  tone: z.enum(TONE_PRESETS),
})

export type BusinessBasics = z.infer<typeof BusinessBasicsSchema>
