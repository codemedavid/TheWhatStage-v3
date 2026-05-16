import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { FaqChecklist } from './FaqChecklist'
import { RegenerateButton } from '../knowledge/RegenerateButton'
import { generateFaqsAction } from '../actions'
import { GenerationGate } from '../_components/GenerationGate'
import { getJob } from '@/lib/onboarding/generation/repo'
import { createClient } from '@/lib/supabase/server'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getBusinessBasics } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'
import type { GeneratedFaqs } from '@/lib/onboarding/ai/faqs'

export const dynamic = 'force-dynamic'

function isGeneratedFaqs(v: unknown): v is GeneratedFaqs {
  return !!v && typeof v === 'object' && Array.isArray((v as { suggestions?: unknown }).suggestions)
}

export default async function FaqsPage() {
  const lang = await getOnboardingLang()
  const basics = await getBusinessBasics()

  if (!basics) {
    return (
      <WizardShell lang={lang} step="faqs">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('faqs.heading', lang)}</h1>
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>{t('faqs.error.no_basics', lang)}</p>
          <Link href="/onboarding/business" className="mt-2 inline-block font-medium underline">
            {t('shell.back', lang)}
          </Link>
        </div>
      </WizardShell>
    )
  }

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const job = auth.user ? await getJob(auth.user.id, 'faqs') : null

  if (job?.status === 'done' && isGeneratedFaqs(job.result)) {
    return (
      <WizardShell lang={lang} step="faqs">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('faqs.heading', lang)}</h1>
        <p className="mt-1 text-sm text-zinc-600">{t('faqs.subheading', lang)}</p>
        <div className="mt-6">
          <div className="mb-3 flex justify-end"><RegenerateButton lang={lang} /></div>
          <FaqChecklist lang={lang} suggestions={job.result.suggestions} />
        </div>
      </WizardShell>
    )
  }

  if (job?.status === 'failed') {
    const sync = await generateFaqsAction()
    if (sync.ok === false) {
      return (
        <WizardShell lang={lang} step="faqs">
          <h1 className="text-2xl font-semibold text-zinc-900">{t('faqs.heading', lang)}</h1>
          <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            <p>{t('faqs.error.generation', lang)}</p>
            <div className="mt-3"><RegenerateButton lang={lang} /></div>
          </div>
        </WizardShell>
      )
    }
    return (
      <WizardShell lang={lang} step="faqs">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('faqs.heading', lang)}</h1>
        <div className="mt-6">
          <div className="mb-3 flex justify-end"><RegenerateButton lang={lang} /></div>
          <FaqChecklist lang={lang} suggestions={sync.data.suggestions} />
        </div>
      </WizardShell>
    )
  }

  return (
    <WizardShell lang={lang} step="faqs">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('faqs.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('faqs.subheading', lang)}</p>
      <GenerationGate
        kind="faqs"
        animationHeading={t('gen.faqs.heading', lang)}
        animationLines={[
          t('gen.faqs.line1', lang),
          t('gen.faqs.line2', lang),
          t('gen.faqs.line3', lang),
        ]}
        errorMessage={t('gen.error.generic', lang)}
        skipHref="/onboarding/personality"
        skipLabel={t('gen.skip', lang)}
      />
    </WizardShell>
  )
}
