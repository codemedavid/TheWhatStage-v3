export type OnboardingLang = 'tl' | 'en'

export const ONBOARDING_STEPS = [
  'business',
  'knowledge',
  'faqs',
  'personality',
  'goal',
  'goal_content',
  'flow',
] as const

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export interface OnboardingState {
  profileId: string
  business_completed_at: string | null
  knowledge_completed_at: string | null
  faqs_completed_at: string | null
  personality_completed_at: string | null
  goal_completed_at: string | null
  goal_content_completed_at: string | null
  flow_completed_at: string | null
  completed_at: string | null
  dismissed_at: string | null
  business_basics: unknown
  faq_seeds: unknown
  personality_seeds: unknown
  flow_description: string | null
  ai_generations: unknown
  ui_language: OnboardingLang
  customer_language: OnboardingLang
  created_at: string
  updated_at: string
}

export interface OnboardingAuditEntry {
  step: OnboardingStep
  at: string
  model?: string
  prompt_hash?: string
  skipped?: boolean
}
