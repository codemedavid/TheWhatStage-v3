import Link from 'next/link'
import { skipStepAction } from '../actions'
import { t } from '@/lib/onboarding/i18n'
import { prevStepRoute } from '@/lib/onboarding/steps'
import type { OnboardingLang, OnboardingStep } from '@/lib/onboarding/types'

interface Props {
  step: OnboardingStep
  lang: OnboardingLang
  /** Render a primary submit/continue button (caller decides label + form). */
  continueSlot?: React.ReactNode
}

export function StepNav({ step, lang, continueSlot }: Props) {
  return (
    <div className="ob-nav">
      <Link href={prevStepRoute(step)} className="ob-btn ob-btn-ghost">
        {t('shell.back', lang)}
      </Link>
      <div className="ob-nav-actions">
        <button
          type="submit"
          formAction={skipStepAction.bind(null, step)}
          formNoValidate
          className="ob-btn ob-btn-text"
        >
          {t('shell.skip_step', lang)}
        </button>
        {continueSlot}
      </div>
    </div>
  )
}
