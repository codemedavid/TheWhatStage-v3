import type { OnboardingState, OnboardingStep } from './types'

export interface StepMeta {
  id: OnboardingStep
  route: `/onboarding/${string}`
  /** label dictionary key (resolved via i18n.t) */
  labelKey: string
  /** state column predicate: returns true when the step is complete or skipped */
  isComplete: (s: OnboardingState) => boolean
}

export const STEP_ORDER: ReadonlyArray<StepMeta> = [
  { id: 'business',     route: '/onboarding/business',     labelKey: 'checklist.business',     isComplete: (s) => s.business_completed_at != null },
  { id: 'knowledge',    route: '/onboarding/knowledge',    labelKey: 'checklist.knowledge',    isComplete: (s) => s.knowledge_completed_at != null },
  { id: 'faqs',         route: '/onboarding/faqs',         labelKey: 'checklist.faqs',         isComplete: (s) => s.faqs_completed_at != null },
  { id: 'personality',  route: '/onboarding/personality',  labelKey: 'checklist.personality',  isComplete: (s) => s.personality_completed_at != null },
  { id: 'goal',         route: '/onboarding/goal',         labelKey: 'checklist.goal',         isComplete: (s) => s.goal_completed_at != null },
  { id: 'goal_content', route: '/onboarding/goal-content', labelKey: 'checklist.goal_content', isComplete: (s) => s.goal_content_completed_at != null },
  { id: 'flow',         route: '/onboarding/flow',         labelKey: 'checklist.flow',         isComplete: (s) => s.flow_completed_at != null },
] as const

export function stepCompletionColumn(step: OnboardingStep): string {
  return `${step}_completed_at`
}

export function nextStepRoute(current: OnboardingStep): string {
  const idx = STEP_ORDER.findIndex((s) => s.id === current)
  const next = STEP_ORDER[idx + 1]
  return next?.route ?? '/onboarding/done'
}

export function prevStepRoute(current: OnboardingStep): string {
  const idx = STEP_ORDER.findIndex((s) => s.id === current)
  if (idx <= 0) return '/onboarding/welcome'
  return STEP_ORDER[idx - 1].route
}
