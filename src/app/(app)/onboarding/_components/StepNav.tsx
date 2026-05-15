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
    <div className="flex items-center justify-between gap-3 pt-6">
      <Link
        href={prevStepRoute(step)}
        className="text-sm text-zinc-600 hover:text-zinc-900"
      >
        {t('shell.back', lang)}
      </Link>
      <div className="flex items-center gap-3">
        <form action={skipStepAction}>
          <input type="hidden" name="step" value={step} />
          <button
            type="submit"
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            {t('shell.skip_step', lang)}
          </button>
        </form>
        {continueSlot}
      </div>
    </div>
  )
}
