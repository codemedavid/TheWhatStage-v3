import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { KnowledgeEditor } from './KnowledgeEditor'
import { RegenerateButton } from './RegenerateButton'
import { generateKnowledgeAction } from '../actions'
import { GenerationGate } from '../_components/GenerationGate'
import { getJob } from '@/lib/onboarding/generation/repo'
import { createClient } from '@/lib/supabase/server'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getBusinessBasics } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'
import type { GeneratedKnowledge } from '@/lib/onboarding/ai/knowledge'

export const dynamic = 'force-dynamic'

function isGeneratedKnowledge(v: unknown): v is GeneratedKnowledge {
  return !!v && typeof v === 'object' && Array.isArray((v as { sections?: unknown }).sections)
}

export default async function KnowledgePage() {
  const lang = await getOnboardingLang()
  const basics = await getBusinessBasics()

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

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const job = auth.user ? await getJob(auth.user.id, 'knowledge') : null

  if (job?.status === 'done' && isGeneratedKnowledge(job.result)) {
    return (
      <WizardShell lang={lang} step="knowledge">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('knowledge.heading', lang)}</h1>
        <p className="mt-1 text-sm text-zinc-600">{t('knowledge.subheading', lang)}</p>
        <div className="mt-6">
          <div className="mb-3 flex justify-end"><RegenerateButton lang={lang} /></div>
          <KnowledgeEditor lang={lang} initial={job.result.sections} />
        </div>
      </WizardShell>
    )
  }

  if (job?.status === 'failed') {
    // Fallback: try the synchronous path so the user can keep going.
    const sync = await generateKnowledgeAction()
    if (sync.ok === false) {
      return (
        <WizardShell lang={lang} step="knowledge">
          <h1 className="text-2xl font-semibold text-zinc-900">{t('knowledge.heading', lang)}</h1>
          <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            <p>{t('knowledge.error.generation', lang)}</p>
            <div className="mt-3"><RegenerateButton lang={lang} /></div>
          </div>
        </WizardShell>
      )
    }
    return (
      <WizardShell lang={lang} step="knowledge">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('knowledge.heading', lang)}</h1>
        <div className="mt-6">
          <div className="mb-3 flex justify-end"><RegenerateButton lang={lang} /></div>
          <KnowledgeEditor lang={lang} initial={sync.data.sections} />
        </div>
      </WizardShell>
    )
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
