import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getPrimaryActionPage } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'
import { isActionPageKind } from '@/lib/action-pages/kinds'
import { CatalogContent } from './CatalogContent'
import { SalesContent } from './SalesContent'
import { BookingContent } from './BookingContent'
import { RealestateContent } from './RealestateContent'
import { FormFieldsContent } from './FormFieldsContent'
import { stepEyebrow } from '../_components/stepEyebrow'

export const dynamic = 'force-dynamic'

export default async function GoalContentPage() {
  const [lang, page] = await Promise.all([getOnboardingLang(), getPrimaryActionPage()])

  if (!page || !isActionPageKind(page.kind)) {
    return (
      <WizardShell lang={lang} step="goal_content">
        <p className="ob-eyebrow">{stepEyebrow('goal_content', lang)}</p>
        <h1 className="ob-title">{t('goal_content.heading', lang)}</h1>
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
      <p className="ob-eyebrow">{stepEyebrow('goal_content', lang)}</p>
      <h1 className="ob-title">{t('goal_content.heading', lang)}</h1>
      <p className="ob-sub">{t('goal_content.subheading', lang)}</p>
      <div className="mt-2">
        {page.kind === 'catalog' && <CatalogContent lang={lang} pageId={page.id} />}
        {page.kind === 'sales' && <SalesContent lang={lang} pageId={page.id} config={page.config} />}
        {page.kind === 'booking' && <BookingContent lang={lang} pageId={page.id} config={page.config} />}
        {page.kind === 'realestate' && <RealestateContent lang={lang} pageId={page.id} />}
        {(page.kind === 'form' || page.kind === 'qualification') && (
          <FormFieldsContent lang={lang} pageId={page.id} kind={page.kind} config={page.config} />
        )}
      </div>
    </WizardShell>
  )
}
