import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { completeOnboardingAction } from '../actions'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { t } from '@/lib/onboarding/i18n'

export default async function DonePage() {
  const lang = await getOnboardingLang()
  return (
    <WizardShell lang={lang} step={null} terminal="done">
      <p className="ob-eyebrow">{lang === 'tl' ? 'Tapos na · Done' : 'All set · Done'}</p>
      <h1 className="ob-title">{t('done.title', lang)}</h1>
      <p className="ob-sub">{t('done.body', lang)}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/dashboard/chatbot"
          className="ob-btn ob-btn-primary"
        >
          {t('done.open_tester', lang)}
        </Link>
        <form action={completeOnboardingAction}>
          <button
            type="submit"
            className="ob-btn ob-btn-ghost"
          >
            {t('done.go_dashboard', lang)}
          </button>
        </form>
      </div>
    </WizardShell>
  )
}
