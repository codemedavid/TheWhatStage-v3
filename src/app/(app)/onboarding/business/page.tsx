import { WizardShell } from '../_components/WizardShell'
import { BusinessForm } from './BusinessForm'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getBusinessBasics } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'

export default async function BusinessPage() {
  const [lang, initial] = await Promise.all([
    getOnboardingLang(),
    getBusinessBasics(),
  ])
  return (
    <WizardShell lang={lang} step="business">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('business.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('business.subheading', lang)}</p>
      <div className="mt-6">
        <BusinessForm lang={lang} initial={initial} />
      </div>
    </WizardShell>
  )
}
