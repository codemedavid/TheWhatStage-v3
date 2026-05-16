import { WizardShell } from './WizardShell'
import { StepNav } from './StepNav'
import { t, type DictKey } from '@/lib/onboarding/i18n'
import type { OnboardingLang, OnboardingStep } from '@/lib/onboarding/types'

interface Props {
  step: OnboardingStep
  lang: OnboardingLang
  titleKey: DictKey
}

export function StepStub({ step, lang, titleKey }: Props) {
  return (
    <WizardShell lang={lang} step={step}>
      <h1 className="text-2xl font-semibold text-zinc-900">{t(titleKey, lang)}</h1>
      <p className="mt-2 text-sm text-zinc-600">{t('stub.body', lang)}</p>
      <StepNav step={step} lang={lang} />
    </WizardShell>
  )
}
