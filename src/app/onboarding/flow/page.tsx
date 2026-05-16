import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { FlowForm } from './FlowForm'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getOnboardingState, getPrimaryActionPage } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'

export const dynamic = 'force-dynamic'

export default async function FlowPage() {
  const [lang, page, state] = await Promise.all([
    getOnboardingLang(),
    getPrimaryActionPage(),
    getOnboardingState(),
  ])

  if (!page) {
    return (
      <WizardShell lang={lang} step="flow">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('flow.heading', lang)}</h1>
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>{t('flow.error.no_goal', lang)}</p>
          <Link href="/onboarding/goal" className="mt-2 inline-block font-medium underline">
            {t('shell.back', lang)}
          </Link>
        </div>
      </WizardShell>
    )
  }

  return (
    <WizardShell lang={lang} step="flow">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('flow.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('flow.subheading', lang)}</p>
      <div className="mt-6">
        <FlowForm
          lang={lang}
          pageId={page.id}
          pageTitle={page.title}
          initialDescription={state?.flow_description ?? ''}
        />
      </div>
    </WizardShell>
  )
}
