import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { t } from '@/lib/onboarding/i18n'

export default async function WelcomePage() {
  const lang = await getOnboardingLang()
  return (
    <WizardShell lang={lang} step={null}>
      <h1 className="text-2xl font-semibold text-zinc-900">{t('welcome.title', lang)}</h1>
      <p className="mt-3 text-zinc-700">{t('welcome.body', lang)}</p>
      <div className="mt-8">
        <Link
          href="/onboarding/business"
          className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          {t('welcome.start', lang)}
        </Link>
      </div>
    </WizardShell>
  )
}
