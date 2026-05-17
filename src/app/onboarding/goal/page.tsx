import { WizardShell } from '../_components/WizardShell'
import { GoalCards } from './GoalCards'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getBusinessBasics } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'
import { stepEyebrow } from '../_components/stepEyebrow'

export const dynamic = 'force-dynamic'

export default async function GoalPage() {
  const [lang, basics] = await Promise.all([getOnboardingLang(), getBusinessBasics()])
  return (
    <WizardShell lang={lang} step="goal">
      <p className="ob-eyebrow">{stepEyebrow('goal', lang)}</p>
      <h1 className="ob-title">{t('goal.heading', lang)}</h1>
      <p className="ob-sub">{t('goal.subheading', lang)}</p>
      <GoalCards lang={lang} businessType={basics?.business_type ?? null} />
    </WizardShell>
  )
}
