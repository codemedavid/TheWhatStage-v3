import Link from 'next/link'
import { after } from 'next/server'
import { WizardShell } from '../_components/WizardShell'
import { FaqChecklist } from './FaqChecklist'
import { RegenerateButton } from '../knowledge/RegenerateButton'
import { retryGenerationAction } from '../actions'
import { GenerationGate } from '../_components/GenerationGate'
import { getJob } from '@/lib/onboarding/generation/repo'
import { runGeneration } from '@/lib/onboarding/generation/runner'
import { createClient } from '@/lib/supabase/server'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getBusinessBasics } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'
import type { GeneratedFaqs } from '@/lib/onboarding/ai/faqs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
    return (
      <WizardShell lang={lang} step="faqs">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('faqs.heading', lang)}</h1>
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p>{t('faqs.error.generation', lang)}</p>
          <p className="mt-2 text-xs text-red-800/80">{job.error ?? 'unknown_error'}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <form action={retryGenerationAction}>
              <input type="hidden" name="kind" value="faqs" />
              <button type="submit" className="font-medium underline">
                {t('faqs.regenerate', lang)}
              </button>
            </form>
            <Link href="/onboarding/personality" className="font-medium underline">
              {t('gen.skip', lang)}
            </Link>
          </div>
        </div>
      </WizardShell>
    )
  }

  // No job row yet — lazily enqueue so existing users / direct nav / stale-swept
  // sessions still trigger generation.
  if (!job && auth.user) {
    const profileId = auth.user.id
    const { data: stateRow } = await supabase
      .from('onboarding_state')
      .select('ui_language')
      .eq('profile_id', profileId)
      .maybeSingle()
    const pageLang = stateRow?.ui_language === 'en' ? 'en' : 'tl'
    after(async () => {
      await runGeneration(profileId, 'faqs', { basics, lang: pageLang })
    })
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
