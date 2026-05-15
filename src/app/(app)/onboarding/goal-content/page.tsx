import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getPrimaryActionPage } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'
import { isActionPageKind } from '@/lib/action-pages/kinds'

export const dynamic = 'force-dynamic'

export default async function GoalContentPage() {
  const [lang, page] = await Promise.all([getOnboardingLang(), getPrimaryActionPage()])

  if (!page || !isActionPageKind(page.kind)) {
    return (
      <WizardShell lang={lang} step="goal_content">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('goal_content.heading', lang)}</h1>
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>{t('goal_content.error.no_goal', lang)}</p>
          <Link href="/onboarding/goal" className="mt-2 inline-block font-medium underline">
            {t('shell.back', lang)}
          </Link>
        </div>
      </WizardShell>
    )
  }

  return (
    <WizardShell lang={lang} step="goal_content">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('goal_content.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('goal_content.subheading', lang)}</p>
      <p className="mt-6 text-sm text-zinc-500">[Placeholder — kind={page.kind}. Per-kind forms follow in next task.]</p>
    </WizardShell>
  )
}
