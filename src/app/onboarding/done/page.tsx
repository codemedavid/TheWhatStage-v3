import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { completeOnboardingAction } from '../actions'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { t } from '@/lib/onboarding/i18n'

export default async function DonePage() {
  const lang = await getOnboardingLang()
  return (
    <WizardShell lang={lang} step={null} terminal="done">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('done.title', lang)}</h1>
      <p className="mt-3 text-zinc-700">{t('done.body', lang)}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/dashboard/chatbot"
          className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          {t('done.open_tester', lang)}
        </Link>
        <form action={completeOnboardingAction}>
          <button
            type="submit"
            className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            {t('done.go_dashboard', lang)}
          </button>
        </form>
      </div>
    </WizardShell>
  )
}
