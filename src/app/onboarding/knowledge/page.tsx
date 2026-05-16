import Link from 'next/link'
import { after } from 'next/server'
import { WizardShell } from '../_components/WizardShell'
import { KnowledgeEditor } from './KnowledgeEditor'
import { RegenerateButton } from './RegenerateButton'
import { retryGenerationAction } from '../actions'
import { GenerationGate } from '../_components/GenerationGate'
import { getJob } from '@/lib/onboarding/generation/repo'
import { runGeneration } from '@/lib/onboarding/generation/runner'
import { getAuthUser } from '@/lib/supabase/server'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getBusinessBasics } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'
import { parseKnowledgeResult } from '@/lib/onboarding/ai/result-schemas'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export default async function KnowledgePage() {
  const lang = await getOnboardingLang()
  const user = await getAuthUser()
  // Run the two RPCs in parallel; getBusinessBasics + getJob are independent.
  const [basics, job] = await Promise.all([
    getBusinessBasics(),
    user ? getJob(user.id, 'knowledge') : Promise.resolve(null),
  ])

  if (!basics) {
    return (
      <WizardShell lang={lang} step="knowledge">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('knowledge.heading', lang)}</h1>
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>{t('knowledge.error.no_basics', lang)}</p>
          <Link href="/onboarding/business" className="mt-2 inline-block font-medium underline">
            {t('shell.back', lang)}
          </Link>
        </div>
      </WizardShell>
    )
  }

  const parsedKnowledge = job?.status === 'done' ? parseKnowledgeResult(job.result) : null
  if (parsedKnowledge) {
    return (
      <WizardShell lang={lang} step="knowledge">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('knowledge.heading', lang)}</h1>
        <p className="mt-1 text-sm text-zinc-600">{t('knowledge.subheading', lang)}</p>
        <div className="mt-6">
          <div className="mb-3 flex justify-end"><RegenerateButton lang={lang} /></div>
          <KnowledgeEditor lang={lang} initial={parsedKnowledge.sections} />
        </div>
      </WizardShell>
    )
  }

  if (job?.status === 'failed') {
    return (
      <WizardShell lang={lang} step="knowledge">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('knowledge.heading', lang)}</h1>
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p>{t('knowledge.error.generation', lang)}</p>
          <p className="mt-2 text-xs text-red-800/80">{job.error ?? 'unknown_error'}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <form action={retryGenerationAction}>
              <input type="hidden" name="kind" value="knowledge" />
              <button type="submit" className="font-medium underline">
                {t('knowledge.retry', lang)}
              </button>
            </form>
            <Link href="/onboarding/faqs" className="font-medium underline">
              {t('gen.skip', lang)}
            </Link>
          </div>
        </div>
      </WizardShell>
    )
  }

  // No job row yet — lazily enqueue so existing users / direct nav / stale-swept
  // sessions still trigger generation. Use cookie-resolved lang directly; the
  // DB column is in sync via setLangAction.
  if (!job && user) {
    const profileId = user.id
    after(async () => {
      await runGeneration(profileId, 'knowledge', { basics, lang })
    })
  }

  return (
    <WizardShell lang={lang} step="knowledge">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('knowledge.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('knowledge.subheading', lang)}</p>
      <GenerationGate
        kind="knowledge"
        animationHeading={t('gen.knowledge.heading', lang)}
        animationLines={[
          t('gen.knowledge.line1', lang),
          t('gen.knowledge.line2', lang),
          t('gen.knowledge.line3', lang),
        ]}
        errorMessage={t('gen.error.generic', lang)}
        skipHref="/onboarding/faqs"
        skipLabel={t('gen.skip', lang)}
      />
    </WizardShell>
  )
}
