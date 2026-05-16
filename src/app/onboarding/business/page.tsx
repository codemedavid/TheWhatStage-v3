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
      <p className="ob-eyebrow">01 · {t('business.heading', lang)}</p>
      <h1 className="ob-title">{t('business.heading', lang)}</h1>
      <p className="ob-sub">{t('business.subheading', lang)}</p>
      <BusinessForm lang={lang} initial={initial} />
    </WizardShell>
  )
}
