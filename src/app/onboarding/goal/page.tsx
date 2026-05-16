import { WizardShell } from '../_components/WizardShell'
import { GoalCards } from './GoalCards'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getBusinessBasics } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'

export const dynamic = 'force-dynamic'

export default async function GoalPage() {
  const [lang, basics] = await Promise.all([getOnboardingLang(), getBusinessBasics()])
  return (
    <WizardShell lang={lang} step="goal">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('goal.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('goal.subheading', lang)}</p>
      <div className="mt-6">
        <GoalCards lang={lang} businessType={basics?.business_type ?? null} />
      </div>
    </WizardShell>
  )
}
