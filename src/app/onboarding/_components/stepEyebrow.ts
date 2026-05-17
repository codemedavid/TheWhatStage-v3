import { STEP_ORDER } from '@/lib/onboarding/steps'
import { t, type DictKey } from '@/lib/onboarding/i18n'
import type { OnboardingLang, OnboardingStep } from '@/lib/onboarding/types'

/**
 * Renders the canonical "NN · Label" eyebrow string for a step page,
 * pulling the step number + label key from STEP_ORDER so pages don't
 * hardcode their position.
 */
export function stepEyebrow(step: OnboardingStep, lang: OnboardingLang): string {
  const idx = STEP_ORDER.findIndex((s) => s.id === step)
  const num = idx >= 0 ? String(idx + 1).padStart(2, '0') : '00'
  const labelKey = (idx >= 0 ? STEP_ORDER[idx].labelKey : 'checklist.title') as DictKey
  return `${num} · ${t(labelKey, lang)}`
}
