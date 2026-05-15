import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { KnowledgeEditor } from './KnowledgeEditor'
import { RegenerateButton } from './RegenerateButton'
import { generateKnowledgeAction } from '../actions'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { t } from '@/lib/onboarding/i18n'

export const dynamic = 'force-dynamic'

export default async function KnowledgePage() {
  const lang = await getOnboardingLang()
  const result = await generateKnowledgeAction()

  return (
    <WizardShell lang={lang} step="knowledge">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('knowledge.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('knowledge.subheading', lang)}</p>

      {result.ok === false && result.error === 'no_basics' ? (
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>{t('knowledge.error.no_basics', lang)}</p>
          <Link
            href="/onboarding/business"
            className="mt-2 inline-block font-medium underline"
          >
            {t('shell.back', lang)}
          </Link>
        </div>
      ) : result.ok === false ? (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p>{t('knowledge.error.generation', lang)}</p>
          <div className="mt-3 flex gap-3">
            <RegenerateButton lang={lang} />
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <div className="mb-3 flex justify-end">
            <RegenerateButton lang={lang} />
          </div>
          <KnowledgeEditor lang={lang} initial={result.data.sections} />
        </div>
      )}
    </WizardShell>
  )
}
